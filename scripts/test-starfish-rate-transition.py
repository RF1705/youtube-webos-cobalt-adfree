#!/usr/bin/env python3
"""Compile the actual native Feed/Step rate transition with a fake Starfish API.

This checks adapter behavior, not firmware flush semantics or physical A/V sync.
"""
import os
from pathlib import Path
import subprocess
import tempfile

repo = Path(__file__).resolve().parent.parent
source = (repo / 'cobalt-platform/webos/arm/starfish_av_components.cc').read_text()

def method(signature):
    start = source.index(signature)
    opening = source.index('{', start)
    depth, end = 1, opening + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]

session = source[source.index('struct NativeSession {'):source.index('\nclass Owner ')]
step = method('  void Step(NativeSession& session)')
# Bounds/display plumbing is unrelated and requires the complete SDL platform.
step = step[:step.index('    int z, x, y, width, height;')] + '\n  }'
fixture = r'''
#include <algorithm>
#include <atomic>
#include <cassert>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include "starfish_av_session_state.h"
#include "starfish_rate_replay.h"
#include "starfish_video_configuration.h"
using namespace starboard::shared::webos;
using SbTime = int64_t;
constexpr SbTime kSecond = 1000000;
SbTime now_us = 1000000;
SbTime SbTimeGetMonotonicNow() { return now_us; }
using Guard = std::lock_guard<std::mutex>;
std::atomic<int> lease{1};
enum SbMediaVideoCodec { kSbMediaVideoCodecH264, kSbMediaVideoCodecVp9,
                         kSbMediaVideoCodecAv1, kSbMediaVideoCodecNone };
using SbMediaTransferId = int;
constexpr int kSbMediaTransferIdSmpteSt2084=16, kSbMediaTransferIdAribStdB67=18;
struct VideoInfo {
  int frame_width=1920, frame_height=1080;
  bool is_key_frame=false;
  struct { int transfer=1, bits_per_channel=8; } color_metadata;
};
using SbMediaVideoSampleInfo = VideoInfo;
struct Buffer {
  VideoInfo info;
  const VideoInfo& video_sample_info() const { return info; }
  const void* data() const { return this; }
};
using State = StarfishAvSessionState<std::shared_ptr<Buffer>>;
using Stream = State::Stream;
HDR_TRANSFER
CODEC_NAME
VIDEO_SUPPORTED
std::string Base64(const std::array<uint8_t,19>&) { return "test-opus-header"; }
bool replay_enabled = true;
bool RateReplayEnabled() { return replay_enabled; }
template <typename... Args> std::string FormatString(const char* format, Args... args) {
  char buffer[2048]; std::snprintf(buffer, sizeof(buffer), format, args...); return buffer;
}
void Trace(const char*, ...) {}
void TraceEssential(const char*, ...) {}
void TraceRate(const char*, ...) {}
struct ApplicationSdl {
  static ApplicationSdl* Get() { static ApplicationSdl app; return &app; }
  void OnStarfishEvent(int, const char*) {}
  void SetVideoResolution(int, int) {}
  void ConfigureFullscreenVideo() {}
  void SetVideoPaused(bool) {}
  bool AcquireExportedVideoWindow() { return true; }
  std::string GetExportedWindowId() { return "test-window"; }
  void SetStarfishMediaId(const std::string&) {}
};
enum { PF_EVENT_TYPE_FRAMEREADY, PF_EVENT_TYPE_STR_STATE_UPDATE__LOADCOMPLETED,
       PF_EVENT_TYPE_STR_STATE_UPDATE__UNLOADCOMPLETED,
       PF_EVENT_TYPE_STR_STATE_UPDATE__ENDOFSTREAM, PF_EVENT_TYPE_INT_ERROR,
       PF_EVENT_TYPE_STR_ERROR };
struct StarfishMediaAPIs {
  struct Fed { int64_t pts; int stream; };
  std::vector<Fed> fed;
  bool full=false, reject_rate=false;
  int full_stream=0;
  int rate_calls=0, eos_calls=0, fed_before_rate=-1;
  std::string last_rate;
  std::string load_payload;
  void notifyForeground() {}
  std::string getMediaID() { return "test-media"; }
  bool Load(const char* payload, void (*)(int,int64_t,const char*,void*), void*) {
    load_payload=payload;
    return true;
  }
  std::string Feed(const char* payload) {
    const auto* pts = std::strstr(payload, "\"pts\":");
    const auto* stream = std::strstr(payload, "\"esData\":");
    if (full || (full_stream && std::stoi(stream + 9)==full_stream)) return "BufferFull";
    fed.push_back({std::stoll(pts + 6), std::stoi(stream + 9)});
    return "Ok";
  }
  std::vector<std::string> calls;
  bool SetPlayRate(const char* payload) {
    calls.push_back("rate");
    ++rate_calls; last_rate = payload; fed_before_rate = static_cast<int>(fed.size());
    if (reject_rate) return false;
    fed.clear(); // model the observed native buffer flush
    return true;
  }
  bool Play() { calls.push_back("play"); return true; }
  bool Pause() { calls.push_back("pause"); return true; }
  bool setHdrInfo(const char*) { return true; }
  bool setVolume(const char*) { return true; }
  bool pushEOS() { ++eos_calls; return true; }
};
SESSION
struct Owner {
  mutable std::mutex mutex_;
  StarfishOpusConfig config_ = [] {
    StarfishOpusConfig c;
    std::memcpy(c.header.data(), "OpusHead", 8);
    c.header[8]=1; c.header[9]=2;
    return c;
  }();
  State state_{{256, 1024*1024}, {kStarfishSeekHoldPackets, 32*1024*1024}};
  std::condition_variable wake_;
  StarfishVideoConfiguration queued_video_configuration_;
  StarfishSeekRetarget<State> retarget_;
  SbTime current_=100000, frame_time_=0;
  SbTime target_=0, input_wait_started_=0, first_audio_pts_=0, first_video_pts_=0;
  bool paused_=false, video_hdr_=false, ready_=false, playing_=false, have_frame_=false;
  bool audio_eos_=false, video_eos_=false, first_audio_=false, first_video_=false;
  bool preroll_sent_=false, end_sent_=false, bounds_dirty_=false, snapped_=false;
  bool audio_origin_=false, error_sent_=false, window_prearmed_=false;
  int width_=1920, height_=1080, window_width_=0, window_height_=0;
  unsigned video_bits_=8;
  SbMediaVideoCodec video_codec_=kSbMediaVideoCodecAv1;
  bool restart_pending_=false, stopping_=false;
  SbTime restart_target_=0;
  std::deque<NativeSession::Replay::Entry> restart_audio_, restart_video_;
  double rate_=1, applied_rate_=1, volume_=1;
  std::string hdr_payload_, error_;
  std::function<void()> before_rate_hook;
  bool Current(uint64_t g) const { return g == state_.generation() && error_.empty(); }
  void FailLocked(const std::string& e) { error_=e; }
  void FailSession(const NativeSession&, const std::string& e) { error_=e; }
FEED
SNAPSHOT
STEP
SEEK
TIME
PAUSE
RATE
SESSION_START
SYNC_FIRST
TRACE_RETARGET
ACQUIRE_SEEK
START
};
State::Packet Packet(int64_t pts, bool key=false) {
  auto b=std::make_shared<Buffer>(); b->info.is_key_frame=key; return {b, 100, pts, key};
}
void Seed(Owner& owner, NativeSession& session) {
  session.api.reset(new StarfishMediaAPIs);
  session.loaded=true;
  session.video_configuration.Update(1920,1080,false,8,true);
  session.frame_ns=200000000;
  session.frame_count.store(10);  // the session is presenting
  owner.first_audio_=owner.first_video_=true;
  assert(owner.state_.Enqueue(session.generation, Stream::kAudio,
    {Packet(100000), Packet(200000), Packet(2000000)}) == State::EnqueueResult::kAccepted);
  assert(owner.state_.Enqueue(session.generation, Stream::kVideo,
    {Packet(0,true), Packet(100000), Packet(2000000)}) == State::EnqueueResult::kAccepted);
  owner.Step(session);
  assert(owner.error_.empty() && session.api->fed.size()==6);
}
double ReportedRate(Owner& owner) {
  bool playing, eos, underflow;
  double rate;
  owner.Time(&playing,&eos,&underflow,&rate);
  return rate;
}
void TestCodecLifecycles() {
  for (auto codec : {kSbMediaVideoCodecH264,kSbMediaVideoCodecVp9,kSbMediaVideoCodecAv1}) {
    Owner owner;
    owner.video_codec_=codec;
    SbMediaVideoSampleInfo info;
    assert(IsVideoConfigurationSupported(codec,info,3));
    info.frame_width=3840; info.frame_height=2160;
    assert(IsVideoConfigurationSupported(codec,info,3)==(codec!=kSbMediaVideoCodecH264));
    info.color_metadata.transfer=kSbMediaTransferIdSmpteSt2084;
    info.color_metadata.bits_per_channel=10;
    assert(IsVideoConfigurationSupported(codec,info,3)==(codec!=kSbMediaVideoCodecH264));
    assert(!IsVideoConfigurationSupported(codec,info,2));
    NativeSession session(owner.state_.generation()); Seed(owner,session);
    owner.Rate(1.5); owner.Step(session); owner.Step(session);
    assert(ReportedRate(owner)==1.5);
    owner.Pause(true); owner.Step(session);
    const auto calls=session.api->rate_calls;
    now_us+=10*kSecond;
    owner.Step(session);
    assert(ReportedRate(owner)==0 && session.api->rate_calls==calls && owner.error_.empty());
    owner.Pause(false); owner.Step(session);
    assert(session.playing && session.rate==1.5 && ReportedRate(owner)==1.5);
    owner.Rate(1); owner.Step(session);
    assert(owner.restart_pending_ && ReportedRate(owner)==1.5);
    auto normal=owner.Start(session.generation);
    assert(normal && normal->rate==1 && ReportedRate(owner)==1);
    assert(owner.restart_audio_.empty() && owner.restart_video_.empty());
    assert(normal->api->load_payload.find(std::string("\"video\":\"")+CodecName(codec)+"\"")!=std::string::npos);
    normal->loaded=true;
    owner.Step(*normal);
    assert(normal->api->rate_calls==0 && owner.error_.empty());

    // Repeated real Owner::Seek calls cancel pending reloads, isolate old
    // callbacks, and require first-frame presentation before each rate flush.
    for (int attempt=1;attempt<=3;++attempt) {
      const int64_t target=attempt*kSecond;
      owner.Seek(target); owner.Rate(1.75);
      assert(!owner.restart_pending_ && owner.restart_audio_.empty());
      assert(!owner.Start(session.generation));
      auto generation=owner.state_.generation();
      assert(owner.state_.Enqueue(generation,Stream::kAudio,
          {Packet(target-100000),Packet(target+2000000)})==State::EnqueueResult::kAccepted);
      assert(owner.state_.Enqueue(generation,Stream::kVideo,
          {Packet(target-300000,true),Packet(target+2000000)})==State::EnqueueResult::kAccepted);
      owner.first_audio_=owner.first_video_=true;
      owner.video_bits_=8;
      owner.first_audio_pts_=target-100000; owner.first_video_pts_=target-300000;
      assert(owner.AcquireSeekStart(generation));
      auto fresh=owner.Start(generation);
      assert(fresh && fresh->generation==generation && fresh->rate==1);
      fresh->loaded=true;
      NativeSession::Callback(PF_EVENT_TYPE_FRAMEREADY,99*kSecond*1000,nullptr,&session);
      const auto old_fed=session.api->fed.size();
      owner.Feed(session,Stream::kVideo);
      assert(session.api->fed.size()==old_fed && owner.current_==target);
      owner.Step(*fresh);
      assert(fresh->rate_deferred && fresh->api->rate_calls==0 && ReportedRate(owner)==1);
      NativeSession::Callback(PF_EVENT_TYPE_FRAMEREADY,target*1000,nullptr,fresh.get());
      owner.Step(*fresh);
      assert(fresh->api->rate_calls==0); // preroll is not forward progress
      NativeSession::Callback(PF_EVENT_TYPE_FRAMEREADY,
          (fresh->plan.target_native_us+200000)*1000,nullptr,fresh.get());
      owner.Step(*fresh);
      assert(fresh->api->rate_calls==1 && fresh->rate==1.75 && ReportedRate(owner)==1.75);
      assert(owner.error_.empty());
    }
  }
}


std::unique_ptr<NativeSession> ColdSession(Owner& owner) {
  owner.Seek(0); owner.Rate(0);
  const auto gen=owner.state_.generation();
  assert(owner.state_.Enqueue(gen,Stream::kAudio,
      {Packet(-6500),Packet(2000000)})==State::EnqueueResult::kAccepted);
  assert(owner.state_.Enqueue(gen,Stream::kVideo,
      {Packet(0,true),Packet(2000000)})==State::EnqueueResult::kAccepted);
  owner.first_audio_=owner.first_video_=owner.audio_origin_=true;
  owner.first_audio_pts_=-6500; owner.first_video_pts_=0; owner.video_bits_=8;
  assert(owner.AcquireSeekStart(gen));
  auto session=owner.Start(gen);
  assert(session && session->initial_play_pending);
  return session;
}
void TestInitialRateBeforeFirstPlay() {
  for (double rate : {0.5,1.0,1.75,2.0}) {
    Owner owner; auto session=ColdSession(owner);
    owner.Step(*session);
    assert(owner.ready_ && !session->api->fed.empty());
    assert(session->api->calls.empty()); // no Play before Load completion
    owner.Rate(rate); owner.Step(*session);
    assert(session->api->calls.empty()); // requested rate waits for native caps
    session->loaded=true; owner.Step(*session);
    if (rate==1) {
      assert(session->api->rate_calls==0 && session->api->calls==std::vector<std::string>{"play"});
    } else {
      assert(session->api->calls==std::vector<std::string>{"rate"});
      assert(session->initial_play_pending && !session->playing);
      assert(!session->audio_fed && !session->video_fed);
      // Replay must actually be accepted. BufferFull cannot release Play.
      session->api->full=true; owner.Step(*session);
      assert(session->api->calls==std::vector<std::string>{"rate"});
      session->api->full=false; session->api->full_stream=1;
      owner.Step(*session);
      assert(session->audio_fed && !session->video_fed);
      assert(session->api->calls==std::vector<std::string>{"rate"});
      session->api->full_stream=0; owner.Step(*session);
      assert(session->api->calls==std::vector<std::string>({"rate","play"}));
    }
    assert(session->playing && !session->initial_play_pending);
    assert(session->rate==rate && owner.error_.empty());
    assert(session->frame_count==0); // first Play already has the requested rate
    // The exception cannot be reused for a rate change after Play.
    const int calls=session->api->rate_calls;
    owner.Rate(rate==1.75?1.5:1.75); owner.Step(*session);
    assert(session->api->rate_calls==calls && session->rate_deferred);
  }
}
void TestPausedInitialRateAndMissingReplay() {
  Owner paused; auto session=ColdSession(paused);
  paused.Pause(true); paused.Step(*session); session->loaded=true;
  paused.Step(*session);
  assert(session->api->calls.empty() && session->initial_play_pending);
  paused.Rate(1.75); paused.Step(*session);
  assert(session->api->calls.empty()); // no unsolicited Play/rate while paused
  paused.Pause(false); paused.Step(*session); paused.Step(*session);
  assert(session->api->calls==std::vector<std::string>({"rate","play"}));

  Owner missing; auto ms=ColdSession(missing);
  missing.Step(*ms); ms->loaded=true; missing.Rate(1.75);
  ms->video_history.Accept({std::make_shared<Buffer>(),17*1024*1024,0},false,0);
  missing.Step(*ms);
  assert(ms->api->calls.empty() && ms->rate_deferred);
  now_us=ms->rate_deferred_at+kStarfishRateTransitionDeadlineUs;
  missing.Step(*ms);
  assert(ms->api->calls.empty() && !missing.error_.empty());
}

void TestInitialRequestReplacementAndSeekCancellation() {
  Owner replaced; auto session=ColdSession(replaced);
  replaced.Step(*session); session->loaded=true; replaced.Rate(1.75);
  replaced.Step(*session);
  assert(session->initial_play_pending && session->api->calls==std::vector<std::string>{"rate"});
  session->api->full=true;
  replaced.Rate(1.5); replaced.Step(*session);
  assert(session->api->calls==std::vector<std::string>({"rate","rate"}));
  assert(session->rate==1.5 && !session->playing);
  session->api->full=false; replaced.Step(*session);
  assert(session->api->calls==std::vector<std::string>({"rate","rate","play"}));
  assert(session->rate==1.5 && replaced.error_.empty());

  Owner cancelled; auto stale=ColdSession(cancelled);
  cancelled.Step(*stale); stale->loaded=true; cancelled.Rate(1.75);
  cancelled.before_rate_hook=[&] { cancelled.Seek(kSecond); };
  cancelled.Step(*stale);
  assert(stale->api->calls.empty()); // stale snapshots cannot apply a rate or Play
  assert(stale->generation!=cancelled.state_.generation());
  assert(cancelled.error_.empty() && !cancelled.restart_pending_);
}

void TestShortAudioPrerollSeek() {
  Owner owner;
  const int64_t requested=2760028160;
  const int64_t audio=2759994500, video=2757708333;
  owner.Seek(requested);
  const auto generation=owner.state_.generation();
  owner.state_.Enqueue(generation,Stream::kAudio,{Packet(audio)});
  owner.state_.Enqueue(generation,Stream::kVideo,
      {Packet(video,true),Packet(2763333333,true)});
  owner.first_audio_=owner.first_video_=true;
  owner.first_audio_pts_=audio; owner.first_video_pts_=video;
  owner.video_bits_=8;
  // The next keyframe is outside the window. No two-second black wait, no
  // discarded packets, and no shift of the requested A/V start.
  assert(owner.AcquireSeekStart(generation));
  auto session=owner.Start(generation);
  assert(session && owner.error_.empty());
  assert(owner.current_==requested);
  assert(session->plan.target_native_us==requested);
  assert(session->plan.discard_samples==1616 && session->rate==1);
  assert(owner.state_.queued_packets(Stream::kAudio)==1);
  assert(owner.state_.queued_packets(Stream::kVideo)==2);
}

void TestProgressingLongGopNormal() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  owner.current_=2*kSecond; session.rate=0.5; owner.Rate(1);
  // Continuous accepted audio and two six-second GOP anchors. The next safe
  // restart is eight wall-clock seconds away at the old half-speed rate.
  session.audio_history.Accept({std::make_shared<Buffer>(),2*1024*1024,0},false,0);
  for (int64_t pts=1900000;pts<=7000000;pts+=100000)
    session.audio_history.Accept(Packet(pts),false,owner.current_);
  session.video_history.Accept({std::make_shared<Buffer>(),17*1024*1024,0},false,0);
  session.video_history.Accept(Packet(0,true),true,owner.current_);
  session.video_history.Accept(Packet(6000000,true),true,owner.current_);
  session.video_history.Accept(Packet(7000000),false,owner.current_);
  session.audio_pts=session.video_pts=7000000;
  for (int tick=0;tick<=8;++tick) {
    const int64_t position=2000000+tick*500000;
    owner.current_=position;
    session.frame_ns=position*1000; session.frame_count=100+tick;
    std::deque<NativeSession::Replay::Entry> audio,video;
    assert(session.audio_history.Snapshot(position,&audio));
    assert(session.video_history.Snapshot(position,&video));
    owner.Step(session);
    assert(owner.error_.empty() && session.api->rate_calls==0);
    assert(ReportedRate(owner)==0.5);
    assert(owner.restart_pending_==(tick==8));
    if (tick<8) now_us+=kSecond;
  }
  auto normal=owner.Start(session.generation);
  assert(normal && normal->rate==1 && owner.current_==6000000);
  assert(ReportedRate(owner)==1);
}
void TestRateAtDrainedEos() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  owner.current_=9200000; session.rate=0.1; owner.Rate(1.75);
  session.audio_history.Accept({std::make_shared<Buffer>(),2*1024*1024,0},false,0);
  for (int64_t pts=9100000;pts<=9980000;pts+=20000)
    session.audio_history.Accept(Packet(pts),false,owner.current_);
  session.video_history.Accept({std::make_shared<Buffer>(),17*1024*1024,0},false,0);
  session.video_history.Accept(Packet(9000000,true),true,owner.current_);
  session.video_history.Accept(Packet(9966666),false,owner.current_);
  session.audio_pts=9980000; session.video_pts=9966666;
  owner.audio_eos_=owner.video_eos_=true;
  owner.state_.WriteEos(session.generation,Stream::kAudio);
  owner.state_.WriteEos(session.generation,Stream::kVideo);
  for (int tick=0;tick<=7;++tick) {
    owner.current_=9200000+tick*100000;
    session.frame_ns=owner.current_*1000; session.frame_count=100+tick;
    owner.Step(session);
    assert(owner.error_.empty() && session.api->rate_calls==0);
    assert(session.rate_deferred && ReportedRate(owner)==0.1);
    now_us+=kSecond;
  }
  assert(session.api->eos_calls==1);
  // No new input can supply the missing headroom. Even without new callbacks,
  // the five-second rate deadline must leave the already submitted EOS alone.
  now_us+=5*kSecond; owner.Step(session);
  assert(owner.error_.empty() && session.api->rate_calls==0);
  NativeSession::Callback(PF_EVENT_TYPE_STR_STATE_UPDATE__ENDOFSTREAM,0,nullptr,&session);
  owner.Step(session);
  assert(owner.state_.ended() && owner.error_.empty());
}
void TestStallAfterDeferredProgress() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  // Missing replay remains unsafe, but continuing frames extend the wait.
  session.video_history.Accept({std::make_shared<Buffer>(),17*1024*1024,0},false,0);
  owner.Rate(1.75); owner.Step(session);
  now_us+=4*kSecond; session.frame_ns=300000000; owner.Step(session);
  assert(owner.error_.empty());
  const SbTime progress_at=session.rate_deferred_at;
  now_us=progress_at+4*kSecond; ++session.frame_count; owner.Step(session);
  assert(owner.error_.empty() && session.rate_deferred_at==progress_at);
  // Repeated callbacks at the same PTS do not count as forward progress.
  now_us=progress_at+kStarfishRateTransitionDeadlineUs; owner.Step(session);
  assert(!owner.error_.empty() && session.api->rate_calls==0);
}

int main() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  owner.rate_=1.25; ++now_us; owner.Step(session);
  assert(session.api->rate_calls==1 && session.replaying && session.rate==1.25);
  assert(session.audio_replay.size()==3 && session.video_replay.size()==3);
  assert(session.api->fed.empty());
  auto next=Packet(2100000);
  owner.state_.Enqueue(session.generation, Stream::kVideo, {next});
  session.api->full=true; owner.Step(session);
  assert(session.video_replay.size()==3 && owner.state_.queued_packets(Stream::kVideo)==1);
  session.api->full=false; owner.Step(session);
  assert(!session.replaying && session.api->fed.size()==6);
  assert(owner.state_.queued_packets(Stream::kVideo)==1); // replay must not consume fresh input
  assert(session.api->fed[3].stream==1 && session.api->fed[3].pts==0); // video starts at key
  owner.Step(session);
  assert(owner.state_.queued_packets(Stream::kVideo)==0 && session.api->fed.size()==7);
  // This firmware resets the native audio decoder to 1x on Pause/Play, so a
  // resume must re-apply the requested rate instead of trusting the old one.
  owner.rate_=0; owner.Step(session);
  assert(!session.playing && session.rate==1);
  owner.rate_=1.25; owner.Step(session);
  assert(session.api->rate_calls==2 && session.rate==1.25);
  owner.rate_=1.5; owner.Step(session);
  owner.rate_=2; owner.Step(session); // rapid second change rebuilds the snapshot
  assert(session.api->rate_calls==4 && session.replaying);
  assert(session.video_replay.front().keyframe);

  // Input EOS must wait until replay drains; native EOS must be resent. An
  // upward change re-arms replay on the same session, so use one here: a
  // downward change recreates the session instead (covered separately).
  owner.state_.WriteEos(session.generation,Stream::kAudio);
  owner.state_.WriteEos(session.generation,Stream::kVideo);
  owner.Step(session);
  assert(session.api->eos_calls==1);
  session.rate = 1;                      // model a session reloaded at 1x
  owner.rate_=1.5; owner.Step(session);
  assert(session.replaying && session.api->eos_calls==1);
  owner.Step(session);
  assert(session.api->eos_calls==2);

  // A real seek invalidates the entire session, including its retained history.
  assert(owner.state_.Reset());
  const auto count=session.api->fed.size(); owner.Feed(session,Stream::kVideo);
  assert(session.api->fed.size()==count);

  // A recreated session starts at 1x. Its rate change must wait for a
  // replayable GOP; applying it without one can stall the native decoder.
  Owner waiting; NativeSession ws(waiting.state_.generation());
  ws.api.reset(new StarfishMediaAPIs);
  ws.video_configuration.Update(1920,1080,false,8,true);
  ws.loaded=true;
  waiting.rate_=1.75;
  waiting.Step(ws);
  assert(ws.api->rate_calls==0 && ws.rate_deferred && ws.rate==1);
  assert(waiting.state_.Enqueue(ws.generation, Stream::kAudio,
    {Packet(100000), Packet(200000), Packet(2000000)}) == State::EnqueueResult::kAccepted);
  assert(waiting.state_.Enqueue(ws.generation, Stream::kVideo,
    {Packet(0,true), Packet(100000), Packet(2000000)}) == State::EnqueueResult::kAccepted);
  ws.frame_ns=200000000;
  ws.frame_count.store(3);  // coverage and presentation are both required
  waiting.Step(ws);
  assert(ws.api->rate_calls==1 && ws.rate==1.75 && ws.replaying);
  assert(ws.api->fed_before_rate==6 && !ws.rate_deferred);

  // A rate requested while the session is still at 1x waits for the same
  // coverage instead of applying a flushing transition to an empty pipeline.
  Owner later; NativeSession ls(later.state_.generation());
  ls.api.reset(new StarfishMediaAPIs);
  ls.video_configuration.Update(1920,1080,false,8,true);
  ls.loaded=true;
  later.rate_=1.5;
  later.Step(ls);
  assert(ls.api->rate_calls==0 && ls.rate_deferred);
  assert(later.state_.Enqueue(ls.generation, Stream::kAudio, {Packet(0),Packet(2000000)}) == State::EnqueueResult::kAccepted);
  assert(later.state_.Enqueue(ls.generation, Stream::kVideo, {Packet(0,true),Packet(2000000)}) == State::EnqueueResult::kAccepted);
  ls.frame_ns=200000000;
  ls.frame_count.store(3);
  later.Step(ls);
  assert(ls.api->rate_calls==1 && ls.rate==1.5 && ls.replaying);

  // Coverage alone is not enough: the firmware flush before the first presented
  // frames leaves only the preroll frame and stalls (TV trace, generation 4).
  Owner unstaged; NativeSession us(unstaged.state_.generation()); Seed(unstaged,us);
  us.frame_count.store(0);
  unstaged.rate_=1.75; ++now_us; unstaged.Step(us);
  assert(us.api->rate_calls==0 && us.rate_deferred && us.rate==1);
  us.frame_count.store(1); ++now_us; unstaged.Step(us);
  assert(us.api->rate_calls==0 && us.rate_deferred);
  us.frame_count.store(2); ++now_us; unstaged.Step(us);
  assert(us.api->rate_calls==1 && us.rate==1.75 && us.replaying && !us.rate_deferred);

  // The real startup stall had several callbacks but only half a second of
  // compressed video. Presentation and replay coverage alone must not flush it.
  Owner shallow; NativeSession sh(shallow.state_.generation());
  sh.api.reset(new StarfishMediaAPIs); sh.loaded=true;
  sh.video_configuration.Update(1920,1080,false,8,true);
  assert(shallow.state_.Enqueue(sh.generation,Stream::kAudio,
      {Packet(0),Packet(100000),Packet(2000000)})==State::EnqueueResult::kAccepted);
  assert(shallow.state_.Enqueue(sh.generation,Stream::kVideo,
      {Packet(0,true),Packet(100000),Packet(500000)})==State::EnqueueResult::kAccepted);
  sh.frame_count=3; sh.frame_ns=200000000;
  shallow.Rate(1.75); shallow.Step(sh);
  assert(sh.rate_deferred && sh.api->rate_calls==0 && shallow.error_.empty());
  assert(shallow.state_.Enqueue(sh.generation,Stream::kVideo,
      {Packet(1200000)})==State::EnqueueResult::kAccepted);
  shallow.Step(sh);
  assert(sh.api->rate_calls==1 && sh.rate==1.75 && shallow.error_.empty());

  // Missing history never forces a flush. After five seconds report an
  // explicit player error with the old rate intact; Cobalt requires recreation.
  Owner timeout; NativeSession ts(timeout.state_.generation());
  ts.api.reset(new StarfishMediaAPIs);
  ts.video_configuration.Update(1920,1080,false,8,true);
  ts.loaded=true;
  timeout.rate_=1.75;
  timeout.Step(ts);
  assert(ts.api->rate_calls==0 && ts.rate_deferred);
  now_us = ts.rate_deferred_at + 2 * kSecond + 1;
  timeout.Step(ts);
  assert(ts.api->rate_calls==0 && ts.rate==1 && ts.rate_deferred);
  now_us=ts.rate_deferred_at+kStarfishRateTransitionDeadlineUs;
  timeout.Step(ts);
  assert(ts.api->rate_calls==0 && ts.rate==1 && !timeout.error_.empty());
  timeout.Seek(100000);
  assert(timeout.error_.empty() && timeout.rate_==1.75);

  // A pause/resume must not be used to fake a rate change: this firmware
  // restores the stored rate on Play, so the call has to stay a SetPlayRate.
  replay_enabled = true;  // an earlier case disables replay
  // Exactly 1x cannot be applied in place by this firmware, so the bridge
  // reloads the session at the presented position from the retained GOP and
  // never sends playRate 1.0.
  replay_enabled = true;
  Owner lower; NativeSession lw(lower.state_.generation()); Seed(lower,lw);
  lw.rate = 1.75; lw.api->calls.clear();
  lower.rate_ = 1; ++now_us; lower.Step(lw);
  assert(lw.api->rate_calls == 0 && lower.restart_pending_);
  assert(!lower.restart_video_.empty() && lower.restart_video_.front().keyframe);
  assert(lower.restart_target_ == lower.current_);

  // From below too: 0.5 -> 1 is a request for 1x and takes the same reload.
  Owner from_below; NativeSession bw(from_below.state_.generation()); Seed(from_below,bw);
  bw.rate = 0.5; bw.api->calls.clear();
  from_below.rate_ = 1; ++now_us; from_below.Step(bw);
  assert(bw.api->rate_calls == 0 && from_below.restart_pending_);
  assert(!from_below.restart_video_.empty() && from_below.restart_video_.front().keyframe);

  // Losing history must never turn Normal into a successful no-op, even after
  // the generic rate deferral deadline. New GOP coverage retries the reload.
  Owner lost; NativeSession lost_session(lost.state_.generation()); Seed(lost,lost_session);
  lost_session.rate=1.75;
  lost_session.video_history.Accept(
      {std::make_shared<Buffer>(),17*1024*1024,300000},false,lost.current_);
  lost.rate_=1; lost.Step(lost_session);
  assert(lost_session.rate_deferred && !lost.restart_pending_);
  now_us=lost_session.rate_deferred_at+2*kSecond+1;
  lost.Step(lost_session);
  assert(lost_session.api->rate_calls==0 && lost_session.rate==1.75);
  assert(lost_session.rate_deferred && !lost.restart_pending_);
  lost_session.video_history.Accept(Packet(100000,true),true,lost.current_);
  lost.Step(lost_session);
  assert(lost.restart_pending_ && lost_session.api->rate_calls==0);

  // A distant video keyframe cannot be replayed with audio retained near the
  // current position. Wait for the next GOP without rewinding or rate=1.0.
  Owner distant; NativeSession ds2(distant.state_.generation()); Seed(distant,ds2);
  distant.current_=4000000; ds2.frame_ns=4000000000LL; ds2.rate=1.75;
  ds2.audio_history.Accept(Packet(3900000),false,distant.current_);
  ds2.audio_history.Accept(Packet(4100000),false,distant.current_);
  distant.rate_=1; distant.Step(ds2);
  now_us=ds2.rate_deferred_at+2*kSecond+1;
  distant.Step(ds2);
  assert(ds2.rate_deferred && !distant.restart_pending_ && ds2.api->rate_calls==0);
  ds2.video_history.Accept(Packet(4000000,true),true,distant.current_);
  assert(distant.state_.Enqueue(ds2.generation,Stream::kAudio,
      {Packet(5000000)})==State::EnqueueResult::kAccepted);
  assert(distant.state_.Enqueue(ds2.generation,Stream::kVideo,
      {Packet(6000000)})==State::EnqueueResult::kAccepted);
  distant.Step(ds2);
  assert(distant.restart_pending_ && distant.restart_target_==4000000);
  assert(distant.restart_video_.front().packet.pts_us==4000000);
  assert(ds2.api->rate_calls==0);

  // A permanent shortage gives Normal a defined failure, preserving its actual
  // applied rate. No fake success is exposed through the media clock.
  Owner exhausted; NativeSession ex(exhausted.state_.generation()); Seed(exhausted,ex);
  ex.rate=0.5; exhausted.Rate(1);
  ex.video_history.Accept({std::make_shared<Buffer>(),17*1024*1024,300000},false,exhausted.current_);
  exhausted.Step(ex);
  assert(ReportedRate(exhausted)==0.5);
  now_us=ex.rate_deferred_at+kStarfishRateTransitionDeadlineUs;
  exhausted.Step(ex);
  assert(!exhausted.error_.empty() && ex.rate==0.5 && ex.api->rate_calls==0);
  assert(ReportedRate(exhausted)==0.5 && !exhausted.restart_pending_);

  // Presentation alone is a hard gate even with intact replay coverage.
  Owner no_frame; NativeSession nf(no_frame.state_.generation()); Seed(no_frame,nf);
  nf.frame_count=0; no_frame.Rate(1.75); no_frame.Step(nf);
  now_us=nf.rate_deferred_at+kStarfishRateTransitionDeadlineUs;
  no_frame.Step(nf);
  assert(nf.api->rate_calls==0 && nf.rate==1 && !no_frame.error_.empty());

  // A paused request never expires or repeatedly flushes the decoder. Resume
  // starts a fresh active deadline instead of inheriting time spent paused.
  Owner pause_wait; NativeSession pw(pause_wait.state_.generation()); Seed(pause_wait,pw);
  pw.frame_count=0; pause_wait.Rate(1.5); pause_wait.Step(pw);
  pause_wait.Pause(true); now_us+=4*kSecond; pause_wait.Step(pw);
  assert(!pw.rate_deferred && ReportedRate(pause_wait)==0);
  now_us+=10*kSecond; pause_wait.Step(pw);
  assert(pause_wait.error_.empty() && pw.api->rate_calls==0);
  pause_wait.Pause(false); pause_wait.Step(pw);
  assert(pw.rate_deferred_at==now_us && pause_wait.error_.empty());
  pw.frame_count=2; pause_wait.Step(pw);
  assert(pw.rate==1.5 && pw.api->rate_calls==1);

  // With diagnostic replay disabled, Normal also stays pending rather than
  // claiming success from the firmware's ineffective default-rate command.
  Owner disabled_normal; NativeSession dn(disabled_normal.state_.generation()); Seed(disabled_normal,dn);
  dn.rate=0.5; disabled_normal.rate_=1; replay_enabled=false;
  disabled_normal.Step(dn);
  now_us=dn.rate_deferred_at+2*kSecond+1;
  disabled_normal.Step(dn);
  assert(dn.rate==0.5 && dn.rate_deferred && dn.api->rate_calls==0);
  replay_enabled=true;

  // Exercise a seek at the publication boundary, after the old generation's
  // snapshots exist. It must not install those snapshots into the new seek.
  Owner cancelled; NativeSession cs(cancelled.state_.generation()); Seed(cancelled,cs);
  cs.rate=1.75; cancelled.rate_=1;
  cancelled.before_rate_hook=[&] {
    Guard guard(cancelled.mutex_);
    assert(cancelled.state_.Reset());
    cancelled.restart_pending_=false;
    cancelled.restart_audio_.clear(); cancelled.restart_video_.clear();
  };
  cancelled.Step(cs);
  assert(!cancelled.restart_pending_ && cancelled.restart_audio_.empty());
  assert(cancelled.restart_video_.empty() && cs.api->rate_calls==0);

  // A newer rate request at the same boundary also cancels the old reload.
  Owner replaced; NativeSession replacement(replaced.state_.generation()); Seed(replaced,replacement);
  replacement.rate=1.75; replaced.rate_=1;
  replaced.before_rate_hook=[&] { Guard guard(replaced.mutex_); replaced.rate_=1.5; };
  replaced.Step(replacement);
  assert(!replaced.restart_pending_ && replacement.api->rate_calls==0);

  // Every other rate, including downward, is sent unchanged in place.
  Owner forward; NativeSession fw(forward.state_.generation()); Seed(forward,fw);
  forward.rate_ = 1.5; ++now_us; forward.Step(fw);
  assert(fw.api->last_rate == std::string("{\"playRate\":1.5000,\"audioOutput\":true}"));
  fw.rate = 1.5; forward.rate_ = 0.5; ++now_us; forward.Step(fw);
  assert(fw.api->last_rate == std::string("{\"playRate\":0.5000,\"audioOutput\":true}"));
  assert(!forward.restart_pending_);

  // A new rate request gets its own deferral window even after the previous
  // request's window expired.
  Owner renewed; NativeSession rs2(renewed.state_.generation());
  rs2.api.reset(new StarfishMediaAPIs);
  rs2.video_configuration.Update(1920,1080,false,8,true);
  rs2.loaded=true;
  renewed.rate_=1.75;
  renewed.Step(rs2);
  assert(rs2.rate_deferred && rs2.api->rate_calls==0);
  now_us = rs2.rate_deferred_at + 2 * kSecond + 1;
  renewed.rate_=1.5;
  renewed.Step(rs2);
  assert(rs2.rate_deferred && rs2.rate_deferred_value==1.5 && rs2.api->rate_calls==0);
  now_us = rs2.rate_deferred_at + 2 * kSecond + 1;
  renewed.Step(rs2);
  assert(rs2.api->rate_calls==0 && rs2.rate==1 && rs2.rate_deferred);
  now_us=rs2.rate_deferred_at+kStarfishRateTransitionDeadlineUs;
  renewed.Step(rs2);
  assert(rs2.api->rate_calls==0 && !renewed.error_.empty());

  // Withdrawn rate requests must clear the deferral timer.
  Owner withdrawn; NativeSession ws2(withdrawn.state_.generation());
  ws2.api.reset(new StarfishMediaAPIs);
  ws2.video_configuration.Update(1920,1080,false,8,true);
  ws2.loaded=true;
  withdrawn.rate_=1.75;
  withdrawn.Step(ws2);
  assert(ws2.rate_deferred && ws2.rate_deferred_at!=0);
  withdrawn.rate_=1;
  withdrawn.Step(ws2);
  assert(!ws2.rate_deferred && ws2.rate_deferred_at==0);
  withdrawn.rate_=1.5;
  withdrawn.Step(ws2);
  assert(ws2.rate_deferred && ws2.api->rate_calls==0);

  // Diagnostic mode without replay still applies the rate before the first
  // feed, when the pipeline is empty.
  Owner no_replay; NativeSession ns(no_replay.state_.generation());
  ns.api.reset(new StarfishMediaAPIs);
  ns.video_configuration.Update(1920,1080,false,8,true);
  no_replay.rate_=1.75;
  replay_enabled=false;
  assert(no_replay.state_.Enqueue(ns.generation, Stream::kAudio, {Packet(0),Packet(2000000)}) == State::EnqueueResult::kAccepted);
  assert(no_replay.state_.Enqueue(ns.generation, Stream::kVideo, {Packet(0,true),Packet(2000000)}) == State::EnqueueResult::kAccepted);
  no_replay.Step(ns);
  replay_enabled=true;
  assert(ns.api->rate_calls==1 && ns.api->fed_before_rate==0 && ns.rate==1.75);

  // A rejected pre-feed rate is attempted once; the post-load path retries it.
  Owner rejected_initial; NativeSession ris(rejected_initial.state_.generation());
  ris.api.reset(new StarfishMediaAPIs);
  ris.video_configuration.Update(1920,1080,false,8,true);
  ris.api->reject_rate=true;
  rejected_initial.rate_=1.75;
  replay_enabled=false;
  rejected_initial.Step(ris);
  rejected_initial.Step(ris);
  assert(ris.api->rate_calls==1);
  ris.api->reject_rate=false;
  ris.loaded=true;
  assert(rejected_initial.state_.Enqueue(ris.generation, Stream::kAudio, {Packet(0),Packet(2000000)}) == State::EnqueueResult::kAccepted);
  assert(rejected_initial.state_.Enqueue(ris.generation, Stream::kVideo, {Packet(0,true),Packet(2000000)}) == State::EnqueueResult::kAccepted);
  rejected_initial.Step(ris);
  replay_enabled=true;
  assert(ris.api->rate_calls==1 && ris.rate==1 && ris.rate_deferred);
  ris.frame_count.store(2);
  ris.frame_ns=200000000;
  rejected_initial.Step(ris);
  assert(ris.api->rate_calls==2 && ris.rate==1.75);

  Owner disabled; NativeSession ds(disabled.state_.generation()); Seed(disabled,ds);
  replay_enabled=false; disabled.rate_=1.25; disabled.Step(ds);
  assert(ds.api->rate_calls==0 && ds.rate_deferred && ds.rate==1);
  replay_enabled=true;
  Owner rejected; NativeSession rs(rejected.state_.generation()); Seed(rejected,rs);
  rs.api->reject_rate=true; rejected.rate_=1.25; rejected.Step(rs);
  assert(!rejected.error_.empty() && rs.rate==1 && !rs.replaying);

  // A deferred rate must not discard an active replay's queues.
  Owner active; NativeSession as(active.state_.generation()); Seed(active,as);
  active.rate_=1.25; active.Step(as);
  assert(as.replaying && as.audio_replay.size()==3 && as.video_replay.size()==3);
  as.video_history.Accept({std::make_shared<Buffer>(), 17*1024*1024, 300000}, false, 100000);
  as.audio_history.Accept({std::make_shared<Buffer>(), 2*1024*1024, 400000}, false, 100000);
  as.api->full=true;
  active.rate_=1.5; active.Step(as);
  assert(as.rate_deferred && as.replaying);
  assert(as.audio_replay.size()==3 && as.video_replay.size()==3);
  as.api->full=false;

  // Missing keyframe coverage defers the rate rather than replaying a partial GOP.
  Owner missing; NativeSession ms(missing.state_.generation()); Seed(missing,ms);
  ms.video_history.Accept(Packet(250000, false), false, 100000);
  ms.video_history.Accept({std::make_shared<Buffer>(), 17*1024*1024, 300000}, false,100000);
  missing.rate_=1.25; missing.Step(ms);
  assert(ms.rate_deferred && ms.api->rate_calls==0);
  assert(!ms.replaying && ms.video_replay.empty());

  // The five-second lookahead still bounds replay and exposes limiter hits.
  Owner bounded; NativeSession bs(bounded.state_.generation()); Seed(bounded,bs);
  bs.replaying=true; bs.video_replay.push_back({Packet(6000000,true),true});
  bounded.Feed(bs,Stream::kVideo);
  assert(bs.video_limit_hits==1 && bs.video_replay.size()==1);
  // Retarget expiry preserves the exact target and retained GOP at native 1x.
  Owner failed_seek;
  failed_seek.Seek(10*kSecond);
  auto gen=failed_seek.state_.generation();
  failed_seek.state_.Enqueue(gen,Stream::kVideo,{Packet(5*kSecond,true),Packet(15*kSecond)});
  failed_seek.state_.Enqueue(gen,Stream::kAudio,{Packet(10*kSecond-100000)});
  failed_seek.first_audio_=failed_seek.first_video_=true;
  failed_seek.first_audio_pts_=10*kSecond-100000;
  failed_seek.first_video_pts_=5*kSecond; failed_seek.video_bits_=8;
  assert(!failed_seek.AcquireSeekStart(gen));
  now_us+=kStarfishSeekRetargetDeadlineUs;
  assert(failed_seek.AcquireSeekStart(gen) && failed_seek.error_.empty());
  assert(failed_seek.AcquireSeekStart(gen));
  auto exact=failed_seek.Start(gen);
  assert(exact && exact->rate==1 && failed_seek.current_==10*kSecond);
  assert(exact->plan.target_native_us-exact->plan.epoch_us==10*kSecond);
  assert(failed_seek.state_.queued_packets(Stream::kVideo)==2);
  exact->loaded=true; failed_seek.Rate(1.75);
  failed_seek.Step(*exact);
  assert(exact->api->rate_calls==0 && exact->rate_deferred);
  NativeSession::Callback(PF_EVENT_TYPE_FRAMEREADY,
      (exact->plan.target_native_us-100000)*1000,nullptr,exact.get());
  NativeSession::Callback(PF_EVENT_TYPE_FRAMEREADY,
      exact->plan.target_native_us*1000,nullptr,exact.get());
  failed_seek.Step(*exact);
  assert(exact->api->rate_calls==0); // still only seek preroll

  TestInitialRateBeforeFirstPlay();
  TestPausedInitialRateAndMissingReplay();
  TestInitialRequestReplacementAndSeekCancellation();
  TestShortAudioPrerollSeek();
  TestProgressingLongGopNormal();
  TestRateAtDrainedEos();
  TestStallAfterDeferredProgress();
  TestCodecLifecycles();
  std::puts("Actual Starfish Feed/Step rate-transition regressions passed");
}
'''
# Inject a deterministic interleaving before the production snapshot logger
# takes its lock. The reload publication must re-check generation and rate.
snapshot = method('  void RateSnapshot(').replace(
    '    Guard guard(mutex_);',
    '    if (before_rate_hook && std::strcmp(reason, "before-rate")==0) before_rate_hook();\n'
    '    Guard guard(mutex_);', 1)
fixture = (fixture.replace('\nSESSION\n', '\n' + session + '\n')
           .replace('\nFEED\n', '\n' + method('  void Feed(') + '\n')
           .replace('\nSNAPSHOT\n', '\n' + snapshot + '\n')
           .replace('\nSTEP\n', '\n' + step + '\n'))
for marker, signature in (
    ('HDR_TRANSFER', 'bool IsHdrTransfer('),
    ('CODEC_NAME', 'const char* CodecName('),
    ('VIDEO_SUPPORTED', 'bool IsVideoConfigurationSupported('),
    ('SEEK', '  void Seek(SbTime target)'),
    ('TIME', '  SbTime Time('),
    ('PAUSE', '  void Pause(bool paused)'),
    ('RATE', '  void Rate(double rate)'),
    ('SESSION_START', '  SbTime SessionStart()'),
    ('SYNC_FIRST', '  void SyncRetargetedFirstPackets()'),
    ('TRACE_RETARGET', '  void TraceRetarget('),
    ('ACQUIRE_SEEK', '  bool AcquireSeekStart('),
    ('START', '  std::unique_ptr<NativeSession> Start('),
):
    fixture = fixture.replace('\n' + marker + '\n', '\n' + method(signature) + '\n')
with tempfile.TemporaryDirectory(prefix='ytaf-rate-') as temp:
    root=Path(temp)
    (root/'test.cc').write_text(fixture)
    subprocess.run([os.environ.get('CXX','c++'), '-std=c++14', '-Wall', '-Wextra', '-Werror',
                    '-I'+str(repo/'cobalt-platform/webos/arm'), str(root/'test.cc'),
                    '-o', str(root/'test')], check=True)
    subprocess.run([str(root/'test')], check=True)

# Compile the real logging function for each Cobalt build type. The transition
# tests above intentionally silence logs; this independently checks the gate.
logging_fixture = r'''
#include <atomic>
#include <cstdarg>
#include <cstdio>
long long SbTimeGetMonotonicNow() { return 123; }
TRACE_RATE
int main() {
  for (int i = 0; i < 513; ++i) TraceRate("probe=%d", i);
}
'''.replace('TRACE_RATE', method('void TraceRate('))
with tempfile.TemporaryDirectory(prefix='ytaf-rate-log-') as temp:
    root = Path(temp)
    (root / 'test.cc').write_text(logging_fixture)
    for build_type in ('DEVEL', 'GOLD', 'QA', 'DEBUG'):
        binary = root / build_type
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++14',
                        '-Wall', '-Wextra', '-Werror',
                        '-DSTARBOARD_BUILD_TYPE_' + build_type,
                        str(root / 'test.cc'), '-o', str(binary)], check=True)
        result = subprocess.run([str(binary)], capture_output=True, text=True, check=True)
        assert not result.stdout
        lines = result.stderr.splitlines()
        if build_type == 'DEVEL':
            assert len(lines) == 512
            assert lines[0] == '[YTAF rate monotonic_us=123] probe=0'
            assert lines[-1] == '[YTAF rate monotonic_us=123] probe=511'
        else:
            assert not lines, (build_type, result.stderr)
print('Rate diagnostics: Devel enabled and bounded; Gold/QA/Debug silent')
