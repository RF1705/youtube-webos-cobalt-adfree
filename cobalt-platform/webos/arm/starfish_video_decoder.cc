#include "starboard/webos/arm/starfish_video_decoder.h"

#include <inttypes.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <functional>
#include <sstream>

#include "starboard/common/log.h"
#include "starboard/common/string.h"
#include "starboard/shared/starboard/media/mime_type.h"
#include "starboard/webos/arm/application_sdl.h"

namespace starboard {
namespace shared {
namespace webos {
namespace {

struct AdaptiveVideoCapabilities {
  int width;
  int height;
  int frame_rate;
};

const char* CodecName(SbMediaVideoCodec codec) {
  switch (codec) {
    case kSbMediaVideoCodecH264:
      return "H264";
    case kSbMediaVideoCodecVp9:
      return "VP9";
    case kSbMediaVideoCodecAv1:
      return "AV1";
    default:
      return nullptr;
  }
}

AdaptiveVideoCapabilities GetAdaptiveVideoCapabilities(
    SbMediaVideoCodec codec,
    const SbMediaVideoSampleInfo& sample_info) {
  const int codec_max_width =
      codec == kSbMediaVideoCodecH264 ? 1920 : 3840;
  const int codec_max_height =
      codec == kSbMediaVideoCodecH264 ? 1080 : 2160;
  int width = codec_max_width;
  int height = codec_max_height;
  int frame_rate = 60;

  if (sample_info.max_video_capabilities &&
      sample_info.max_video_capabilities[0] != '\0') {
    std::string capabilities(sample_info.max_video_capabilities);
    if (capabilities.find('/') == std::string::npos) {
      capabilities.insert(0, "video/webm; ");
    }
    ::starboard::shared::starboard::media::MimeType mime_type(capabilities);
    if (mime_type.is_valid()) {
      width = mime_type.GetParamIntValue("width", width);
      height = mime_type.GetParamIntValue("height", height);
      const float parsed_frame_rate =
          mime_type.GetParamFloatValue("framerate", frame_rate);
      if (std::isfinite(parsed_frame_rate) && parsed_frame_rate > 0.0f) {
        frame_rate = static_cast<int>(std::ceil(parsed_frame_rate));
      }
      width = width > 0 ? width : codec_max_width;
      height = height > 0 ? height : codec_max_height;
      frame_rate = frame_rate > 0 ? frame_rate : 60;
    } else {
      SB_LOG(WARNING) << "Could not parse max video capabilities: "
                      << sample_info.max_video_capabilities;
    }
  }

  width = std::min(codec_max_width, std::max(sample_info.frame_width, width));
  height =
      std::min(codec_max_height, std::max(sample_info.frame_height, height));
  frame_rate = std::max(1, std::min(frame_rate, 60));
  return {width, height, frame_rate};
}

const char* HdrType(SbMediaTransferId transfer) {
  switch (transfer) {
    case kSbMediaTransferIdSmpteSt2084:
      return "HDR10";
    case kSbMediaTransferIdAribStdB67:
      return "HLG";
    default:
      return nullptr;
  }
}

bool IsFiniteAndPositive(float value) {
  return std::isfinite(value) && value > 0.0f;
}

int ScaleAndRound(float value, float scale) {
  return static_cast<int>(std::lround(value * scale));
}

void AppendJsonInteger(std::ostringstream* stream,
                       bool* has_value,
                       const char* name,
                       int value) {
  if (*has_value) {
    *stream << ',';
  }
  *stream << '\"' << name << "\":" << value;
  *has_value = true;
}

std::string BuildHdrInfoPayload(const SbMediaColorMetadata& metadata) {
  const char* hdr_type = HdrType(metadata.transfer);
  if (!hdr_type) {
    return std::string();
  }

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
  const bool has_luminance =
      std::isfinite(mastering.luminance_min) &&
      mastering.luminance_min >= 0.0f &&
      IsFiniteAndPositive(mastering.luminance_max);

  // webOS TVs are known to crash when setHdrInfo() is called without any SEI
  // data. If the container supplies no mastering or light-level information,
  // leave HDR detection to the elementary stream instead.
  if (!has_primaries && !has_luminance && metadata.max_cll == 0 &&
      metadata.max_fall == 0) {
    return std::string();
  }

  std::ostringstream sei;
  bool has_sei_value = false;
  if (has_primaries) {
    // Starfish expects display primaries in G, B, R order and CTA-861 units.
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
  if (metadata.max_cll > 0) {
    AppendJsonInteger(&sei, &has_sei_value, "maxContentLightLevel",
                      static_cast<int>(metadata.max_cll));
  }
  if (metadata.max_fall > 0) {
    AppendJsonInteger(&sei, &has_sei_value, "maxPicAverageLightLevel",
                      static_cast<int>(metadata.max_fall));
  }

  std::ostringstream payload;
  payload << "{\"hdrType\":\"" << hdr_type << "\",\"sei\":{" << sei.str()
          << "},\"vui\":{"
          << "\"transferCharacteristics\":" << static_cast<int>(metadata.transfer)
          << ",\"colorPrimaries\":" << static_cast<int>(metadata.primaries)
          << ",\"matrixCoeffs\":" << static_cast<int>(metadata.matrix)
          << ",\"videoFullRangeFlag\":"
          << (metadata.range == kSbMediaRangeIdFull ? "true" : "false")
          << "}}";
  return payload.str();
}

}  // namespace

StarfishVideoDecoder::StarfishVideoDecoder(SbMediaVideoCodec codec)
    : codec_(codec),
      media_api_(new StarfishMediaAPIs()),
      pipeline_state_condition_(pipeline_state_mutex_) {
  SB_DCHECK(CodecName(codec));
}

StarfishVideoDecoder::~StarfishVideoDecoder() {
  shutting_down_.store(true);
  if (decoder_thread_) {
    decoder_thread_->ScheduleAndWait([this]() {
      pending_buffer_ = nullptr;
      if (pipeline_loaded_) {
        media_api_->Stop();
        media_api_->Unload();
        pipeline_loaded_ = false;
      }
      media_api_.reset();
    });
    decoder_thread_.reset();
  }
  CancelPendingJobs();
  if (exported_window_acquired_) {
    ApplicationSdl::Get()->ReleaseExportedVideoWindow();
    exported_window_acquired_ = false;
  }
}

void StarfishVideoDecoder::Initialize(const DecoderStatusCB& decoder_status_cb,
                                      const ErrorCB& error_cb) {
  SB_DCHECK(BelongsToCurrentThread());
  SB_DCHECK(decoder_status_cb);
  SB_DCHECK(error_cb);
  decoder_status_cb_ = decoder_status_cb;
  error_cb_ = error_cb;
  exported_window_acquired_ =
      ApplicationSdl::Get()->AcquireExportedVideoWindow();
  if (!exported_window_acquired_) {
    ReportError("SDL did not create a webOS exported video window.");
    return;
  }
  decoder_thread_.reset(new starboard::player::JobThread(
      "starfish_video_decoder", 0, kSbThreadPriorityHigh));
}

void StarfishVideoDecoder::SetPause(bool pause) {
  pause_requested_.store(pause);
  ApplicationSdl::Get()->SetVideoPaused(pause);
  if (decoder_thread_) {
    decoder_thread_->Schedule(std::bind(
        &StarfishVideoDecoder::ApplyPlaybackStateOnDecoderThread, this));
  }
}

void StarfishVideoDecoder::SetPlaybackRate(double playback_rate) {
  if (!std::isfinite(playback_rate)) {
    return;
  }
  playback_rate_millionths_.store(
      static_cast<int>(playback_rate * 1000000.0));
  ApplicationSdl::Get()->SetVideoPaused(playback_rate <= 0.0);
  if (decoder_thread_) {
    decoder_thread_->Schedule(std::bind(
        &StarfishVideoDecoder::ApplyPlaybackStateOnDecoderThread, this));
  }
}

void StarfishVideoDecoder::InitializePipeline(
    const SbMediaVideoSampleInfo& sample_info) {
  SB_DCHECK(decoder_thread_->BelongsToCurrentThread());
  const int width =
      sample_info.frame_width > 0 ? sample_info.frame_width : 1920;
  const int height =
      sample_info.frame_height > 0 ? sample_info.frame_height : 1080;
  if (width != video_width_ || height != video_height_) {
    video_width_ = width;
    video_height_ = height;
    ApplicationSdl::Get()->SetVideoResolution(width, height);
    ApplicationSdl::Get()->ConfigureFullscreenVideo();
  }
  if (pipeline_loaded_) {
    ApplyHdrInfo(sample_info.color_metadata);
    return;
  }

  const char* codec_name = CodecName(codec_);
  const char* app_id = std::getenv("APPID");
  if (!app_id || !*app_id) {
    app_id = "youtube.leanback.v4";
  }
  const std::string& window_id = ApplicationSdl::Get()->GetExportedWindowId();
  if (window_id.empty() && !ApplicationSdl::Get()->UsesAcbVideo()) {
    ReportError("SDL did not create a webOS exported video window.");
    return;
  }
  const std::string window_field =
      window_id.empty() ? std::string()
                        : "\"windowId\":\"" + window_id + "\",";

  const int64_t target_pts_ns = seek_to_time_.load() * 1000;
  const AdaptiveVideoCapabilities capabilities =
      GetAdaptiveVideoCapabilities(codec_, sample_info);
  std::string payload = FormatString(
      "{\"args\":[{\"mediaTransportType\":\"BUFFERSTREAM\","
      "\"option\":{%s\"appId\":\"%s\","
      "\"queryPosition\":false,"
      "\"externalStreamingInfo\":{\"contents\":{\"codec\":{"
      "\"video\":\"%s\"},\"esInfo\":{\"pauseAtDecodeTime\":true,"
      "\"seperatedPTS\":true,\"ptsToDecode\":%" PRId64
      ",\"videoWidth\":%d,"
      "\"videoHeight\":%d,\"videoFpsValue\":60,\"videoFpsScale\":1},"
      "\"format\":\"RAW\",\"provider\":\"Chrome\"},"
      "\"restartStreaming\":false,\"streamQualityInfo\":true,"
      "\"streamQualityInfoNonFlushable\":true,\"totalStreamSize\":256,"
      "\"bufferingCtrInfo\":{\"preBufferByte\":0,"
      "\"bufferMinLevel\":0,\"bufferMaxLevel\":0,"
      "\"qBufferLevelAudio\":0,\"qBufferLevelVideo\":0,"
      "\"srcBufferLevelAudio\":{\"minimum\":1024,"
      "\"maximum\":1048576},\"srcBufferLevelVideo\":{"
      "\"minimum\":1024,\"maximum\":8388608}}},"
      "\"adaptiveStreaming\":{\"audioOnly\":false,"
      "\"adaptiveResolution\":true,\"maxWidth\":%d,"
      "\"maxHeight\":%d,\"maxFrameRate\":%d},"
      "\"forcedPrerollOnPause\":true,\"seekMode\":\"keep-rate\"}}]}",
      window_field.c_str(), app_id, codec_name, target_pts_ns, width, height,
      capabilities.width, capabilities.height, capabilities.frame_rate);

  SB_LOG(INFO) << "Loading Starfish hardware decoder for " << codec_name
               << " at " << width << "x" << height
               << " with adaptive maximum " << capabilities.width << "x"
               << capabilities.height << "@" << capabilities.frame_rate
               << " using window " << window_id;
  media_api_->notifyForeground();
  ApplicationSdl::Get()->SetStarfishMediaId(media_api_->getMediaID());
  if (!media_api_->Load(payload.c_str(), &StarfishVideoDecoder::PlayerCallback,
                        this)) {
    ReportError("StarfishMediaAPIs::Load() failed.");
    return;
  }
  pipeline_loaded_ = true;
  ApplyHdrInfo(sample_info.color_metadata);
  play_issued_ = false;
  pause_issued_ = false;
  startup_play_accepted_ = false;
  applied_playback_rate_ = -1.0;
}

void StarfishVideoDecoder::ApplyHdrInfo(
    const SbMediaColorMetadata& color_metadata) {
  SB_DCHECK(decoder_thread_->BelongsToCurrentThread());
  const std::string payload = BuildHdrInfoPayload(color_metadata);
  if (payload.empty() || payload == last_hdr_payload_) {
    return;
  }
  if (media_api_->setHdrInfo(payload.c_str())) {
    last_hdr_payload_ = payload;
    SB_LOG(INFO) << "Applied Starfish HDR metadata: " << payload;
  } else {
    SB_LOG(WARNING) << "Starfish setHdrInfo() rejected: " << payload;
  }
}

void StarfishVideoDecoder::WriteInputBuffers(
    const InputBuffers& input_buffers) {
  SB_DCHECK(BelongsToCurrentThread());
  SB_DCHECK(input_buffers.size() == 1);
  SB_DCHECK(input_buffers[0]);
  SB_DCHECK(decoder_thread_);
  if (stream_ended_) {
    return;
  }
  const scoped_refptr<InputBuffer> input = input_buffers[0];
  decoder_thread_->Schedule(
      std::bind(&StarfishVideoDecoder::FeedBuffer, this, input));
}

void StarfishVideoDecoder::FeedBuffer(
    const scoped_refptr<InputBuffer>& input_buffer) {
  SB_DCHECK(decoder_thread_->BelongsToCurrentThread());
  InitializePipeline(input_buffer->video_sample_info());
  if (!pipeline_loaded_) {
    return;
  }

  const uintptr_t address =
      reinterpret_cast<uintptr_t>(input_buffer->data());
  std::string feed_payload = FormatString(
      "{\"bufferAddr\":\"0x%" PRIxPTR "\",\"bufferSize\":%d,"
      "\"pts\":%" PRId64 ",\"esData\":1}",
      address, input_buffer->size(),
      static_cast<int64_t>(input_buffer->timestamp()) * 1000);
  std::string result = media_api_->Feed(feed_payload.c_str());
  if (result.find("Ok") != std::string::npos) {
    pending_buffer_ = nullptr;
    // On some webOS releases LOADCOMPLETED is emitted only after Play(), while
    // others refuse an early Play(). Retry until one startup Play is accepted,
    // but do not restart playback for every buffer after an intentional Pause.
    if (!startup_play_accepted_) {
      EnsurePlayingOnDecoderThread("first accepted buffer", false);
      startup_play_accepted_ = play_issued_;
    }
    ApplyPlaybackStateOnDecoderThread();
    // Feed acceptance only controls compressed-input backpressure.  Cobalt's
    // video preroll is completed by the first real FRAMEREADY event below, so
    // its audio clock cannot run ahead of the hardware video pipeline.
    Schedule(std::bind(decoder_status_cb_, kNeedMoreInput,
                       scoped_refptr<VideoFrame>()));
    return;
  }
  if (result.find("BufferFull") != std::string::npos ||
      result.find("Pending") != std::string::npos) {
    pending_buffer_ = input_buffer;
    Schedule(std::bind(decoder_status_cb_, kBufferFull,
                       scoped_refptr<VideoFrame>()));
    decoder_thread_->Schedule(
        std::bind(&StarfishVideoDecoder::RetryPendingBuffer, this),
        5 * kSbTimeMillisecond);
    return;
  }
  ReportError("Starfish Feed() failed: " + result);
}

void StarfishVideoDecoder::RetryPendingBuffer() {
  SB_DCHECK(decoder_thread_->BelongsToCurrentThread());
  if (pending_buffer_ && !shutting_down_.load()) {
    scoped_refptr<InputBuffer> input = pending_buffer_;
    FeedBuffer(input);
  }
}

void StarfishVideoDecoder::EnsurePlayingOnDecoderThread(const char* reason,
                                                        bool force) {
  SB_DCHECK(decoder_thread_->BelongsToCurrentThread());
  if (!pipeline_loaded_ || (!force && play_issued_)) {
    return;
  }
  const bool accepted = media_api_->Play();
  SB_LOG(INFO) << "Starfish Play() after " << reason << " -> "
               << (accepted ? "accepted" : "refused; will retry");
  if (accepted) {
    play_issued_ = true;
    pause_issued_ = false;
  }
}

void StarfishVideoDecoder::ApplyPlaybackStateOnDecoderThread() {
  SB_DCHECK(decoder_thread_->BelongsToCurrentThread());
  if (!pipeline_loaded_ || shutting_down_.load()) {
    return;
  }

  const double playback_rate =
      playback_rate_millionths_.load() / 1000000.0;
  if (playback_rate > 0.0 &&
      std::fabs(playback_rate - applied_playback_rate_) > 0.0001) {
    // webOS uses audioOutput=false for muted trick play.  Even though Cobalt
    // renders audio separately, true keeps Starfish in its smooth A/V pacing
    // mode for the normal 0.1x-2x playback range.
    const bool smooth_playback = playback_rate >= 0.1 && playback_rate <= 2.0;
    const std::string payload = FormatString(
        "{\"playRate\":%.6g,\"audioOutput\":%s}", playback_rate,
        smooth_playback ? "true" : "false");
    const bool accepted = media_api_->SetPlayRate(payload.c_str());
    SB_LOG(INFO) << "Starfish SetPlayRate(" << playback_rate << ") -> "
                 << (accepted ? "accepted" : "refused");
    if (accepted) {
      applied_playback_rate_ = playback_rate;
    }
  }

  const bool should_pause = pause_requested_.load() || playback_rate <= 0.0;
  if (should_pause) {
    // During a seek Cobalt holds playback at rate 0 until video preroll reaches
    // the target timestamp.  Pausing on an earlier decoded frame deadlocks the
    // pipeline: no later frame can reach the target and release the preroll.
    if (preroll_frame_sent_.load() && !pause_issued_) {
      const bool accepted = media_api_->Pause();
      SB_LOG(INFO) << "Starfish Pause() -> "
                   << (accepted ? "accepted" : "refused");
      if (accepted) {
        pause_issued_ = true;
        play_issued_ = false;
      }
    }
    return;
  }

  if (!play_issued_ || pause_issued_) {
    EnsurePlayingOnDecoderThread("playback state change", false);
  }
}

void StarfishVideoDecoder::OnLoadCompletedOnDecoderThread() {
  SB_DCHECK(decoder_thread_->BelongsToCurrentThread());
  if (!pipeline_loaded_ || shutting_down_.load()) {
    return;
  }
  // An early Play() can be accepted but remain queued.  Reissuing it at the
  // point at which the pipeline declares itself ready is harmless and fixes
  // that firmware behaviour.
  EnsurePlayingOnDecoderThread("LOADCOMPLETED", true);
  ApplyPlaybackStateOnDecoderThread();
}

void StarfishVideoDecoder::WriteEndOfStream() {
  SB_DCHECK(BelongsToCurrentThread());
  stream_ended_ = true;
  if (!decoder_thread_) {
    decoder_status_cb_(kBufferFull, VideoFrame::CreateEOSFrame());
    return;
  }
  decoder_thread_->Schedule(
      std::bind(&StarfishVideoDecoder::WriteEndOfStreamOnDecoderThread, this));
}

void StarfishVideoDecoder::WriteEndOfStreamOnDecoderThread() {
  SB_DCHECK(decoder_thread_->BelongsToCurrentThread());
  if (!pipeline_loaded_ || !media_api_->pushEOS()) {
    eos_output_ = true;
    Schedule(std::bind(decoder_status_cb_, kBufferFull,
                       VideoFrame::CreateEOSFrame()));
  }
}

void StarfishVideoDecoder::Reset() {
  SB_DCHECK(BelongsToCurrentThread());
  stream_ended_ = false;
  eos_output_ = false;
  preroll_frame_sent_.store(false);
  first_frame_presented_.store(false);
  load_completed_.store(false);
  if (decoder_thread_) {
    decoder_thread_->ScheduleAndWait(
        std::bind(&StarfishVideoDecoder::ResetOnDecoderThread, this));
  }
  CancelPendingJobs();
}

void StarfishVideoDecoder::ResetOnDecoderThread() {
  SB_DCHECK(decoder_thread_->BelongsToCurrentThread());
  pending_buffer_ = nullptr;
  if (!pipeline_loaded_) {
    return;
  }

  // Keep the hardware decoder and exported video window alive across seeks.
  // Reloading this pipeline takes well over a second for 4K VP9 and makes the
  // YouTube UI show a loading spinner.  flush() discards the old compressed
  // queue, and setTimeToDecode() starts a fresh BUFFERSTREAM segment at the
  // requested nanosecond PTS.
  reset_in_progress_.store(true);
  const int64_t target_pts_ns = seek_to_time_.load() * 1000;
  const bool flushed = media_api_->flush();
  const std::string time_payload =
      FormatString("{\"position\":%" PRId64 "}", target_pts_ns);
  const bool time_set =
      flushed && media_api_->setTimeToDecode(time_payload.c_str());
  if (!flushed || !time_set) {
    SB_LOG(WARNING) << "Starfish seek flush failed (flush=" << flushed
                    << ", setTimeToDecode=" << time_set
                    << "); recreating the pipeline.";
    unload_completed_.store(false);
    media_api_->Stop();
    if (media_api_->Unload()) {
      pipeline_state_mutex_.Acquire();
      if (!unload_completed_.load() &&
          !pipeline_state_condition_.WaitTimed(kSbTimeSecond)) {
        SB_LOG(WARNING) << "Timed out waiting for Starfish unload.";
      }
      pipeline_state_mutex_.Release();
    }
    media_api_.reset(new StarfishMediaAPIs());
    pipeline_loaded_ = false;
    video_width_ = 0;
    video_height_ = 0;
    last_hdr_payload_.clear();
  } else {
    SB_LOG(INFO) << "Flushed Starfish pipeline for seek target "
                 << seek_to_time_.load();
  }
  play_issued_ = false;
  pause_issued_ = false;
  startup_play_accepted_ = false;
  applied_playback_rate_ = -1.0;
  reset_in_progress_.store(false);
}

void StarfishVideoDecoder::SignalUnloadCompleted() {
  pipeline_state_mutex_.Acquire();
  unload_completed_.store(true);
  pipeline_state_condition_.Broadcast();
  pipeline_state_mutex_.Release();
}

SbDecodeTarget StarfishVideoDecoder::GetCurrentDecodeTarget() {
  return kSbDecodeTargetInvalid;
}

void StarfishVideoDecoder::ReportError(const std::string& message) {
  SB_LOG(ERROR) << message;
  Schedule(std::bind(error_cb_, kSbPlayerErrorDecode, message));
}

void StarfishVideoDecoder::HandlePlayerEvent(int type,
                                             int64_t num_value,
                                             const char* str_value) {
  if (shutting_down_.load()) {
    return;
  }
  if (type != PF_EVENT_TYPE_FRAMEREADY) {
    ApplicationSdl::Get()->OnStarfishEvent(type, str_value);
  }
  if (type == PF_EVENT_TYPE_STR_STATE_UPDATE__UNLOADCOMPLETED) {
    SignalUnloadCompleted();
    return;
  }
  if (reset_in_progress_.load()) {
    return;
  }
  if (type == PF_EVENT_TYPE_FRAMEREADY) {
    const SbTime frame_time = static_cast<SbTime>(num_value / 1000);
    const SbTime target_time = seek_to_time_.load();
    if (!first_frame_presented_.exchange(true) && decoder_thread_) {
      decoder_thread_->Schedule(std::bind(
          &StarfishVideoDecoder::ApplyPlaybackStateOnDecoderThread, this));
    }
    if (frame_time >= target_time &&
        !preroll_frame_sent_.exchange(true)) {
      SB_LOG(INFO) << "Starfish first visible frame reached target: frame="
                   << frame_time << " target=" << target_time;
      Schedule(std::bind(decoder_status_cb_, kNeedMoreInput,
                         scoped_refptr<VideoFrame>(new VideoFrame(frame_time))));
      if (decoder_thread_) {
        decoder_thread_->Schedule(std::bind(
            &StarfishVideoDecoder::ApplyPlaybackStateOnDecoderThread, this));
      }
    }
    return;
  }
  SB_LOG(INFO) << "Starfish event type=" << type << " value=" << num_value
               << " text=" << (str_value ? str_value : "");
  if (type == PF_EVENT_TYPE_STR_STATE_UPDATE__LOADCOMPLETED) {
    load_completed_.store(true);
    if (decoder_thread_) {
      decoder_thread_->Schedule(std::bind(
          &StarfishVideoDecoder::OnLoadCompletedOnDecoderThread, this));
    }
  } else if (type == PF_EVENT_TYPE_INT_NEED_DATA) {
    if (decoder_thread_) {
      decoder_thread_->Schedule(
          std::bind(&StarfishVideoDecoder::RetryPendingBuffer, this));
    }
  } else if ((type == PF_EVENT_TYPE_STR_STATE_UPDATE__ENDOFSTREAM) &&
             !eos_output_) {
    eos_output_ = true;
    Schedule(std::bind(decoder_status_cb_, kBufferFull,
                       VideoFrame::CreateEOSFrame()));
  } else if (type == PF_EVENT_TYPE_INT_ERROR ||
             type == PF_EVENT_TYPE_STR_ERROR) {
    ReportError(FormatString("Starfish pipeline error %d/%" PRId64 ": %s",
                             type, num_value, str_value ? str_value : ""));
  }
}

void StarfishVideoDecoder::PlayerCallback(int type,
                                          int64_t num_value,
                                          const char* str_value,
                                          void* context) {
  StarfishVideoDecoder* decoder =
      static_cast<StarfishVideoDecoder*>(context);
  if (!decoder || decoder->shutting_down_.load()) {
    return;
  }
  decoder->HandlePlayerEvent(type, num_value, str_value);
}

}  // namespace webos
}  // namespace shared
}  // namespace starboard
