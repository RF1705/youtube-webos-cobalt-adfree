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

constexpr int64_t kStarfishOpusSampleRate = 48000;
constexpr unsigned kStarfishOpusMaxDiscardSamples =
    std::numeric_limits<uint16_t>::max();

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
  // silent truncation. The demuxer requests the config's seek preroll, but
  // clamps it to the available MSE range. Accept that actual preroll and
  // discard only samples before the requested target; do not move the seek.
  // Only stream-origin playback must honor the original codec pre-skip.
  if (gap_us > kStarfishOpusMaxDiscardSamples * 1000000LL /
                   kStarfishOpusSampleRate) return false;
  // Cobalt timestamps have microsecond precision; round to the nearest sample
  // instead of requiring every timestamp to represent an exact 48 kHz sample.
  const auto discard = static_cast<unsigned>(
      (gap_us * kStarfishOpusSampleRate + 500000) / 1000000);
  if (discard > kStarfishOpusMaxDiscardSamples ||
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

// The native shared session only advances when the first video frame it decodes
// is close to its ptsToDecode target. A demuxer seek restarts at the keyframe at
// or before the target, which can be seconds earlier; such a session presents
// one frame and then stalls. Retarget such a seek to the first keyframe inside
// the window, so Load/ptsToDecode and the first native video frame are near the
// target like the seeks that already work.
//
// Packets are player-owned once Write() returned, so the retarget releases them
// from the bridge queue in feed order and never feeds a partial GOP afterwards.
struct StarfishSeekSnapCandidate {
  int64_t pts_us;
  bool is_key_frame;
};

struct StarfishSeekSnapDecision {
  enum class Action {
    kWait,            // no queued video yet
    kFeedFromFront,   // front keyframe is already within the window
    kKeepScanning,    // the demuxer has not queued a usable keyframe yet
    kOutsideWindow,   // a later keyframe proves no nearby start can arrive
    kStartAtKeyframe  // release |discard_count| leading packets; start there
  };
  Action action = Action::kWait;
  size_t discard_count = 0;
  int64_t keyframe_us = 0;
};

// |window_us| accepts a keyframe slightly before or after the target.
// |max_ahead_us| reserves room for the native-start guard inside the seek
// tolerance. A keyframe outside the window is never an acceptable fallback.
inline StarfishSeekSnapDecision PlanStarfishSeekSnap(
    const std::vector<StarfishSeekSnapCandidate>& video, int64_t target_us,
    int64_t window_us, int64_t max_ahead_us) {
  StarfishSeekSnapDecision decision;
  if (video.empty() || target_us < 0) return decision;
  if (video.front().is_key_frame &&
      video.front().pts_us >= target_us - window_us &&
      video.front().pts_us <= target_us + max_ahead_us) {
    decision.action = StarfishSeekSnapDecision::Action::kFeedFromFront;
    return decision;
  }
  if (video.front().is_key_frame &&
      video.front().pts_us > target_us + max_ahead_us) {
    decision.action = StarfishSeekSnapDecision::Action::kOutsideWindow;
    return decision;
  }
  for (size_t i = 1; i < video.size(); ++i) {
    if (!video[i].is_key_frame || video[i].pts_us < target_us - window_us)
      continue;
    if (video[i].pts_us > target_us + max_ahead_us) {
      decision.action = StarfishSeekSnapDecision::Action::kOutsideWindow;
      return decision;
    }
    decision.action = StarfishSeekSnapDecision::Action::kStartAtKeyframe;
    decision.discard_count = i;
    decision.keyframe_us = video[i].pts_us;
    return decision;
  }
  decision.action = StarfishSeekSnapDecision::Action::kKeepScanning;
  return decision;
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
    // Video keyframe flag of the queued packet; audio packets stay false. Kept
    // here so a seek retarget can inspect the queue without touching buffers.
    bool is_key_frame = false;
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

  // Ordered metadata of the queued packets, for seek retargeting only. The
  // caller must not use it as an alternative way to Feed a packet.
  struct Pending {
    uint64_t sequence;
    bool is_key_frame;
    int64_t pts_us;
  };
  std::vector<Pending> Peek(Stream stream, size_t limit) const {
    const Queue& queue = Get(stream);
    const size_t count = std::min(limit, queue.packets.size());
    std::vector<Pending> pending;
    pending.reserve(count);
    for (size_t i = 0; i < count; ++i)
      pending.push_back(Pending{queue.packets[i].sequence,
                                queue.packets[i].packet.is_key_frame,
                                queue.packets[i].packet.pts_us});
    return pending;
  }

  // Releases one queued packet without feeding it. Write() already took
  // ownership from the player, so dropping it here cannot invalidate player
  // state; a seek retarget uses it to skip a GOP that starts before the target.
  bool Discard(uint64_t generation, Stream stream, uint64_t sequence) {
    if (generation != generation_ || failed_) return false;
    Queue& queue = Get(stream);
    for (auto it = queue.packets.begin(); it != queue.packets.end(); ++it) {
      if (it->sequence != sequence) continue;
      queue.bytes -= it->packet.bytes;
      queue.packets.erase(it);
      return true;
    }
    return false;
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
  // Creating a replacement session discards the native EOS marker.
  // Application queues and input EOS remain intact; submit again after replay.
  void NativeFlushed() { if (!ended_) eos_submitted_ = false; }
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

// Bounds of the seek retarget below. Separate from the native player so the
// deadline and windows are explicit.
constexpr int64_t kStarfishSeekSnapWindowUs = 1000000;
constexpr int64_t kStarfishSeekSnapGuardUs = 100000;
constexpr int64_t kStarfishSeekSnapAheadUs =
    kStarfishSeekSnapWindowUs - kStarfishSeekSnapGuardUs;
// A streaming demuxer needs room for a whole GOP before the next keyframe is
// queued; holding is bounded. Expiry preserves the exact target and retained
// GOP for native 1x preroll, with later rate changes still gated on progress.
// Allow a slowly delivered GOP two seconds to arrive.
constexpr int64_t kStarfishSeekRetargetDeadlineUs = 2000000;
constexpr int64_t kStarfishSeekPrerollUs = 100000;
constexpr size_t kStarfishSeekHoldPackets = 512;
constexpr int64_t kStarfishRateTransitionDeadlineUs = 5000000;

// Returning to 1x requires a fresh decoder. Keep the presented position rather
// than rewinding video without its matching audio. A distant retained keyframe
// is not a usable restart: wait for a new GOP while the current session plays.
inline bool PlanStarfishRateRestart(
    const StarfishOpusConfig& config, int64_t first_audio_us,
    int64_t first_video_us, int64_t position_us,
    StarfishOpusSessionPlan* plan) {
  const int64_t limit = std::numeric_limits<int64_t>::max() / 1000;
  if (!plan || first_audio_us > position_us ||
      first_audio_us < -limit || position_us < 0 || position_us > limit ||
      first_video_us < 0 || first_video_us > position_us) return false;
  return position_us - first_video_us <= kStarfishSeekSnapWindowUs &&
      PlanStarfishOpusSession(config, first_audio_us, first_video_us,
                             position_us, false, plan);
}

struct StarfishSeekRetargetResult {
  enum class Action {
    kWait,    // more queued input is required
    kDirect,  // first keyframe is close enough: start without retargeting
    kStart,   // start at |keyframe_us|
    kGiveUp   // no nearby start: retain GOP and decode at the exact target at 1x
  };
  Action action = Action::kWait;
  int64_t keyframe_us = 0;
};

// Turns one seek into a native-session start point near its target. The native
// session only progresses when its first video frame is close to ptsToDecode, so
// a GOP whose keyframe precedes the target by seconds is skipped.
//
// Packets are player-owned once Write() returned, so releasing them here cannot
// invalidate player state. Nothing is released until a usable keyframe AND the
// matching audio are queued, so an abandoned retarget leaves the stream exactly
// as the demuxer delivered it. The caller keeps feeding Write() and calls Step()
// from its owner thread; this object holds no packet storage.
template <typename State>
class StarfishSeekRetarget {
 public:
  using Stream = typename State::Stream;

  struct Stats {
    int64_t keyframe_us = 0;
    unsigned video_packets = 0;
    unsigned audio_packets = 0;
    bool given_up = false;
  };

  void Begin(int64_t target_us, int64_t now_us) {
    target_us_ = target_us < 0 ? 0 : target_us;
    started_us_ = now_us;
    active_ = true;
    have_input_ = false;
    start_us_ = target_us_;
    stats_ = Stats();
  }
  bool active() const { return active_; }
  const Stats& stats() const { return stats_; }
  int64_t start_us() const { return start_us_; }

  StarfishSeekRetargetResult Step(State* state, uint64_t generation,
                                  int64_t now_us) {
    StarfishSeekRetargetResult result;
    if (!active_ || !state || state->generation() != generation) return result;
    const auto video = state->Peek(Stream::kVideo, kStarfishSeekHoldPackets);
    if (video.empty()) {
      // Nothing has arrived yet: the deadline starts with the first GOP, not
      // with the seek request, so a slow demuxer cannot cancel the retarget.
      return result;
    }
    if (!have_input_) {
      have_input_ = true;
      started_us_ = now_us;
    }
    std::vector<StarfishSeekSnapCandidate> candidates;
    candidates.reserve(video.size());
    for (const auto& entry : video)
      candidates.push_back({entry.pts_us, entry.is_key_frame});
    const auto decision = PlanStarfishSeekSnap(
        candidates, target_us_, kStarfishSeekSnapWindowUs, kStarfishSeekSnapAheadUs);
    if (decision.action == StarfishSeekSnapDecision::Action::kFeedFromFront) {
      active_ = false;
      result.action = StarfishSeekRetargetResult::Action::kDirect;
      return result;
    }
    if (decision.action == StarfishSeekSnapDecision::Action::kStartAtKeyframe) {
      // Commit only with the first audio packet the session would feed, so the
      // Opus pre-skip plan matches the stream instead of a stale timestamp.
      const int64_t preroll_us =
          decision.keyframe_us - kStarfishSeekPrerollUs;
      const auto audio = state->Peek(Stream::kAudio, kStarfishSeekHoldPackets);
      size_t audio_discard = 0;
      while (audio_discard < audio.size() &&
             audio[audio_discard].pts_us < preroll_us)
        ++audio_discard;
      const int64_t start = audio_discard < audio.size()
          ? StartFrom(decision.keyframe_us, audio[audio_discard].pts_us) : 0;
      if (audio_discard < audio.size() &&
          start >= target_us_ - kStarfishSeekSnapWindowUs &&
          start <= target_us_ + kStarfishSeekSnapWindowUs &&
          start - decision.keyframe_us <= kStarfishSeekSnapWindowUs) {
        for (size_t i = 0; i < decision.discard_count; ++i)
          if (state->Discard(generation, Stream::kVideo, video[i].sequence))
            ++stats_.video_packets;
        for (size_t i = 0; i < audio_discard; ++i)
          if (state->Discard(generation, Stream::kAudio, audio[i].sequence))
            ++stats_.audio_packets;
        active_ = false;
        stats_.keyframe_us = decision.keyframe_us;
        start_us_ = start;
        result.action = StarfishSeekRetargetResult::Action::kStart;
        result.keyframe_us = decision.keyframe_us;
        return result;
      }
    }
    const bool passed_window =
        decision.action == StarfishSeekSnapDecision::Action::kOutsideWindow;
    const bool have_audio = !state->Peek(Stream::kAudio, 1).empty();
    if ((passed_window && have_audio) ||
        now_us - started_us_ >= kStarfishSeekRetargetDeadlineUs) {
      // A later keyframe cannot improve this seek: start immediately instead
      // of leaving a black surface until the scan deadline. Nothing was
      // released. The owner can decode this GOP at native 1x and
      // keep rate changes gated until presentation advances past the target.
      active_ = false;
      stats_.given_up = true;
      result.action = StarfishSeekRetargetResult::Action::kGiveUp;
      return result;
    }
    return result;
  }

 private:
  // The caller selects audio at or after keyframe - preroll. Consequently the
  // gap here is at most preroll + guard (200 ms), within the Opus discard limit.
  static int64_t StartFrom(int64_t keyframe_us, int64_t first_audio_us) {
    return std::max(keyframe_us, first_audio_us) + kStarfishSeekSnapGuardUs;
  }

  int64_t target_us_ = 0, started_us_ = 0, start_us_ = 0;
  bool active_ = false;
  bool have_input_ = false;
  Stats stats_;
};

}  // namespace webos
}  // namespace shared
}  // namespace starboard
#endif  // STARBOARD_WEBOS_ARM_STARFISH_AV_SESSION_STATE_H_
