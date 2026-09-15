#include <cassert>
#include <iostream>
#include <limits>
#include <memory>

#include "starfish_av_session_state.h"
#include "starfish_audio_timing.h"
#include "shared_av_experiment.h"
#include "starfish_video_configuration.h"

// The SDK syntax check instantiates every queue method with Cobalt's real
// reference-counted packet type, as well as the host ownership fixture below.
#if defined(YTAF_TEST_COBALT_INPUT_BUFFER)
#include "starboard/shared/starboard/player/input_buffer_internal.h"
template class starboard::shared::webos::StarfishAvSessionState<
    starboard::scoped_refptr<starboard::shared::starboard::player::InputBuffer>>;
#endif

using starboard::shared::webos::PlanStarfishOpusSession;
using starboard::shared::webos::StarfishAvSessionState;
using starboard::shared::webos::StarfishOpusConfig;
using starboard::shared::webos::StarfishOpusSessionPlan;
using starboard::shared::webos::StarfishVideoConfiguration;

namespace {

void TestExperimentMode() {
  using starboard::shared::webos::ParseSharedAvBackendMode;
  using starboard::shared::webos::ReadConfiguredSharedAvBackendMode;
  using starboard::shared::webos::SharedAvBackendMode;
  assert(ParseSharedAvBackendMode(nullptr) == 3);
  assert(ParseSharedAvBackendMode("0") == 0);
  assert(ParseSharedAvBackendMode("1") == 1);
  assert(ParseSharedAvBackendMode("2") == 2);
  assert(ParseSharedAvBackendMode("3") == 3);
  assert(ParseSharedAvBackendMode("") == 0);
  assert(ParseSharedAvBackendMode("invalid") == 0);
  assert(::setenv("YTAF_SHARED_AV", "0", 1) == 0);
  assert(ReadConfiguredSharedAvBackendMode() == 0);
  assert(::setenv("YTAF_SHARED_AV", "1", 1) == 0);
  assert(ReadConfiguredSharedAvBackendMode() == 1);
  assert(::setenv("YTAF_SHARED_AV", "2", 1) == 0);
  assert(ReadConfiguredSharedAvBackendMode() == 2);
  assert(::setenv("YTAF_SHARED_AV", "3", 1) == 0);
  assert(ReadConfiguredSharedAvBackendMode() == 3);
  assert(SharedAvBackendMode() == 3);
  assert(::setenv("YTAF_SHARED_AV", "0", 1) == 0);
  assert(SharedAvBackendMode() == 3);  // mode is process-latched
  assert(::setenv("YTAF_SHARED_AV", "invalid", 1) == 0);
  assert(ReadConfiguredSharedAvBackendMode() == 0);
  assert(::unsetenv("YTAF_SHARED_AV") == 0);
  // No marker in a fresh installation selects the full shared backend.
  // Marker overrides are exercised on the TV because this host may have an
  // existing marker belonging to another local test.
}

StarfishOpusConfig Config(unsigned pre_skip = 312, unsigned channels = 2) {
  // Nonzero gain and a 44.1 kHz input hint must survive restart planning.
  const uint8_t data[] = {'O', 'p', 'u', 's', 'H', 'e', 'a', 'd', 1,
      static_cast<uint8_t>(channels), static_cast<uint8_t>(pre_skip & 255),
      static_cast<uint8_t>(pre_skip >> 8), 0x44, 0xac, 0, 0, 0x80, 0, 0};
  StarfishOpusConfig config;
  assert(StarfishOpusConfig::Parse(data, sizeof(data), channels, 48000, &config));
  return config;
}

void TestConfiguration() {
  const auto config = Config(960, 1);
  assert(config.pre_skip_samples() == 960);
  StarfishOpusConfig result;
  assert(!StarfishOpusConfig::Parse(nullptr, 19, 1, 48000, &result));
  assert(!StarfishOpusConfig::Parse(config.header.data(), 18, 1, 48000, &result));
  assert(!StarfishOpusConfig::Parse(config.header.data(), 20, 1, 48000, &result));
  assert(!StarfishOpusConfig::Parse(config.header.data(), 19, 2, 48000, &result));
  assert(!StarfishOpusConfig::Parse(config.header.data(), 19, 1, 44100, &result));
  assert(!StarfishOpusConfig::Parse(config.header.data(), 19, 1, 48000, nullptr));
  for (const auto index : {0, 8, 9, 18}) {
    auto broken = config.header;
    broken[index] = 255;
    assert(!StarfishOpusConfig::Parse(broken.data(), 19, 1, 48000, &result));
  }
}

void TestTiming() {
  const auto original = Config();
  StarfishOpusSessionPlan plan;
  assert(PlanStarfishOpusSession(original, -6500, 0, 0, true, &plan));
  assert(plan.epoch_us == 6500 && plan.target_native_us == 6500);
  assert(plan.discard_samples == 312);
  int64_t audio_ns, video_ns;
  assert(plan.ToNativeNanoseconds(-6500, &audio_ns) && audio_ns == 0);
  assert(plan.ToNativeNanoseconds(0, &video_ns) && video_ns == 6500000);
  assert(!plan.ToNativeNanoseconds(-6501, &audio_ns));
  assert(!plan.ToNativeNanoseconds(0, nullptr));

  // A preceding video keyframe can set the epoch, not just negative audio PTS.
  assert(PlanStarfishOpusSession(original, -6500, -1000000, 0, true, &plan));
  assert(plan.epoch_us == 1000000 && plan.target_native_us == 1000000);
  assert(plan.ToNativeNanoseconds(-6500, &audio_ns) && audio_ns == 993500000);
  assert(plan.ToNativeNanoseconds(-1000000, &video_ns) && video_ns == 0);

  // Do not import the probe's 312-sample codec delay into different streams.
  assert(PlanStarfishOpusSession(Config(960, 1), -20000, 0, 0, true, &plan));
  assert(plan.discard_samples == 960 && plan.epoch_us == 20000);
  assert(PlanStarfishOpusSession(Config(317), -6604, 0, 0, true, &plan));
  assert(plan.discard_samples == 317);  // rounded microsecond timestamp
  assert(!PlanStarfishOpusSession(original, 0, 0, 0, true, &plan));

  // Non-fixture seek timestamps and different packet boundaries; no fixed
  // 20 ms duration or integer-second target. Preserve every other header byte.
  const int64_t target = 123456789;
  for (const int64_t pre_roll : {80000, 80123, 86500, 120000}) {
    assert(PlanStarfishOpusSession(original, target - pre_roll,
                                  target - 1000000, target, false, &plan));
    assert(plan.discard_samples == (pre_roll * 48 + 500) / 1000);
    assert(plan.epoch_us == 0 && plan.target_native_us == target);
    for (size_t i = 0; i < original.header.size(); ++i)
      if (i != 10 && i != 11) assert(plan.config.header[i] == original.header[i]);
    assert(plan.ToNativeNanoseconds(target - pre_roll, &audio_ns));
    assert(plan.ToNativeNanoseconds(target - 1000000, &video_ns));
    assert(audio_ns - video_ns == (1000000 - pre_roll) * 1000);
  }
  // Backward seek near the stream origin may have less than 80 ms available.
  assert(PlanStarfishOpusSession(original, -6500, 0, 20000, true, &plan));
  assert(plan.discard_samples == 1272);
  assert(!PlanStarfishOpusSession(original, 10000, 0, 20000, false, &plan));
  assert(!PlanStarfishOpusSession(original, 0, 0, 79999, false, &plan));
  assert(!PlanStarfishOpusSession(original, 1, 0, 0, true, &plan));
  assert(!PlanStarfishOpusSession(original, -10000, 0, -1, true, &plan));
  assert(PlanStarfishOpusSession(original, 0, 0, 1365312, false, &plan));
  assert(plan.discard_samples == 65535);
  assert(!PlanStarfishOpusSession(original, 0, 0, 1365333, false, &plan));
  assert(!PlanStarfishOpusSession(original, 0, 0, 2000000, false, &plan));
  const auto max = std::numeric_limits<int64_t>::max();
  const auto min = std::numeric_limits<int64_t>::min();
  assert(!PlanStarfishOpusSession(original, min, 0, 0, true, &plan));
  assert(!PlanStarfishOpusSession(original, 0, max, 80000, false, &plan));
  assert(!PlanStarfishOpusSession(original, max / 1000 - 80000, -1,
                                max / 1000, false, &plan));
  assert(!plan.ToNativeNanoseconds(max, &audio_ns));
  assert(!plan.ToNativeNanoseconds(min, &audio_ns));
  assert(!PlanStarfishOpusSession(original, -6500, 0, 0, true, nullptr));
  auto malformed = original;
  malformed.header[18] = 1;
  assert(!PlanStarfishOpusSession(malformed, -6500, 0, 0, true, &plan));
}

void TestCobaltAudioTiming() {
  using starboard::shared::webos::StarfishAudioTiming;
  using starboard::shared::webos::ResolveStarfishOpusPacketTime;
  StarfishAudioTiming timing{312, 80000, 0, 0, 20000}, decoded;
  const auto wire = timing.Encode();
  assert(wire[8] == 0x38 && wire[9] == 1); // fixed little-endian, not struct ABI
  assert(StarfishAudioTiming::Decode(wire.data(), wire.size(), &decoded));
  assert(decoded.codec_delay_samples == 312 && decoded.seek_preroll_us == 80000);
  assert(decoded.duration_us == 20000 && decoded.Encode() == wire);
  assert(!StarfishAudioTiming::Decode(nullptr, wire.size(), &decoded));
  assert(!StarfishAudioTiming::Decode(wire.data(), wire.size() - 1, &decoded));
  assert(!StarfishAudioTiming::Decode(wire.data(), wire.size(), nullptr));
  auto invalid = wire;
  invalid[7] = '2';
  assert(!StarfishAudioTiming::Decode(invalid.data(), invalid.size(), &decoded));
  timing.discard_front_us = -1;
  invalid = timing.Encode();
  assert(!StarfishAudioTiming::Decode(invalid.data(), invalid.size(), &decoded));
  timing.discard_front_us = 0;
  int64_t pts;
  assert(ResolveStarfishOpusPacketTime(Config(), timing, 0, &pts) && pts == -6500);
  assert(ResolveStarfishOpusPacketTime(Config(), timing, 10000000, &pts) && pts == 9993500);
  assert(!ResolveStarfishOpusPacketTime(Config(), timing, -1, &pts));
  assert(!ResolveStarfishOpusPacketTime(Config(), timing, std::numeric_limits<int64_t>::max(), &pts));
  assert(!ResolveStarfishOpusPacketTime(Config(), timing, 0, nullptr));
  timing.codec_delay_samples = 317;
  assert(!ResolveStarfishOpusPacketTime(Config(), timing, 0, &pts)); // mismatched container delay
  assert(ResolveStarfishOpusPacketTime(Config(317), timing, 0, &pts) && pts == -6604);
  timing.codec_delay_samples = 312;
  timing.discard_front_us = 1000;
  assert(!ResolveStarfishOpusPacketTime(Config(), timing, 0, &pts));
  timing.discard_front_us = 0; timing.discard_back_us = 1000;
  assert(ResolveStarfishOpusPacketTime(Config(), timing, 0, &pts) && pts == -6500);
  timing.discard_back_us = 20001;
  assert(!ResolveStarfishOpusPacketTime(Config(), timing, 0, &pts));
  timing.discard_back_us = 0; timing.duration_us = 0;
  assert(!ResolveStarfishOpusPacketTime(Config(), timing, 0, &pts));
  timing.duration_us = 120001;
  assert(!ResolveStarfishOpusPacketTime(Config(), timing, 0, &pts));
  timing.duration_us = 60000;
  assert(ResolveStarfishOpusPacketTime(Config(), timing, 60000, &pts) && pts == 53500);
  timing.seek_preroll_us = 80001;
  assert(!ResolveStarfishOpusPacketTime(Config(), timing, 0, &pts));
}

void TestVideoConfigurationTransitions() {
  using Result = StarfishVideoConfiguration::UpdateResult;
  StarfishVideoConfiguration configuration;
  assert(!configuration.initialized());
  assert(configuration.Update(2560, 1440, true, 10, true) ==
         Result::kInitial);
  assert(configuration.initialized() && configuration.width() == 2560 &&
         configuration.height() == 1440 && configuration.hdr() &&
         configuration.bits() == 10);
  assert(configuration.Update(2560, 1440, true, 10, false) ==
         Result::kUnchanged);

  // Adaptive resolution changes are safe only at a compressed keyframe.
  assert(configuration.Update(3840, 2160, true, 10, false) ==
         Result::kResolutionChangeNeedsKeyframe);
  assert(configuration.width() == 2560 && configuration.height() == 1440);
  assert(configuration.Update(3840, 2160, true, 10, true) ==
         Result::kResolutionChanged);
  assert(configuration.width() == 3840 && configuration.height() == 2160);

  // Do not silently carry a live native session across SDR/HDR or bit-depth
  // changes until those transitions are independently validated on the TV.
  assert(configuration.Update(1920, 1080, false, 10, true) ==
         Result::kColorChanged);
  assert(configuration.Update(1920, 1080, true, 8, true) ==
         Result::kColorChanged);
  assert(configuration.width() == 3840 && configuration.height() == 2160 &&
         configuration.hdr() && configuration.bits() == 10);

  configuration.Reset();
  assert(!configuration.initialized());
  assert(configuration.Update(1920, 1080, false, 8, false) ==
         Result::kInitial);
}

using State = StarfishAvSessionState<std::shared_ptr<int>>;
using Stream = State::Stream;
using Enqueue = State::EnqueueResult;
using Feed = State::FeedResult;
const auto audio = Stream::kAudio;
const auto video = Stream::kVideo;
State::Packet Packet(size_t bytes, int64_t pts = 0) {
  return {std::make_shared<int>(42), bytes, pts};
}

void TestQueues() {
  State state({3, 12}, {2, 20});
  const auto generation = state.generation();
  assert(!state.ReadyToSubmitEos());
  assert(!state.NativeEnded(generation));
  assert(state.Enqueue(generation, audio, {}) == Enqueue::kInvalid);
  assert(state.Enqueue(generation, audio, {Packet(0)}) == Enqueue::kInvalid);
  assert(state.Enqueue(generation, audio, {{nullptr, 1, 0}}) == Enqueue::kInvalid);
  assert(state.Enqueue(generation, audio, {Packet(13)}) == Enqueue::kInvalid);
  assert(state.Enqueue(generation, audio, {Packet(7), Packet(6)}) == Enqueue::kInvalid);
  assert(state.queued_bytes(audio) == 0);
  assert(state.Enqueue(generation, audio, {Packet(1), Packet(1), Packet(1),
                                         Packet(1)}) == Enqueue::kInvalid);
  assert(state.Enqueue(generation, audio, {Packet(5, -6500)}) == Enqueue::kAccepted);
  assert(state.Enqueue(generation, audio, {Packet(4), Packet(4)}) == Enqueue::kFull);
  assert(state.queued_packets(audio) == 1);  // no partial batch admission
  assert(state.Enqueue(generation, audio, {Packet(3), Packet(4)}) == Enqueue::kAccepted);
  assert(state.queued_bytes(audio) == 12 && state.queued_packets(audio) == 3);
  assert(state.Enqueue(generation, audio, {Packet(1)}) == Enqueue::kFull);
  assert(state.Enqueue(generation, video, {Packet(20)}) == Enqueue::kAccepted);

  State::FeedTicket a{}, v{}, retry{};
  assert(state.NextFeed(video, &v));
  assert(state.CompleteFeed(v, Feed::kRetry));
  assert(state.NextFeed(video, &retry));
  assert(v.packet.buffer == retry.packet.buffer && v.sequence == retry.sequence);
  assert(state.queued_bytes(video) == 20);
  assert(state.NextFeed(audio, &a) && a.packet.pts_us == -6500);
  assert(state.CompleteFeed(a, Feed::kAccepted)); // video retry doesn't block audio
  assert(!state.CompleteFeed(a, Feed::kAccepted)); // duplicate completion
  assert(state.queued_bytes(audio) == 7);

  assert(state.WriteEos(generation, audio));
  assert(state.Enqueue(generation, audio, {Packet(1)}) == Enqueue::kClosed);
  assert(state.WriteEos(generation, video));
  assert(!state.ReadyToSubmitEos()); // queued data must reach native Feed first
  assert(state.CompleteFeed(v, Feed::kAccepted));
  while (state.NextFeed(audio, &a)) assert(state.CompleteFeed(a, Feed::kAccepted));
  assert(state.ReadyToSubmitEos());
  assert(!state.NativeEnded(generation)); // input drain is not presentation EOS
  assert(state.EosSubmitted(generation));
  assert(!state.ReadyToSubmitEos() && !state.EosSubmitted(generation));
  assert(state.NativeEnded(generation) && state.ended());
  assert(!state.NativeEnded(generation));
}

void TestGenerationsAndOwnership() {
  State state({4, 100}, {4, 100});
  State::FeedTicket old{};
  auto packet = Packet(10);
  std::weak_ptr<int> storage = packet.buffer;
  assert(state.Enqueue(state.generation(), audio, {packet}) == Enqueue::kAccepted);
  packet.buffer.reset();
  assert(state.NextFeed(audio, &old));
  const auto old_generation = state.generation();
  assert(state.Reset());
  assert(!storage.expired()); // pending native Feed still owns its input
  assert(state.queued_bytes(audio) == 0 && state.queued_packets(video) == 0);
  assert(state.Enqueue(state.generation(), audio, {Packet(9)}) == Enqueue::kAccepted);
  assert(!state.CompleteFeed(old, Feed::kAccepted));
  assert(!state.CompleteFeed(old, Feed::kError) && !state.failed());
  assert(state.queued_bytes(audio) == 9);
  assert(state.Enqueue(old_generation, video, {Packet(1)}) == Enqueue::kStale);
  assert(!state.WriteEos(old_generation, audio));
  assert(!state.EosSubmitted(old_generation));
  assert(!state.NativeEnded(old_generation));
  old.packet.buffer.reset();
  assert(storage.expired());

  State::FeedTicket current{};
  assert(state.NextFeed(audio, &current));
  assert(state.CompleteFeed(current, Feed::kError));
  assert(state.failed() && !state.NextFeed(audio, &current));
  assert(!state.WriteEos(state.generation(), audio));
  assert(state.Enqueue(state.generation(), video, {Packet(1)}) == Enqueue::kClosed);
  assert(!state.NativeEnded(state.generation()));
  assert(state.Reset() && !state.failed() && !state.ended());
  assert(state.Enqueue(state.generation(), video, {Packet(1)}) == Enqueue::kAccepted);

  State disabled({0, 0}, {1, 0});
  assert(disabled.Enqueue(disabled.generation(), audio, {Packet(1)}) == Enqueue::kInvalid);
  assert(disabled.Enqueue(disabled.generation(), video, {Packet(1)}) == Enqueue::kInvalid);
  State huge({2, std::numeric_limits<size_t>::max()}, {1, 1});
  assert(huge.Enqueue(huge.generation(), audio,
      {Packet(std::numeric_limits<size_t>::max()), Packet(1)}) == Enqueue::kInvalid);
}

}  // namespace

int main() {
  TestExperimentMode();
  TestConfiguration();
  TestTiming();
  TestCobaltAudioTiming();
  TestVideoConfigurationTransitions();
  TestQueues();
  TestGenerationsAndOwnership();
  std::cout << "Shared Starfish A/V timing and session-state tests passed\n";
}
