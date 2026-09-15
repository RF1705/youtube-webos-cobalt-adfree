#include "starboard/webos/arm/starfish_av_components.h"

#include <starfish-media-pipeline/StarfishMediaAPIs.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstdarg>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <sstream>
#include <thread>

#include "starboard/common/string.h"
#include "starboard/shared/starboard/player/job_queue.h"
#include "starboard/shared/starboard/player/filter/video_frame_internal.h"
#include "starboard/webos/arm/application_sdl.h"
#include "starboard/webos/arm/shared_av_experiment.h"
#include "starboard/webos/arm/starfish_audio_timing.h"
#include "starboard/webos/arm/starfish_av_session_state.h"
#include "starboard/webos/arm/starfish_video_configuration.h"

namespace starboard {
namespace shared {
namespace webos {
namespace {
namespace player = ::starboard::shared::starboard::player;
namespace filter = player::filter;
using State = StarfishAvSessionState<scoped_refptr<player::InputBuffer>>;
using Stream = State::Stream;
using Guard = std::lock_guard<std::mutex>;
constexpr SbTime kPoll = 10000;
constexpr SbTime kSecond = 1000000;
// 0 = available, 1 = owned, 2 = quarantined until process restart.
std::atomic<int> lease{0};
std::atomic<unsigned> trace_info_count{0};
std::atomic<unsigned> trace_essential_count{0};
bool TraceAllowed(bool essential) {
  auto& count = essential ? trace_essential_count : trace_info_count;
  const unsigned limit = essential ? 32 : 96;
  unsigned current = count.load();
  while (current < limit)
    if (count.compare_exchange_weak(current, current + 1)) return true;
  return false;
}

void TraceV(bool essential, const char* format, va_list args) {
  if (!TraceAllowed(essential)) return;
  char message[768];
  std::vsnprintf(message, sizeof(message), format, args);
  // At most 128 lines/process, with 32 reserved for selection, errors, unload
  // and EOS even after a long UHD session. Never called from firmware callbacks.
  std::fprintf(stderr, "[YTAF shared A/V monotonic_us=%lld] %s\n",
               static_cast<long long>(SbTimeGetMonotonicNow()), message);
  std::fflush(stderr);
}

void Trace(const char* format, ...) {
  va_list args;
  va_start(args, format);
  TraceV(false, format, args);
  va_end(args);
}

void TraceEssential(const char* format, ...) {
  va_list args;
  va_start(args, format);
  TraceV(true, format, args);
  va_end(args);
}

const char* CodecName(SbMediaVideoCodec codec) {
  switch (codec) {
    case kSbMediaVideoCodecH264: return "H264";
    case kSbMediaVideoCodecVp9: return "VP9";
    case kSbMediaVideoCodecAv1: return "AV1";
    default: return nullptr;
  }
}

bool IsHdrTransfer(SbMediaTransferId transfer) {
  return transfer == kSbMediaTransferIdSmpteSt2084 ||
         transfer == kSbMediaTransferIdAribStdB67;
}

bool IsVideoConfigurationSupported(SbMediaVideoCodec codec,
                                   const SbMediaVideoSampleInfo& info,
                                   int mode) {
  const bool uhd_codec = codec == kSbMediaVideoCodecVp9 ||
                         codec == kSbMediaVideoCodecAv1;
  if (codec != kSbMediaVideoCodecH264 && !(mode >= 2 && uhd_codec)) return false;
  const bool hdr = IsHdrTransfer(info.color_metadata.transfer);
  if ((hdr && mode < 3) || (hdr && info.color_metadata.bits_per_channel != 10 &&
                            info.color_metadata.bits_per_channel != 12)) return false;
  if (codec == kSbMediaVideoCodecH264 &&
      (hdr || info.color_metadata.bits_per_channel > 8)) return false;
  const int max_width = codec == kSbMediaVideoCodecH264 ? 1920 : 3840;
  const int max_height = codec == kSbMediaVideoCodecH264 ? 1080 : 2160;
  return info.frame_width > 0 && info.frame_height > 0 &&
         info.frame_width <= max_width && info.frame_height <= max_height;
}

bool IsFiniteAndPositive(float value) {
  return std::isfinite(value) && value > 0.0f;
}

int ScaleAndRound(float value, float scale) {
  return static_cast<int>(std::lround(value * scale));
}

void AppendJsonInteger(std::ostringstream* stream, bool* has_value,
                       const char* name, int value) {
  if (*has_value) *stream << ',';
  *stream << '\"' << name << "\":" << value;
  *has_value = true;
}

std::string BuildHdrInfoPayload(const SbMediaColorMetadata& metadata) {
  const char* hdr_type = metadata.transfer == kSbMediaTransferIdSmpteSt2084
                             ? "HDR10"
                         : metadata.transfer == kSbMediaTransferIdAribStdB67
                             ? "HLG"
                             : nullptr;
  if (!hdr_type) return std::string();

  const SbMediaMasteringMetadata& mastering = metadata.mastering_metadata;
  const bool has_primaries =
      IsFiniteAndPositive(mastering.primary_r_chromaticity_x) &&
      IsFiniteAndPositive(mastering.primary_r_chromaticity_y) &&
      IsFiniteAndPositive(mastering.primary_g_chromaticity_x) &&
      IsFiniteAndPositive(mastering.primary_g_chromaticity_y) &&
      IsFiniteAndPositive(mastering.primary_b_chromaticity_x) &&
      IsFiniteAndPositive(mastering.primary_b_chromaticity_y) &&
      IsFiniteAndPositive(mastering.white_point_chromaticity_x) &&
      IsFiniteAndPositive(mastering.white_point_chromaticity_y);
  const bool has_luminance = std::isfinite(mastering.luminance_min) &&
      mastering.luminance_min >= 0.0f &&
      IsFiniteAndPositive(mastering.luminance_max);
  if (!has_primaries && !has_luminance && metadata.max_cll == 0 &&
      metadata.max_fall == 0) return std::string();

  std::ostringstream sei;
  bool has_sei_value = false;
  if (has_primaries) {
    AppendJsonInteger(&sei, &has_sei_value, "displayPrimariesX0",
                      ScaleAndRound(mastering.primary_g_chromaticity_x, 50000));
    AppendJsonInteger(&sei, &has_sei_value, "displayPrimariesY0",
                      ScaleAndRound(mastering.primary_g_chromaticity_y, 50000));
    AppendJsonInteger(&sei, &has_sei_value, "displayPrimariesX1",
                      ScaleAndRound(mastering.primary_b_chromaticity_x, 50000));
    AppendJsonInteger(&sei, &has_sei_value, "displayPrimariesY1",
                      ScaleAndRound(mastering.primary_b_chromaticity_y, 50000));
    AppendJsonInteger(&sei, &has_sei_value, "displayPrimariesX2",
                      ScaleAndRound(mastering.primary_r_chromaticity_x, 50000));
    AppendJsonInteger(&sei, &has_sei_value, "displayPrimariesY2",
                      ScaleAndRound(mastering.primary_r_chromaticity_y, 50000));
    AppendJsonInteger(&sei, &has_sei_value, "whitePointX",
                      ScaleAndRound(mastering.white_point_chromaticity_x, 50000));
    AppendJsonInteger(&sei, &has_sei_value, "whitePointY",
                      ScaleAndRound(mastering.white_point_chromaticity_y, 50000));
  }
  if (has_luminance) {
    AppendJsonInteger(&sei, &has_sei_value, "minDisplayMasteringLuminance",
                      ScaleAndRound(mastering.luminance_min, 10000));
    AppendJsonInteger(&sei, &has_sei_value, "maxDisplayMasteringLuminance",
                      ScaleAndRound(mastering.luminance_max, 10000));
  }
  if (metadata.max_cll > 0)
    AppendJsonInteger(&sei, &has_sei_value, "maxContentLightLevel",
                      static_cast<int>(metadata.max_cll));
  if (metadata.max_fall > 0)
    AppendJsonInteger(&sei, &has_sei_value, "maxPicAverageLightLevel",
                      static_cast<int>(metadata.max_fall));

  std::ostringstream payload;
  payload << "{\"hdrType\":\"" << hdr_type << "\",\"sei\":{" << sei.str()
          << "},\"vui\":{\"transferCharacteristics\":"
          << static_cast<int>(metadata.transfer) << ",\"colorPrimaries\":"
          << static_cast<int>(metadata.primaries) << ",\"matrixCoeffs\":"
          << static_cast<int>(metadata.matrix) << ",\"videoFullRangeFlag\":"
          << (metadata.range == kSbMediaRangeIdFull ? "true" : "false") << "}}";
  return payload.str();
}

std::string Base64(const std::array<uint8_t, 19>& data) {
  const char* alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  for (size_t i = 0; i < data.size(); i += 3) {
    const unsigned bits = (unsigned(data[i]) << 16) |
        (i + 1 < data.size() ? unsigned(data[i + 1]) << 8 : 0) |
        (i + 2 < data.size() ? data[i + 2] : 0);
    out += alphabet[(bits >> 18) & 63]; out += alphabet[(bits >> 12) & 63];
    out += i + 1 < data.size() ? alphabet[(bits >> 6) & 63] : '=';
    out += i + 2 < data.size() ? alphabet[bits & 63] : '=';
  }
  return out;
}

// The callback only touches this context, never an Owner, queue or SDL object.
// Keep it alive through API destruction, including a rejected Load. If Unload
// completion is absent, retain ONE context/API/window for process lifetime.
struct NativeSession {
  struct Backpressure {
    SbTime started = 0;
    SbTime last_trace = 0;
    unsigned total_retries = 0;
    unsigned bursts = 0;
    unsigned traced_retries = 0;
    unsigned traced_bursts = 0;
    unsigned buffer_full = 0;
    unsigned pending = 0;
    SbTime total_duration = 0;
    SbTime max_duration = 0;
    size_t max_queued_packets = 0;
    size_t max_queued_bytes = 0;
  };

  explicit NativeSession(uint64_t id) : generation(id) {}
  const uint64_t generation;
  std::atomic<bool> loaded{false}, unloaded{false}, failed{false}, ended{false};
  std::atomic<int64_t> frame_ns{-1};
  std::atomic<int> error_type{0};
  std::atomic<int64_t> error_value{0};
  std::unique_ptr<StarfishMediaAPIs> api;
  StarfishOpusSessionPlan plan;
  bool window = false, audio_fed = false, video_fed = false;
  bool playing = false, was_loaded = false;
  double rate = 1, volume = -1;
  SbTime created = SbTimeGetMonotonicNow(), last_play_attempt = 0;
  SbTime last_progress = created, last_frame = -1;
  StarfishVideoConfiguration video_configuration;
  Backpressure audio_backpressure, video_backpressure;
  std::string applied_hdr_payload;
  bool hdr_auto_logged = false;

  static void Callback(int type, int64_t value, const char*, void* context) {
    auto* self = static_cast<NativeSession*>(context);
    switch (type) {
      case PF_EVENT_TYPE_FRAMEREADY: self->frame_ns.store(value); break;
      case PF_EVENT_TYPE_STR_STATE_UPDATE__LOADCOMPLETED: self->loaded.store(true); break;
      case PF_EVENT_TYPE_STR_STATE_UPDATE__UNLOADCOMPLETED: self->unloaded.store(true); break;
      case PF_EVENT_TYPE_STR_STATE_UPDATE__ENDOFSTREAM: self->ended.store(true); break;
      case PF_EVENT_TYPE_INT_ERROR:
      case PF_EVENT_TYPE_STR_ERROR:
        self->error_type.store(type); self->error_value.store(value);
        self->failed.store(true); break;
      default: break;
    }
  }
};

class Owner : public player::JobQueue::JobOwner {
 public:
  Owner(const filter::PlayerComponents::Factory::CreationParameters& parameters,
        const StarfishOpusConfig& config, int mode)
      : player_(parameters.player()), config_(config),
        video_codec_(parameters.video_codec()), mode_(mode),
        state_({256, 1024 * 1024}, {128, 8 * 1024 * 1024}) {
    api_thread_ = std::thread([this] { Run(); });
    Schedule([this] { PollWorker(); }, kPoll);
  }
  ~Owner() {
    CancelPendingJobs();
    { Guard guard(mutex_); stopping_ = true; }
    wake_.notify_one();
    api_thread_.join();
    if (lease.load() != 2) lease.store(0);
  }

  void Initialize(Stream stream, const filter::ErrorCB& error,
                  const filter::PrerolledCB& preroll, const filter::EndedCB& end) {
    Guard guard(mutex_);
    error_cb_ = error;
    (stream == Stream::kAudio ? audio_preroll_ : video_preroll_) = preroll;
    (stream == Stream::kAudio ? audio_end_ : video_end_) = end;
  }
  void Write(Stream stream, const player::InputBuffers& buffers) {
    Guard guard(mutex_);
    std::vector<State::Packet> packets;
    StarfishVideoConfiguration next_video_configuration =
        queued_video_configuration_;
    for (const auto& buffer : buffers) {
      if (!buffer || buffer->size() <= 0 || buffer->drm_info() ||
          buffer->sample_type() != (stream == Stream::kAudio ? kSbMediaTypeAudio : kSbMediaTypeVideo)) {
        FailLocked("invalid/encrypted shared A/V input"); return;
      }
      SbTime pts = buffer->timestamp();
      if (pts < 0 || pts > std::numeric_limits<int64_t>::max() / 1000) {
        FailLocked("unsupported raw packet timestamp"); return;
      }
      if (stream == Stream::kAudio) {
        const auto& info = buffer->audio_sample_info();
        StarfishOpusConfig config;
        StarfishAudioTiming timing;
        const auto& wire = buffer->webos_audio_timing();
        if (info.codec != kSbMediaAudioCodecOpus ||
            !StarfishOpusConfig::Parse(info.audio_specific_config,
                info.audio_specific_config_size, info.number_of_channels,
                info.samples_per_second, &config) || config.header != config_.header ||
            !StarfishAudioTiming::Decode(wire.data(), wire.size(), &timing)) {
          FailLocked(FormatString("unsupported/missing Opus config or timing side data (size=%zu)", wire.size()));
          return;
        }
        if (!ResolveStarfishOpusPacketTime(config_, timing, pts, &pts)) {
          FailLocked(FormatString("unsupported Opus timing: pts=%lld delay=%lld head=%u front=%lld back=%lld duration=%lld preroll=%lld",
              static_cast<long long>(pts), static_cast<long long>(timing.codec_delay_samples),
              config_.pre_skip_samples(), static_cast<long long>(timing.discard_front_us),
              static_cast<long long>(timing.discard_back_us), static_cast<long long>(timing.duration_us),
              static_cast<long long>(timing.seek_preroll_us)));
          return;
        }
        if (timing.discard_back_us > 0) {
          Trace("accepting Opus end padding without native clipping: back_us=%lld duration_us=%lld",
                static_cast<long long>(timing.discard_back_us),
                static_cast<long long>(timing.duration_us));
        }
        // WebM block PTS and MSE timestampOffset remain in the container
        // timeline. Codec delay is separate; convert BOTH seek planning and
        // subsequent audio Feed timestamps, not just the first packet.
      } else {
        const auto& info = buffer->video_sample_info();
        if (info.codec != video_codec_ ||
            !IsVideoConfigurationSupported(video_codec_, info, mode_)) {
          FailLocked("unsupported shared A/V video configuration"); return;
        }
        const bool hdr = IsHdrTransfer(info.color_metadata.transfer);
        const auto configuration_result = next_video_configuration.Update(
            info.frame_width, info.frame_height, hdr,
            info.color_metadata.bits_per_channel, info.is_key_frame);
        if (configuration_result ==
            StarfishVideoConfiguration::UpdateResult::kColorChanged) {
          FailLocked("shared A/V color configuration change requires a new player");
          return;
        }
        if (configuration_result == StarfishVideoConfiguration::UpdateResult::
                                        kResolutionChangeNeedsKeyframe) {
          FailLocked("shared A/V resolution change requires a video keyframe");
          return;
        }
        if (hdr) hdr_payload_ = BuildHdrInfoPayload(info.color_metadata);
        if (!first_video_ && packets.empty() && !info.is_key_frame) {
          FailLocked("shared A/V restart needs a video keyframe"); return;
        }
      }
      packets.push_back({buffer, static_cast<size_t>(buffer->size()), pts});
    }
    const auto result = state_.Enqueue(state_.generation(), stream, packets);
    if (result != State::EnqueueResult::kAccepted) {
      FailLocked("shared A/V input batch exceeds queue budget or arrived after EOS"); return;
    }
    if (stream == Stream::kVideo)
      queued_video_configuration_ = next_video_configuration;
    if (stream == Stream::kAudio && !first_audio_) {
      first_audio_ = true; first_audio_pts_ = packets.front().pts_us;
      audio_origin_ = packets.front().buffer->timestamp() == 0;
      Trace("first-input generation=%llu stream=audio pts_us=%lld wait_us=%lld packets=%zu",
            static_cast<unsigned long long>(state_.generation()),
            static_cast<long long>(first_audio_pts_),
            static_cast<long long>(SbTimeGetMonotonicNow() - input_wait_started_),
            packets.size());
    }
    if (stream == Stream::kVideo && !first_video_) {
      first_video_ = true; first_video_pts_ = packets.front().pts_us;
      width_ = packets.front().buffer->video_sample_info().frame_width;
      height_ = packets.front().buffer->video_sample_info().frame_height;
      video_hdr_ = IsHdrTransfer(
          packets.front().buffer->video_sample_info().color_metadata.transfer);
      video_bits_ =
          packets.front().buffer->video_sample_info().color_metadata.bits_per_channel;
      Trace("first-input generation=%llu stream=video pts_us=%lld wait_us=%lld packets=%zu",
            static_cast<unsigned long long>(state_.generation()),
            static_cast<long long>(first_video_pts_),
            static_cast<long long>(SbTimeGetMonotonicNow() - input_wait_started_),
            packets.size());
    }
    wake_.notify_one();
  }
  bool CanAccept(Stream stream) const {
    Guard guard(mutex_);
    // Leave headroom for the next batch. Write validates exact bytes/counts.
    return error_.empty() && !(stream == Stream::kAudio ? audio_eos_ : video_eos_) &&
        state_.queued_packets(stream) < (stream == Stream::kAudio ? 128u : 64u) &&
        state_.queued_bytes(stream) < (stream == Stream::kAudio ? 512u * 1024 : 4u * 1024 * 1024);
  }
  void Eos(Stream stream) {
    Guard guard(mutex_);
    state_.WriteEos(state_.generation(), stream);
    (stream == Stream::kAudio ? audio_eos_ : video_eos_) = true;
    if (!first_audio_ || !first_video_)
      FailLocked("shared A/V EOS before both initial packets");
    wake_.notify_one();
  }
  bool EosWritten(Stream stream) const {
    Guard guard(mutex_); return stream == Stream::kAudio ? audio_eos_ : video_eos_;
  }
  bool Ended() const { Guard guard(mutex_); return state_.ended(); }
  void Seek(SbTime target) {
    Guard guard(mutex_);
    if (target < 0 || target > std::numeric_limits<int64_t>::max() / 1000 ||
        !state_.Reset() || lease.load() == 2) {
      FailLocked("invalid shared A/V reset"); return;
    }
    target_ = current_ = target;
    input_wait_started_ = SbTimeGetMonotonicNow();
    audio_eos_ = video_eos_ = first_audio_ = first_video_ = false;
    queued_video_configuration_.Reset();
    video_hdr_ = false; video_bits_ = 0; hdr_payload_.clear();
    ready_ = preroll_sent_ = end_sent_ = playing_ = have_frame_ = false;
    bounds_dirty_ = true;
    error_.clear(); error_sent_ = false;
    wake_.notify_one();
  }
  void Pause(bool paused) { Guard guard(mutex_); paused_ = paused; wake_.notify_one(); }
  void Rate(double rate) {
    Guard guard(mutex_);
    if (!std::isfinite(rate) || rate < 0 || rate > 2 || (rate > 0 && rate < 0.1))
      FailLocked("unsupported shared A/V rate (supported: 0 or 0.1–2x)");
    else rate_ = rate;
    wake_.notify_one();
  }
  void Volume(double volume) {
    Guard guard(mutex_);
    if (!std::isfinite(volume) || volume < 0 || volume > 1)
      FailLocked("invalid shared A/V volume");
    else volume_ = volume;
    wake_.notify_one();
  }
  SbTime Time(bool* playing, bool* eos, bool* underflow, double* rate) {
    Guard guard(mutex_);
    *playing = playing_ && !paused_ && rate_ > 0 && error_.empty() && !state_.ended();
    *eos = state_.ended(); *rate = rate_;
    *underflow = *playing && (!have_frame_ || SbTimeGetMonotonicNow() - frame_time_ > kSecond);
    return current_; // One native presentation position; no second audio clock.
  }
  void Bounds(int z, int x, int y, int width, int height) {
    Guard guard(mutex_);
    z_ = z; x_ = x; y_ = y; bounds_width_ = width; bounds_height_ = height;
    bounds_dirty_ = true; wake_.notify_one();
  }

 private:
  void FailLocked(const std::string& error) {
    if (error_.empty()) error_ = error;
  }
  void Fail(const std::string& error) { Guard guard(mutex_); FailLocked(error); }
  void FailSession(const NativeSession& session, const std::string& error) {
    Guard guard(mutex_);
    if (state_.generation() == session.generation) FailLocked(error);
  }
  bool Current(uint64_t generation) const {
    Guard guard(mutex_);
    return !stopping_ && error_.empty() && state_.generation() == generation;
  }
  void PollWorker() {
    filter::ErrorCB error;
    filter::PrerolledCB audio_preroll, video_preroll;
    filter::EndedCB audio_end, video_end;
    std::string message;
    uint64_t generation;
    {
      Guard guard(mutex_);
      generation = state_.generation();
      if (!error_.empty() && !error_sent_ && error_cb_) {
        error_sent_ = true; error = error_cb_; message = error_;
      } else if (error_.empty() && ready_ && !preroll_sent_ && audio_preroll_ && video_preroll_) {
        preroll_sent_ = true; audio_preroll = audio_preroll_; video_preroll = video_preroll_;
      } else if (error_.empty() && state_.ended() && !end_sent_ && audio_end_ && video_end_) {
        end_sent_ = true; audio_end = audio_end_; video_end = video_end_;
      }
    }
    Schedule([this] { PollWorker(); }, kPoll);
    if (error) {
      TraceEssential("error: %s", message.c_str());
      error(kSbPlayerErrorDecode, message); return;
    }
    if (audio_preroll) audio_preroll();
    if (video_preroll && Current(generation)) video_preroll();
    if (audio_end) audio_end();
    if (video_end && Current(generation)) video_end();
  }

  bool Close(std::unique_ptr<NativeSession>& session) {
    if (!session) return true;
    ApplicationSdl::Get()->SetVideoPaused(true);
    session->api->notifyBackground();
    const bool accepted = session->api->Unload();
    const auto deadline = SbTimeGetMonotonicNow() + 3 * kSecond;
    while (!session->unloaded.load() && SbTimeGetMonotonicNow() < deadline)
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
    if (!session->unloaded.load()) {
      // No owner pointer in the callback. One retained context, not one leak
      // per seek. No more player components may start until Cobalt restarts.
      lease.store(2);
      session.release();
      Fail("Starfish Unload completion missing; native session quarantined until restart");
      return false;
    }
    session->api.reset(); // callback context remains live during destruction
    if (session->window) ApplicationSdl::Get()->ReleaseExportedVideoWindow();
    const SbTime now = SbTimeGetMonotonicNow();
    const NativeSession::Backpressure& audio = session->audio_backpressure;
    const NativeSession::Backpressure& video = session->video_backpressure;
    const SbTime audio_active =
        audio.started == 0 ? 0 : std::max<SbTime>(0, now - audio.started);
    const SbTime video_active =
        video.started == 0 ? 0 : std::max<SbTime>(0, now - video.started);
    TraceEssential("unloaded generation=%llu accepted=%d audio={retries=%u bursts=%u pressure_us=%lld max_us=%lld full=%u pending=%u} video={retries=%u bursts=%u pressure_us=%lld max_us=%lld full=%u pending=%u max_queue=%zu/%zu}",
          static_cast<unsigned long long>(session->generation), accepted,
          audio.total_retries, audio.bursts,
          static_cast<long long>(audio.total_duration + audio_active),
          static_cast<long long>(std::max(audio.max_duration, audio_active)),
          audio.buffer_full, audio.pending, video.total_retries, video.bursts,
          static_cast<long long>(video.total_duration + video_active),
          static_cast<long long>(std::max(video.max_duration, video_active)),
          video.buffer_full, video.pending, video.max_queued_packets,
          video.max_queued_bytes);
    session.reset();
    return true;
  }

  std::unique_ptr<NativeSession> Start(uint64_t generation) {
    StarfishOpusSessionPlan plan;
    SbTime target, first_audio, first_video;
    int width, height;
    unsigned bits;
    bool hdr;
    {
      Guard guard(mutex_);
      if (!first_audio_ || !first_video_ || !error_.empty() ||
          state_.generation() != generation) return nullptr;
      target = target_; first_audio = first_audio_pts_; first_video = first_video_pts_;
      width = width_; height = height_; bits = video_bits_; hdr = video_hdr_;
      if (!PlanStarfishOpusSession(config_, first_audio, first_video, target,
                                  audio_origin_, &plan)) {
        FailLocked("cannot plan shared Opus restart: timestamp/pre-roll outside supported range");
        return nullptr;
      }
    }
    std::unique_ptr<NativeSession> session(new NativeSession(generation));
    session->plan = plan;
    session->video_configuration.Update(width, height, hdr, bits, true);
    session->api.reset(new StarfishMediaAPIs());
    session->window = ApplicationSdl::Get()->AcquireExportedVideoWindow();
    if (!session->window) {
      FailSession(*session, "cannot acquire shared A/V video window"); return nullptr;
    }
    ApplicationSdl::Get()->SetVideoPaused(true);
    ApplicationSdl::Get()->SetVideoResolution(width, height);
    ApplicationSdl::Get()->ConfigureFullscreenVideo();
    const std::string window = ApplicationSdl::Get()->GetExportedWindowId();
    const char* codec_name = CodecName(video_codec_);
    const int max_width = video_codec_ == kSbMediaVideoCodecH264 ? 1920 : 3840;
    const int max_height = video_codec_ == kSbMediaVideoCodecH264 ? 1080 : 2160;
    // Window ID is generated by SDL; app ID stays fixed, not unescaped input.
    const std::string payload = FormatString(
        "{\"args\":[{\"mediaTransportType\":\"BUFFERSTREAM\",\"option\":{"
        "\"appId\":\"youtube.leanback.v4\",\"windowId\":\"%s\",\"queryPosition\":false,"
        "\"externalStreamingInfo\":{\"contents\":{\"format\":\"RAW\",\"provider\":\"Chrome\","
        "\"codec\":{\"video\":\"%s\",\"audio\":\"OPUS\"},"
        "\"esInfo\":{\"pauseAtDecodeTime\":false,\"seperatedPTS\":true,\"ptsToDecode\":%lld,"
        "\"videoWidth\":%d,\"videoHeight\":%d,\"videoFpsValue\":60,\"videoFpsScale\":1},"
        "\"opusInfo\":{\"channels\":%u,\"sampleRate\":48,\"streamHeader\":\"%s\"}},"
        "\"restartStreaming\":false,\"totalStreamSize\":256,\"bufferingCtrInfo\":{"
        "\"srcBufferLevelAudio\":{\"minimum\":1024,\"maximum\":1048576},"
        "\"srcBufferLevelVideo\":{\"minimum\":1024,\"maximum\":8388608}}},"
        "\"adaptiveStreaming\":{\"audioOnly\":false,\"adaptiveResolution\":true,"
        "\"maxWidth\":%d,\"maxHeight\":%d,\"maxFrameRate\":60}}}]}",
        window.c_str(), codec_name,
        static_cast<long long>(plan.target_native_us * 1000), width, height,
        unsigned(config_.header[9]), Base64(plan.config.header).c_str(),
        max_width, max_height);
    Trace("load generation=%llu codec=%s size=%dx%d bits=%u hdr=%d target_us=%lld audio_us=%lld video_us=%lld epoch_us=%lld discard_samples=%u",
          static_cast<unsigned long long>(generation), codec_name, width, height, bits, hdr,
          static_cast<long long>(target),
          static_cast<long long>(first_audio), static_cast<long long>(first_video),
          static_cast<long long>(plan.epoch_us), plan.discard_samples);
    session->api->notifyForeground();
    if (!session->api->Load(payload.c_str(), NativeSession::Callback, session.get()))
      FailSession(*session, "shared Starfish Load rejected");
    // Even rejected Load may have installed callbacks: caller always unloads.
    return session;
  }

  void Feed(NativeSession& session, Stream stream) {
    for (unsigned i = 0; i < 8 && Current(session.generation); ++i) {
      State::FeedTicket ticket{};
      {
        Guard guard(mutex_);
        if (!state_.NextFeed(stream, &ticket)) return;
        // Bounded input lookahead only; never a second presentation clock.
        if (ticket.packet.pts_us > current_ + 5 * kSecond) return;
      }
      if (ticket.generation != session.generation) return;
      if (stream == Stream::kVideo) {
        const auto& info = ticket.packet.buffer->video_sample_info();
        const int old_width = session.video_configuration.width();
        const int old_height = session.video_configuration.height();
        const auto configuration_result = session.video_configuration.Update(
            info.frame_width, info.frame_height,
            IsHdrTransfer(info.color_metadata.transfer),
            info.color_metadata.bits_per_channel, info.is_key_frame);
        if (configuration_result == StarfishVideoConfiguration::UpdateResult::
                                        kResolutionChanged) {
          ApplicationSdl::Get()->SetVideoResolution(info.frame_width,
                                                    info.frame_height);
          ApplicationSdl::Get()->ConfigureFullscreenVideo();
          Trace("resolution-change generation=%llu old=%dx%d new=%dx%d pts_us=%lld",
                static_cast<unsigned long long>(session.generation), old_width,
                old_height, info.frame_width, info.frame_height,
                static_cast<long long>(ticket.packet.pts_us));
        } else if (configuration_result !=
                   StarfishVideoConfiguration::UpdateResult::kUnchanged) {
          FailSession(session,
                      "queued shared A/V video configuration became invalid");
          return;
        }
      }
      int64_t pts_ns;
      if (!session.plan.ToNativeNanoseconds(ticket.packet.pts_us, &pts_ns)) {
        FailSession(session, "packet predates shared epoch or overflows native PTS"); return;
      }
      const auto payload = FormatString(
          "{\"bufferAddr\":\"%p\",\"bufferSize\":%zu,\"pts\":%lld,\"esData\":%d}",
          static_cast<const void*>(ticket.packet.buffer->data()), ticket.packet.bytes,
          static_cast<long long>(pts_ns), stream == Stream::kVideo ? 1 : 2);
      const std::string response = session.api->Feed(payload.c_str());
      const auto result = response.find("Ok") != std::string::npos ? State::FeedResult::kAccepted :
          response.find("BufferFull") != std::string::npos || response.find("Pending") != std::string::npos ?
          State::FeedResult::kRetry : State::FeedResult::kError;
      size_t queued_packets = 0;
      size_t queued_bytes = 0;
      {
        Guard guard(mutex_);
        if (!state_.CompleteFeed(ticket, result)) return;
        if (result == State::FeedResult::kError) FailLocked("shared Starfish Feed rejected");
        queued_packets = state_.queued_packets(stream);
        queued_bytes = state_.queued_bytes(stream);
      }
      NativeSession::Backpressure& pressure =
          stream == Stream::kAudio ? session.audio_backpressure
                                   : session.video_backpressure;
      const SbTime now = SbTimeGetMonotonicNow();
      if (result == State::FeedResult::kAccepted) {
        (stream == Stream::kAudio ? session.audio_fed : session.video_fed) = true;
        if (pressure.started != 0) {
          const SbTime duration = std::max<SbTime>(0, now - pressure.started);
          pressure.total_duration += duration;
          pressure.max_duration = std::max(pressure.max_duration, duration);
          pressure.started = 0;
        }
      } else if (result == State::FeedResult::kRetry) {
        const bool buffer_full =
            response.find("BufferFull") != std::string::npos;
        ++pressure.total_retries;
        buffer_full ? ++pressure.buffer_full : ++pressure.pending;
        pressure.max_queued_packets =
            std::max(pressure.max_queued_packets, queued_packets);
        pressure.max_queued_bytes =
            std::max(pressure.max_queued_bytes, queued_bytes);
        if (pressure.started == 0) {
          pressure.started = now;
          ++pressure.bursts;
        }
        // The limiter deliberately persists across recovered bursts. At UHD,
        // logging the start and end of every short BufferFull interval can use
        // the entire process trace budget before a seek, transition or EOS.
        if (pressure.last_trace == 0) pressure.last_trace = now;
        if (now - pressure.last_trace >= 60 * kSecond) {
          const SbTime active = std::max<SbTime>(0, now - pressure.started);
          pressure.last_trace = now;
          Trace("feed-backpressure-summary generation=%llu stream=%s window_retries=%u total_retries=%u window_bursts=%u total_bursts=%u active_us=%lld pressure_us=%lld max_us=%lld queued=%zu/%zu peak=%zu/%zu full=%u pending=%u",
                static_cast<unsigned long long>(session.generation),
                stream == Stream::kAudio ? "audio" : "video",
                pressure.total_retries - pressure.traced_retries,
                pressure.total_retries,
                pressure.bursts - pressure.traced_bursts, pressure.bursts,
                static_cast<long long>(active),
                static_cast<long long>(pressure.total_duration + active),
                static_cast<long long>(std::max(pressure.max_duration, active)),
                queued_packets, queued_bytes, pressure.max_queued_packets,
                pressure.max_queued_bytes, pressure.buffer_full,
                pressure.pending);
          pressure.traced_retries = pressure.total_retries;
          pressure.traced_bursts = pressure.bursts;
        }
        return;
      }
    }
  }

  void Step(NativeSession& session) {
    if (session.failed.load()) {
      FailSession(session, FormatString("shared Starfish error type=%d value=%lld", session.error_type.load(),
                        static_cast<long long>(session.error_value.load()))); return;
    }
    bool paused, hdr_expected;
    double rate, volume;
    std::string hdr_payload;
    {
      Guard guard(mutex_);
      paused = paused_ || rate_ == 0; rate = rate_; volume = volume_;
      hdr_expected = video_hdr_; hdr_payload = hdr_payload_;
    }
    // Feed while initially paused too, so the worker can finish preroll without
    // an unsolicited Play. Never Play just to obtain LOADCOMPLETED/first frame.
    Feed(session, Stream::kAudio); Feed(session, Stream::kVideo);
    if (!Current(session.generation)) return;
    {
      Guard guard(mutex_);
      if (state_.generation() != session.generation) return;
      ready_ = session.audio_fed && session.video_fed;
    }
    const auto now = SbTimeGetMonotonicNow();
    const bool loaded = session.loaded.load();
    if (loaded && !session.was_loaded)
      Trace("load-completed generation=%llu", static_cast<unsigned long long>(session.generation));
    if (loaded && hdr_expected && hdr_payload.empty() && !session.hdr_auto_logged) {
      session.hdr_auto_logged = true;
      Trace("HDR metadata unavailable generation=%llu; using elementary-stream detection",
            static_cast<unsigned long long>(session.generation));
    } else if (loaded && !hdr_payload.empty() &&
               hdr_payload != session.applied_hdr_payload) {
      const bool accepted = session.api->setHdrInfo(hdr_payload.c_str());
      session.applied_hdr_payload = hdr_payload;
      Trace("HDR metadata generation=%llu accepted=%d",
            static_cast<unsigned long long>(session.generation), accepted);
    }
    if (loaded && volume != session.volume) {
      const auto payload = FormatString("{\"volume\":%d}", int(std::lround(volume * 100)));
      if (!session.api->setVolume(payload.c_str())) { FailSession(session, "shared volume rejected"); return; }
      session.volume = volume;
    }
    if (loaded && rate > 0 && rate != session.rate) {
      const auto payload = FormatString("{\"playRate\":%.6g,\"audioOutput\":true}", rate);
      if (!session.api->SetPlayRate(payload.c_str())) { FailSession(session, "shared rate rejected"); return; }
      session.rate = rate;
    }
    if (paused && session.playing) {
      if (!session.api->Pause()) { FailSession(session, "shared Pause rejected"); return; }
      session.playing = false;
      Trace("paused generation=%llu", static_cast<unsigned long long>(session.generation));
      ApplicationSdl::Get()->SetVideoPaused(true);
    } else if (!paused && session.audio_fed && session.video_fed &&
               ((!session.playing && now - session.last_play_attempt >= 250000) ||
                (loaded && !session.was_loaded))) {
      const bool first_attempt = session.last_play_attempt == 0;
      session.last_play_attempt = now;
      session.playing = session.api->Play();
      if (first_attempt || session.playing)
        Trace("play generation=%llu accepted=%d loaded=%d",
              static_cast<unsigned long long>(session.generation), session.playing, loaded);
      if (session.playing) ApplicationSdl::Get()->SetVideoPaused(false);
    }
    session.was_loaded = loaded;
    const int64_t frame_ns = session.frame_ns.load();
    const bool new_frame = frame_ns >= 0 && frame_ns != session.last_frame;
    if (new_frame) {
      if (session.last_frame < 0)
        Trace("first-frame generation=%llu native_ns=%lld presentation_us=%lld",
              static_cast<unsigned long long>(session.generation), static_cast<long long>(frame_ns),
              static_cast<long long>(frame_ns / 1000 - session.plan.epoch_us));
      session.last_progress = now; session.last_frame = frame_ns;
    }
    if (paused) session.last_progress = now;
    bool submit_eos = false;
    {
      Guard guard(mutex_);
      if (state_.generation() != session.generation) return;
      playing_ = session.playing;
      if (new_frame) {
        current_ = std::max(current_, frame_ns / 1000 - session.plan.epoch_us);
        have_frame_ = true; frame_time_ = now;
      }
      submit_eos = state_.ReadyToSubmitEos();
    }
    if (submit_eos) {
      const bool accepted = session.api->pushEOS();
      TraceEssential("push-eos generation=%llu accepted=%d",
            static_cast<unsigned long long>(session.generation), accepted);
      Guard guard(mutex_);
      if (state_.generation() != session.generation) return;
      if (accepted) state_.EosSubmitted(session.generation);
      else FailLocked("shared pushEOS rejected");
    }
    if (session.ended.load()) {
      bool newly_ended = false;
      {
        Guard guard(mutex_);
        if (state_.generation() == session.generation && !state_.ended()) {
          newly_ended = state_.NativeEnded(session.generation);
          if (!newly_ended)
            FailLocked("unexpected shared native EOS before input drain");
        }
      }
      if (newly_ended)
        TraceEssential("native-eos generation=%llu",
              static_cast<unsigned long long>(session.generation));
      ApplicationSdl::Get()->SetVideoPaused(true);
    } else if (!paused && now - session.last_progress > 20 * kSecond) {
      FailSession(session, "shared A/V presentation stalled for 20 seconds");
    }
    int z, x, y, width, height;
    {
      Guard guard(mutex_);
      if (!bounds_dirty_) return;
      bounds_dirty_ = false;
      z = z_; x = x_; y = y_; width = bounds_width_; height = bounds_height_;
    }
    if (width > 0 && height > 0)
      ApplicationSdl::Get()->HandleFrame(player_, scoped_refptr<filter::VideoFrame>(), z, x, y, width, height);
  }

  void Run() {
    std::unique_ptr<NativeSession> session;
    for (;;) {
      bool stop, failed; uint64_t generation;
      {
        Guard guard(mutex_);
        stop = stopping_; failed = !error_.empty(); generation = state_.generation();
      }
      if (session && (stop || failed || generation != session->generation)) {
        if (!Close(session)) break;
      }
      if (stop) break;
      if (!failed && !session) session = Start(generation);
      if (session && Current(session->generation)) Step(*session);
      std::unique_lock<std::mutex> lock(mutex_);
      wake_.wait_for(lock, std::chrono::milliseconds(10));
    }
    // Close has either destroyed the API with live callback context or retained
    // it in quarantine. Synchronous vendor API calls themselves have no cancel
    // API; the 3-second deadline bounds callback waiting, NOT a hung API call.
  }

  const SbPlayer player_;
  const StarfishOpusConfig config_;
  const SbMediaVideoCodec video_codec_;
  const int mode_;
  mutable std::mutex mutex_;
  std::condition_variable wake_;
  State state_;
  StarfishVideoConfiguration queued_video_configuration_;
  std::thread api_thread_;
  bool stopping_ = false, paused_ = true, playing_ = false;
  bool audio_eos_ = false, video_eos_ = false, first_audio_ = false, first_video_ = false;
  bool audio_origin_ = false, ready_ = false, preroll_sent_ = false, end_sent_ = false;
  bool error_sent_ = false, have_frame_ = false, bounds_dirty_ = true;
  bool video_hdr_ = false;
  SbTime target_ = 0, current_ = 0, first_audio_pts_ = 0, first_video_pts_ = 0, frame_time_ = 0;
  SbTime input_wait_started_ = SbTimeGetMonotonicNow();
  int width_ = 0, height_ = 0, z_ = 0, x_ = 0, y_ = 0, bounds_width_ = 0, bounds_height_ = 0;
  unsigned video_bits_ = 0;
  double rate_ = 1, volume_ = 1;
  std::string error_;
  std::string hdr_payload_;
  filter::ErrorCB error_cb_;
  filter::PrerolledCB audio_preroll_, video_preroll_;
  filter::EndedCB audio_end_, video_end_;
};

class Audio : public filter::AudioRenderer {
 public:
  explicit Audio(Owner* owner) : owner_(owner) {}
  void Initialize(const ErrorCB& e, const PrerolledCB& p, const EndedCB& end) override {
    owner_->Initialize(Stream::kAudio, e, p, end);
  }
  void WriteSamples(const InputBuffers& buffers) override { owner_->Write(Stream::kAudio, buffers); }
  void WriteEndOfStream() override { owner_->Eos(Stream::kAudio); }
  void SetVolume(double volume) override { owner_->Volume(volume); }
  bool IsEndOfStreamWritten() const override { return owner_->EosWritten(Stream::kAudio); }
  bool IsEndOfStreamPlayed() const override { return owner_->Ended(); }
  bool CanAcceptMoreData() const override { return owner_->CanAccept(Stream::kAudio); }
 private: Owner* owner_;
};
class Video : public filter::VideoRenderer {
 public:
  explicit Video(Owner* owner) : owner_(owner) {}
  void Initialize(const filter::ErrorCB& e, const filter::PrerolledCB& p,
                  const filter::EndedCB& end) override { owner_->Initialize(Stream::kVideo, e, p, end); }
  int GetDroppedFrames() const override { return 0; }
  void WriteSamples(const player::InputBuffers& buffers) override { owner_->Write(Stream::kVideo, buffers); }
  void WriteEndOfStream() override { owner_->Eos(Stream::kVideo); }
  void Seek(SbTime) override {} // Worker calls MediaTimeProvider::Seek next: reset only once.
  bool IsEndOfStreamWritten() const override { return owner_->EosWritten(Stream::kVideo); }
  bool CanAcceptMoreData() const override { return owner_->CanAccept(Stream::kVideo); }
  void SetBounds(int z, int x, int y, int w, int h) override { owner_->Bounds(z, x, y, w, h); }
  SbDecodeTarget GetCurrentDecodeTarget() override { return kSbDecodeTargetInvalid; }
 private: Owner* owner_;
};
class Clock : public filter::MediaTimeProvider {
 public:
  explicit Clock(Owner* owner) : owner_(owner) {}
  void Play() override { owner_->Pause(false); }
  void Pause() override { owner_->Pause(true); }
  void Seek(SbTime target) override { owner_->Seek(target); }
  void SetPlaybackRate(double rate) override { owner_->Rate(rate); }
  SbTime GetCurrentMediaTime(bool* playing, bool* eos, bool* underflow, double* rate) override {
    return owner_->Time(playing, eos, underflow, rate);
  }
 private: Owner* owner_;
};
class Components : public filter::PlayerComponents {
 public:
  Components(const Factory::CreationParameters& parameters,
             const StarfishOpusConfig& config, int mode)
      : owner_(parameters, config, mode), audio_(&owner_), video_(&owner_), clock_(&owner_) {}
  filter::AudioRenderer* GetAudioRenderer() override { return &audio_; }
  filter::VideoRenderer* GetVideoRenderer() override { return &video_; }
  filter::MediaTimeProvider* GetMediaTimeProvider() override { return &clock_; }
 private:
  Owner owner_; // outlives all adapters
  Audio audio_;
  Video video_;
  Clock clock_;
};
}  // namespace

bool TryCreateStarfishAvComponents(
    const filter::PlayerComponents::Factory::CreationParameters& parameters,
    scoped_ptr<filter::PlayerComponents>* components, std::string* error_message) {
  const int mode = SharedAvBackendMode();
  if (mode == 0) return false;
  // A still-owned or quarantined native session can retain both the exported
  // video window and the audio device. Do not start a competing legacy player
  // until the prior shared session has completed Unload (or Cobalt restarts).
  if (lease.load() == 2) {
    *error_message = "shared Starfish session quarantined; restart Cobalt";
    return true;
  }
  if (lease.load() == 1 && parameters.video_codec() != kSbMediaVideoCodecNone) {
    *error_message = "shared Starfish A/V session still active; refusing competing video player";
    return true;
  }
  const SbMediaVideoCodec video_codec = parameters.video_codec();
  if (
      parameters.audio_codec() != kSbMediaAudioCodecOpus ||
      (video_codec != kSbMediaVideoCodecH264 &&
       !(mode >= 2 && (video_codec == kSbMediaVideoCodecVp9 ||
                      video_codec == kSbMediaVideoCodecAv1))) ||
      parameters.output_mode() != kSbPlayerOutputModePunchOut ||
      parameters.drm_system() != kSbDrmSystemInvalid) {
    Trace("existing backend (codec/DRM/output mode) audio=%d video=%d",
          parameters.audio_codec(), parameters.video_codec());
    return false;
  }
  const auto& audio = parameters.audio_sample_info();
  const auto& video = parameters.video_sample_info();
  StarfishOpusConfig config;
  if (!audio.mime || !std::strstr(audio.mime, "webm") ||
      !StarfishOpusConfig::Parse(audio.audio_specific_config, audio.audio_specific_config_size,
          audio.number_of_channels, audio.samples_per_second, &config) ||
      !IsVideoConfigurationSupported(video_codec, video, mode)) {
    Trace("existing backend (unsupported config)");
    return false;
  }
  int available = 0;
  if (!lease.compare_exchange_strong(available, 1)) {
    *error_message = "shared Starfish A/V session already owned; refusing competing native session";
    return true;
  }
  TraceEssential("selected shared %s+Opus backend mode=%d size=%dx%d bits=%u transfer=%d",
        CodecName(video_codec), mode, video.frame_width, video.frame_height,
        video.color_metadata.bits_per_channel, video.color_metadata.transfer);
  components->reset(new Components(parameters, config, mode));
  return true;
}

}  // namespace webos
}  // namespace shared
}  // namespace starboard
