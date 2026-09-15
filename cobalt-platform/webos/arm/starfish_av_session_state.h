#ifndef STARBOARD_WEBOS_ARM_STARFISH_AV_SESSION_STATE_H_
#define STARBOARD_WEBOS_ARM_STARFISH_AV_SESSION_STATE_H_

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <deque>
#include <limits>
#include <vector>

namespace starboard {
namespace shared {
namespace webos {

// Shared-session building blocks for the native webOS player.
// Deliberately independent of the firmware API so invariants can be host tested.
struct StarfishOpusConfig {
  std::array<uint8_t, 19> header{};

  unsigned pre_skip_samples() const {
    return header[10] | (static_cast<unsigned>(header[11]) << 8);
  }

  // Initial scope: version 1, mono/stereo mapping family 0, 48 kHz output.
  // OpusHead's input-rate hint need not equal the output sample rate.
  static bool Parse(const void* bytes, size_t size, unsigned channels,
                    unsigned output_rate, StarfishOpusConfig* result) {
    if (!bytes || !result || size != 19 || output_rate != 48000 ||
        channels < 1 || channels > 2) return false;
    const auto* data = static_cast<const uint8_t*>(bytes);
    if (std::memcmp(data, "OpusHead", 8) || data[8] != 1 ||
        data[9] != channels || data[18] != 0) return false;
    std::copy(data, data + size, result->header.begin());
    return true;
  }
};

struct StarfishOpusSessionPlan {
  StarfishOpusConfig config;
  int64_t epoch_us = 0;
  int64_t target_native_us = 0;
  unsigned discard_samples = 0;

  bool ToNativeNanoseconds(int64_t presentation_us, int64_t* native_ns) const {
    // Feed uses nanoseconds. Bound before adding/multiplying, including a
    // packet from before the session's chosen epoch (which must be rejected).
    const int64_t limit = std::numeric_limits<int64_t>::max() / 1000;
    if (!native_ns || epoch_us < 0 || epoch_us > limit ||
        presentation_us < -epoch_us || presentation_us > limit - epoch_us)
      return false;
    *native_ns = (presentation_us + epoch_us) * 1000;
    return true;
  }
};

// first_decoded_audio_us MUST describe the first decoded sample before discard,
// in the video's presentation timeline. It is NOT necessarily InputBuffer PTS:
// the bridge must resolve container codec delay first. Do not subtract OpusHead
// pre-skip twice. Both streams keep the same epoch, including after seeks.
// The caller supplies the actual first packets, never fixture-specific timing.
inline bool PlanStarfishOpusSession(
    const StarfishOpusConfig& config, int64_t first_decoded_audio_us,
    int64_t first_video_us, int64_t target_us, bool starts_at_stream_origin,
    StarfishOpusSessionPlan* result) {
  StarfishOpusConfig checked;
  if (!result || !StarfishOpusConfig::Parse(config.header.data(),
          config.header.size(), config.header[9], 48000, &checked)) return false;
  const int64_t limit = std::numeric_limits<int64_t>::max() / 1000;
  if (first_decoded_audio_us < -limit || first_decoded_audio_us > limit ||
      first_video_us < -limit || first_video_us > limit ||
      target_us < 0 || target_us > limit ||
      first_decoded_audio_us > target_us) return false;

  const int64_t gap_us = target_us - first_decoded_audio_us;
  // The fresh decoder's pre-skip field is only 16 bits. No wrapping and no
  // silent truncation of missing seek pre-roll. Near-origin seeks may use the
  // original beginning instead, but must still honor the original pre-skip.
  if (gap_us > 1365333 || (!starts_at_stream_origin && gap_us < 80000))
    return false;
  // Cobalt timestamps have microsecond precision; round to the nearest sample
  // instead of requiring every timestamp to represent an exact 48 kHz sample.
  const auto discard = static_cast<unsigned>((gap_us * 48 + 500) / 1000);
  if (discard > 65535 ||
      (starts_at_stream_origin && discard < checked.pre_skip_samples()))
    return false;

  StarfishOpusSessionPlan plan;
  plan.config = checked;
  plan.epoch_us = -std::min<int64_t>(0,
      std::min(first_decoded_audio_us, first_video_us));
  int64_t native_ns;
  if (!plan.ToNativeNanoseconds(target_us, &native_ns)) return false;
  plan.target_native_us = native_ns / 1000;
  if (!plan.ToNativeNanoseconds(first_video_us, &native_ns) ||
      !plan.ToNativeNanoseconds(first_decoded_audio_us, &native_ns)) return false;
  plan.discard_samples = discard;
  plan.config.header[10] = discard & 255;
  plan.config.header[11] = (discard >> 8) & 255;
  *result = plan;
  return true;
}

// Serialized owner-thread state. Native callbacks must marshal to that owner;
// this is not a mutex or a firmware callback-lifetime solution. Handle must own
// packet storage (e.g. scoped_refptr<InputBuffer>), not be a borrowed pointer.
// A feed ticket retains that storage even if Reset removes its queued copy.
template <typename Handle>
class StarfishAvSessionState {
 public:
  enum class Stream { kAudio, kVideo };
  enum class EnqueueResult { kAccepted, kFull, kInvalid, kClosed, kStale };
  enum class FeedResult { kAccepted, kRetry, kError };
  struct Limits {
    size_t packets;
    size_t bytes;
  };
  struct Packet {
    Handle buffer;
    size_t bytes;
    int64_t pts_us;
  };
  struct FeedTicket {
    uint64_t generation;
    Stream stream;
    uint64_t sequence;
    Packet packet;
  };

  StarfishAvSessionState(Limits audio, Limits video)
      : audio_limits_(audio), video_limits_(video) {}
  StarfishAvSessionState(const StarfishAvSessionState&) = delete;
  StarfishAvSessionState& operator=(const StarfishAvSessionState&) = delete;

  uint64_t generation() const { return generation_; }
  bool failed() const { return failed_; }
  bool ended() const { return ended_; }

  // One reset for BOTH streams. A delayed accepted Feed/EOS callback from the
  // old decoder must never consume packets or end playback in this generation.
  bool Reset() {
    if (generation_ == std::numeric_limits<uint64_t>::max()) {
      failed_ = true;
      return false;
    }
    ++generation_;
    audio_ = Queue{};
    video_ = Queue{};
    failed_ = eos_submitted_ = ended_ = false;
    return true;
  }

  // Atomic batch admission: never accept only half a Cobalt InputBuffers batch.
  // A packet larger than the entire budget is invalid, not retryable forever.
  EnqueueResult Enqueue(uint64_t generation, Stream stream,
                        const std::vector<Packet>& packets) {
    if (generation != generation_) return EnqueueResult::kStale;
    Queue& queue = Get(stream);
    if (failed_ || queue.eos) return EnqueueResult::kClosed;
    if (packets.empty()) return EnqueueResult::kInvalid;
    const Limits limits = stream == Stream::kAudio ? audio_limits_ : video_limits_;
    if (packets.size() > limits.packets) return EnqueueResult::kInvalid;
    size_t bytes = 0;
    for (const auto& packet : packets) {
      if (!packet.buffer || !packet.bytes || packet.bytes > limits.bytes - bytes)
        return EnqueueResult::kInvalid;
      bytes += packet.bytes;
    }
    if (packets.size() > limits.packets - queue.packets.size() ||
        bytes > limits.bytes - queue.bytes) return EnqueueResult::kFull;
    if (packets.size() > std::numeric_limits<uint64_t>::max() - queue.next_sequence)
      return EnqueueResult::kInvalid;
    for (const auto& packet : packets)
      queue.packets.push_back(Entry{++queue.next_sequence, packet});
    queue.bytes += bytes;
    return EnqueueResult::kAccepted;
  }

  // Get one ticket, issue one Feed, then CompleteFeed before feeding that
  // stream again. kRetry keeps exactly the same packet. Audio/video do not
  // share a head-of-line queue, so a full video buffer cannot starve audio.
  bool NextFeed(Stream stream, FeedTicket* ticket) const {
    const Queue& queue = Get(stream);
    if (!ticket || failed_ || queue.packets.empty()) return false;
    const Entry& entry = queue.packets.front();
    *ticket = FeedTicket{generation_, stream, entry.sequence, entry.packet};
    return true;
  }

  bool CompleteFeed(const FeedTicket& ticket, FeedResult result) {
    if (ticket.generation != generation_ || failed_) return false;
    Queue& queue = Get(ticket.stream);
    if (queue.packets.empty() || queue.packets.front().sequence != ticket.sequence)
      return false;
    if (result == FeedResult::kError) {
      failed_ = true;
    } else if (result == FeedResult::kAccepted) {
      queue.bytes -= queue.packets.front().packet.bytes;
      queue.packets.pop_front();
    }
    return true;
  }

  bool WriteEos(uint64_t generation, Stream stream) {
    if (generation != generation_ || failed_) return false;
    Get(stream).eos = true;
    return true;
  }
  bool ReadyToSubmitEos() const {
    return !failed_ && !eos_submitted_ && audio_.eos && video_.eos &&
           audio_.packets.empty() && video_.packets.empty();
  }
  bool EosSubmitted(uint64_t generation) {
    if (generation != generation_ || !ReadyToSubmitEos()) return false;
    eos_submitted_ = true;
    return true;
  }
  bool NativeEnded(uint64_t generation) {
    if (generation != generation_ || failed_ || !eos_submitted_ || ended_)
      return false;
    ended_ = true;
    return true;
  }
  size_t queued_bytes(Stream stream) const { return Get(stream).bytes; }
  size_t queued_packets(Stream stream) const { return Get(stream).packets.size(); }

 private:
  struct Entry {
    uint64_t sequence;
    Packet packet;
  };
  struct Queue {
    std::deque<Entry> packets;
    size_t bytes = 0;
    uint64_t next_sequence = 0;
    bool eos = false;
  };
  Queue& Get(Stream stream) { return stream == Stream::kAudio ? audio_ : video_; }
  const Queue& Get(Stream stream) const {
    return stream == Stream::kAudio ? audio_ : video_;
  }
  const Limits audio_limits_;
  const Limits video_limits_;
  Queue audio_, video_;
  uint64_t generation_ = 1;
  bool failed_ = false;
  bool eos_submitted_ = false;
  bool ended_ = false;
};

}  // namespace webos
}  // namespace shared
}  // namespace starboard
#endif  // STARBOARD_WEBOS_ARM_STARFISH_AV_SESSION_STATE_H_
