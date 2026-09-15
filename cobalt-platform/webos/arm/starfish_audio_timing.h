#ifndef STARBOARD_WEBOS_ARM_STARFISH_AUDIO_TIMING_H_
#define STARBOARD_WEBOS_ARM_STARFISH_AUDIO_TIMING_H_

#include <array>
#include <cstdint>
#include <cstring>
#include <limits>

#include "starfish_av_session_state.h"

namespace starboard {
namespace shared {
namespace webos {

// Private, versioned side data for this self-contained webOS build. No public
// sample struct layout changes; Matroska BlockAdditional remains separate.
struct StarfishAudioTiming {
  using Wire = std::array<uint8_t, 48>;
  int64_t codec_delay_samples = 0;
  int64_t seek_preroll_us = 0;
  int64_t discard_front_us = 0;
  int64_t discard_back_us = 0;
  int64_t duration_us = 0;

  Wire Encode() const {
    Wire wire{};
    std::memcpy(wire.data(), "YTAFAT01", 8);
    const int64_t values[] = {codec_delay_samples, seek_preroll_us,
        discard_front_us, discard_back_us, duration_us};
    for (unsigned i = 0; i < 5; ++i)
      for (unsigned j = 0; j < 8; ++j)
        wire[8 + i * 8 + j] = static_cast<uint64_t>(values[i]) >> (j * 8);
    return wire;
  }
  static bool Decode(const uint8_t* data, size_t size, StarfishAudioTiming* out) {
    if (!data || !out || size != Wire{}.size() || std::memcmp(data, "YTAFAT01", 8))
      return false;
    int64_t values[5];
    for (unsigned i = 0; i < 5; ++i) {
      uint64_t value = 0;
      for (unsigned j = 0; j < 8; ++j)
        value |= static_cast<uint64_t>(data[8 + i * 8 + j]) << (j * 8);
      if (value > static_cast<uint64_t>(std::numeric_limits<int64_t>::max()))
        return false;  // negative/infinite discard and missing duration
      values[i] = static_cast<int64_t>(value);
    }
    *out = {values[0], values[1], values[2], values[3], values[4]};
    return true;
  }
};

// Only the verified WebM timeline is supported by the initial player. Front
// trimming may already move packet PTS and remains unsupported. The Starfish
// transport has no per-packet back-clipping field, so a valid final packet may
// be decoded in full. This can extend the tail by at most one Opus packet, but
// avoids turning ordinary WebM end padding into a playback error.
inline bool ResolveStarfishOpusPacketTime(const StarfishOpusConfig& config,
                                        const StarfishAudioTiming& timing,
                                        int64_t packet_pts_us,
                                        int64_t* decoded_pts_us) {
  if (!decoded_pts_us || packet_pts_us < 0 ||
      packet_pts_us > std::numeric_limits<int64_t>::max() / 1000 ||
      timing.codec_delay_samples != config.pre_skip_samples() ||
      timing.discard_front_us != 0 ||
      timing.duration_us <= 0 || timing.duration_us > 120000 ||
      timing.discard_back_us > timing.duration_us ||
      timing.seek_preroll_us < 0 || timing.seek_preroll_us > 80000) return false;
  *decoded_pts_us = packet_pts_us -
      (timing.codec_delay_samples * 1000000 + 24000) / 48000;
  return true;
}

}  // namespace webos
}  // namespace shared
}  // namespace starboard
#endif
