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
#include "starfish_rate_transition.h"
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
  int reject_rates_remaining=0;
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
    if (reject_rates_remaining > 0) { --reject_rates_remaining; return false; }
    // Client-side trick play changes speed in place: no native buffer flush,
    // so already fed input stays consumed.
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
  bool stopping_=false;
  uint64_t request_revision_=0;
  std::unique_ptr<RateReload> pending_reload_;
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
TAKE_RELOAD
SESSION_START
SYNC_FIRST
TRACE_RETARGET
ACQUIRE_SEEK
START
};
State::Packet Packet(int64_t pts, bool key=false) {
  auto b=std::make_shared<Buffer>(); b->info.is_key_frame=key; return {b, 100, pts, key};
}
void Seed(Owner& owner, NativeSession& session, double applied=1) {
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
  session.rate=applied;
}
double ReportedRate(Owner& owner) {
  bool playing, eos, underflow;
  double rate;
  owner.Time(&playing,&eos,&underflow,&rate);
  return rate;
}
void QueueNormalReload(Owner& owner, NativeSession& session, double requested=1) {
  Seed(owner,session,1.75);
  // Rejection forces the retained-GOP reload; the in-place path is tested
  // separately with a successful native call.
  session.api->reject_rate=true;
  owner.Rate(requested); owner.Step(session);
  assert(owner.pending_reload_);
  session.api->reject_rate=false;
}
void ExpectAppliedRate(Owner& owner, const NativeSession& session, double expected) {
  assert(session.rate==expected && ReportedRate(owner)==expected && owner.error_.empty());
}
void TestRateReloadHandoff() {
  // Fallback plumbing stays intact: a rejected Normal request publishes a
  // reload exactly once, and newer requests or a seek invalidate it.
  for (int change=0; change<4; ++change) {
    Owner handoff; NativeSession hs(handoff.state_.generation()); QueueNormalReload(handoff,hs);
    if (change==0) handoff.Rate(1.75);
    if (change==1) { handoff.Rate(1.5); handoff.Rate(1); }
    if (change==2) handoff.Seek(kSecond);
    if (change==3) handoff.Pause(true);
    const auto calls=hs.api->calls.size();
    assert(!handoff.TakeRateReload(hs.generation));
    assert(!handoff.pending_reload_ && hs.api->calls.size()==calls);
  }
  Owner committed; NativeSession committed_session(committed.state_.generation());
  QueueNormalReload(committed,committed_session);
  auto claimed=committed.TakeRateReload(committed_session.generation);
  assert(claimed && !committed.TakeRateReload(committed_session.generation));
  const auto retained=claimed->audio.size();
  committed.Seek(kSecond);
  assert(retained>0 && claimed->audio.size()==retained);
  assert(!committed.Start(committed_session.generation,std::move(claimed)));

  Owner after_claim; NativeSession ac(after_claim.state_.generation()); QueueNormalReload(after_claim,ac);
  auto plan=after_claim.TakeRateReload(ac.generation);
  assert(plan); after_claim.Rate(1.5);
  auto next=after_claim.Start(ac.generation,std::move(plan));
  assert(next && !next->initial_play_pending && next->rate==1);
  next->loaded=true; next->frame_count=2;
  next->frame_ns=(next->plan.target_native_us+200000)*1000;
  after_claim.Step(*next);
  ExpectAppliedRate(after_claim,*next,1.5);
  Owner near_normal; NativeSession nn(near_normal.state_.generation()); QueueNormalReload(near_normal,nn,1.00001);
  assert(near_normal.TakeRateReload(nn.generation));
}

void TestInPlaceRateChange() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  const auto fed=session.api->fed.size();
  owner.Rate(1.75); ++now_us; owner.Step(session);
  assert(session.api->rate_calls==1);
  assert(session.api->last_rate==std::string("{\"playRate\":1.7500,\"audioOutput\":true}"));
  assert(session.rate==1.75 && ReportedRate(owner)==1.75 && owner.error_.empty());
  assert(!session.replaying && session.audio_replay.empty() && session.video_replay.empty());
  assert(session.api->fed.size()==fed);           // no flush, nothing replayed
  assert(!bool(owner.pending_reload_) && !session.rate_transition.waiting());
  owner.Rate(0.5); ++now_us; owner.Step(session);
  assert(session.api->rate_calls==2);
  assert(session.api->last_rate==std::string("{\"playRate\":0.5000,\"audioOutput\":true}"));
  assert(session.rate==0.5 && ReportedRate(owner)==0.5);
  owner.Rate(1); ++now_us; owner.Step(session);
  assert(session.api->rate_calls==3 && session.rate==1 && ReportedRate(owner)==1);
  assert(!bool(owner.pending_reload_) && owner.error_.empty());
  ++now_us; owner.Step(session);
  assert(session.api->rate_calls==3);             // same request is a no-op
}

void TestPauseKeepsAppliedRate() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  owner.Rate(1.75); ++now_us; owner.Step(session);
  assert(session.rate==1.75 && session.api->rate_calls==1);
  owner.Pause(true); owner.Step(session);
  assert(!session.playing && session.api->calls.back()=="pause");
  assert(session.rate==1.75);                     // Pause keeps the applied rate
  const int calls=session.api->rate_calls;
  owner.Rate(1); ++now_us; owner.Step(session);
  assert(session.api->rate_calls==calls && session.rate==1.75);  // deferred
  now_us+=kSecond;  // resume respects the existing 250 ms replay guard
  owner.Pause(false); owner.Step(session);
  assert(session.api->rate_calls==calls+1 && session.rate==1);
  assert(session.api->calls[session.api->calls.size()-1]=="play");
  assert(session.api->calls[session.api->calls.size()-2]=="rate");
  assert(ReportedRate(owner)==1 && owner.error_.empty());
}

void TestTransientRejectionAppliesInPlace() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  session.api->reject_rates_remaining=1;
  owner.Rate(1.25); ++now_us; owner.Step(session);
  assert(session.api->rate_calls==1 && session.rate==1);
  assert(session.audio_replay.empty() && session.video_replay.empty());
  assert(!session.replaying && owner.error_.empty());
  now_us+=kSecond; owner.Step(session);
  assert(session.api->rate_calls==2 && session.rate==1.25);
  assert(session.api->last_rate==std::string("{\"playRate\":1.2500,\"audioOutput\":true}"));
  // The retry succeeded, so nothing may be replayed or flushed.
  assert(session.audio_replay.empty() && session.video_replay.empty());
  assert(!session.replaying && !bool(owner.pending_reload_));
  assert(ReportedRate(owner)==1.25 && owner.error_.empty());
}

void TestRejectedRateNeverClaimsSuccess() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  session.api->reject_rate=true; owner.Rate(1.5); ++now_us; owner.Step(session);
  assert(session.rate==1 && ReportedRate(owner)==1 && !session.replaying);
  now_us+=kStarfishRateTransitionDeadlineUs; owner.Step(session);
  assert(!owner.error_.empty() && session.rate==1);
  // Normal keeps the retained-GOP reload as the fallback.
  Owner lower; NativeSession lw(lower.state_.generation()); Seed(lower,lw,1.75); lw.api->calls.clear();
  lw.api->reject_rate=true; lower.Rate(1); ++now_us; lower.Step(lw);
  assert(lw.api->rate_calls==1 && bool(lower.pending_reload_));
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
    assert(session.playing);
    ExpectAppliedRate(owner,session,1.5);
    const int after_resume=session.api->rate_calls;
    owner.Rate(1); owner.Step(session);
    assert(session.api->rate_calls==after_resume+1 && session.rate==1);
    assert(!bool(owner.pending_reload_) && ReportedRate(owner)==1);
    assert(session.api->last_rate==std::string("{\"playRate\":1.0000,\"audioOutput\":true}"));

    // Repeated real Owner::Seek calls isolate old callbacks; the requested
    // rate applies in place once the new session is loaded.
    for (int attempt=1;attempt<=3;++attempt) {
      const int64_t target=attempt*kSecond;
      owner.Seek(target); owner.Rate(1.75);
      assert(!owner.pending_reload_);
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
      assert(fresh->api->rate_calls==1 && fresh->rate==1.75);
      assert(ReportedRate(owner)==1.75 && owner.error_.empty());
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
    assert(session->api->calls.empty()); // requested rate waits for the Load
    session->loaded=true; owner.Step(*session);
    if (rate==1) {
      assert(session->api->rate_calls==0 && session->api->calls==std::vector<std::string>{"play"});
    } else {
      assert(session->api->calls==std::vector<std::string>({"rate","play"}));
      assert(session->rate==rate);
    }
    assert(session->playing && !session->initial_play_pending);
    assert(session->rate==rate && owner.error_.empty());
    // Later changes stay in place, including after the startup exception.
    const int calls=session->api->rate_calls;
    owner.Rate(rate==1.75?1.5:1.75); owner.Step(*session);
    assert(session->api->rate_calls==calls+1);
    assert(session->rate==(rate==1.75?1.5:1.75) && owner.error_.empty());
    assert(!bool(owner.pending_reload_));
  }
}
void TestPausedStartupRate() {
  Owner paused; auto session=ColdSession(paused);
  paused.Pause(true); paused.Step(*session); session->loaded=true;
  paused.Step(*session);
  assert(session->api->calls.empty() && session->initial_play_pending);
  paused.Rate(1.75); paused.Step(*session);
  assert(session->api->calls.empty()); // no unsolicited Play/rate while paused
  paused.Pause(false); paused.Step(*session); paused.Step(*session);
  assert(session->api->calls==std::vector<std::string>({"rate","play"}));
  assert(session->rate==1.75);
}

void TestInitialRequestReplacementAndSeekCancellation() {
  Owner replaced; auto session=ColdSession(replaced);
  replaced.Step(*session); session->loaded=true; replaced.Rate(1.75);
  replaced.Step(*session);
  assert(session->rate==1.75 && session->api->rate_calls==1);
  replaced.Rate(1.5); replaced.Step(*session);
  assert(session->rate==1.5 && session->api->rate_calls==2);
  assert(session->playing && replaced.error_.empty());

  // A seek published during the fallback snapshot keeps the stale reload out
  // of the new generation.
  Owner cancelled; NativeSession stale(cancelled.state_.generation());
  Seed(cancelled,stale,1.75);
  stale.api->reject_rate=true;
  cancelled.Rate(1);
  cancelled.before_rate_hook=[&] { cancelled.Seek(kSecond); };
  cancelled.Step(stale);
  assert(stale.generation!=cancelled.state_.generation());
  assert(cancelled.error_.empty() && !bool(cancelled.pending_reload_));
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
  assert(owner.AcquireSeekStart(generation));
  auto session=owner.Start(generation);
  assert(session && owner.error_.empty());
  assert(owner.current_==requested);
  assert(session->plan.target_native_us==requested);
  assert(session->plan.discard_samples==1616 && session->rate==1);
  assert(owner.state_.queued_packets(Stream::kAudio)==1);
  assert(owner.state_.queued_packets(Stream::kVideo)==2);
}

void TestLongGopDoesNotBlockRateChange() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  owner.current_=2*kSecond; session.rate=0.5; owner.Rate(1);
  // Sparse GOP anchors do not gate an in-place transition.
  session.video_history.Accept({std::make_shared<Buffer>(),17*1024*1024,0},false,0);
  session.video_history.Accept(Packet(6000000,true),true,owner.current_);
  for (int tick=0;tick<4;++tick) {
    owner.current_=2000000+tick*500000;
    session.frame_ns=owner.current_*1000; session.frame_count=100+tick;
    owner.Step(session);
    assert(owner.error_.empty());
  }
  assert(session.api->rate_calls==1 && session.rate==1 && ReportedRate(owner)==1);
  assert(!bool(owner.pending_reload_));
}

void TestRateAtDrainedEos() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  owner.current_=9200000; session.rate=0.1; owner.Rate(1.75);
  owner.audio_eos_=owner.video_eos_=true;
  owner.state_.WriteEos(session.generation,Stream::kAudio);
  owner.state_.WriteEos(session.generation,Stream::kVideo);
  owner.Step(session);
  assert(session.api->rate_calls==1 && session.rate==1.75 && owner.error_.empty());
  assert(session.api->eos_calls==1);
  NativeSession::Callback(PF_EVENT_TYPE_STR_STATE_UPDATE__ENDOFSTREAM,0,nullptr,&session);
  owner.Step(session);
  assert(owner.state_.ended() && owner.error_.empty());
}

int main() {
  TestInPlaceRateChange();
  TestPauseKeepsAppliedRate();
  TestInitialRateBeforeFirstPlay();
  TestPausedStartupRate();
  TestInitialRequestReplacementAndSeekCancellation();
  TestShortAudioPrerollSeek();
  TestLongGopDoesNotBlockRateChange();
  TestRateAtDrainedEos();
  TestTransientRejectionAppliesInPlace();
  TestRejectedRateNeverClaimsSuccess();
  TestCodecLifecycles();
  TestRateReloadHandoff();

  // Bounded replay still applies to the fallback replay path.
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
  assert(exact->api->rate_calls==1 && exact->rate==1.75);
  assert(failed_seek.error_.empty());
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
           .replace('\nSTEP\n', '\n' + method('  bool UpdatePlaybackRate(') + '\n' +
                    step + '\n'))
for marker, signature in (
    ('HDR_TRANSFER', 'bool IsHdrTransfer('),
    ('CODEC_NAME', 'const char* CodecName('),
    ('VIDEO_SUPPORTED', 'bool IsVideoConfigurationSupported('),
    ('SEEK', '  void Seek(SbTime target)'),
    ('TIME', '  SbTime Time('),
    ('PAUSE', '  void Pause(bool paused)'),
    ('RATE', '  void Rate(double rate)'),
    ('TAKE_RELOAD', '  std::unique_ptr<RateReload> TakeRateReload('),
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
