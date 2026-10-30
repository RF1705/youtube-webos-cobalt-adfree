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
#include <cstdio>
#include <cstring>
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
struct VideoInfo {
  int frame_width=1920, frame_height=1080;
  bool is_key_frame=false;
  struct { int transfer=1, bits_per_channel=8; } color_metadata;
};
struct Buffer {
  VideoInfo info;
  const VideoInfo& video_sample_info() const { return info; }
  const void* data() const { return this; }
};
using State = StarfishAvSessionState<std::shared_ptr<Buffer>>;
using Stream = State::Stream;
bool IsHdrTransfer(int) { return false; }
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
};
enum { PF_EVENT_TYPE_FRAMEREADY, PF_EVENT_TYPE_STR_STATE_UPDATE__LOADCOMPLETED,
       PF_EVENT_TYPE_STR_STATE_UPDATE__UNLOADCOMPLETED,
       PF_EVENT_TYPE_STR_STATE_UPDATE__ENDOFSTREAM, PF_EVENT_TYPE_INT_ERROR,
       PF_EVENT_TYPE_STR_ERROR };
struct StarfishMediaAPIs {
  struct Fed { int64_t pts; int stream; };
  std::vector<Fed> fed;
  bool full=false, reject_rate=false;
  int rate_calls=0, eos_calls=0;
  std::string last_rate;
  std::string Feed(const char* payload) {
    if (full) return "BufferFull";
    const auto* pts = std::strstr(payload, "\"pts\":");
    const auto* stream = std::strstr(payload, "\"esData\":");
    fed.push_back({std::stoll(pts + 6), std::stoi(stream + 9)});
    return "Ok";
  }
  bool SetPlayRate(const char* payload) {
    ++rate_calls; last_rate = payload;
    if (reject_rate) return false;
    fed.clear(); // model the observed native buffer flush
    return true;
  }
  bool Play() { return true; }
  bool Pause() { return true; }
  bool setHdrInfo(const char*) { return true; }
  bool setVolume(const char*) { return true; }
  bool pushEOS() { ++eos_calls; return true; }
};
SESSION
struct Owner {
  mutable std::mutex mutex_;
  State state_{{256, 1024*1024}, {128, 8*1024*1024}};
  SbTime current_=100000, frame_time_=0;
  bool paused_=false, video_hdr_=false, ready_=false, playing_=false, have_frame_=false;
  double rate_=1, volume_=1;
  std::string hdr_payload_, error_;
  bool Current(uint64_t g) const { return g == state_.generation() && error_.empty(); }
  void FailLocked(const std::string& e) { error_=e; }
  void FailSession(const NativeSession&, const std::string& e) { error_=e; }
FEED
SNAPSHOT
STEP
};
State::Packet Packet(int64_t pts, bool key=false) {
  auto b=std::make_shared<Buffer>(); b->info.is_key_frame=key; return {b, 100, pts};
}
void Seed(Owner& owner, NativeSession& session) {
  session.api.reset(new StarfishMediaAPIs);
  session.loaded=true;
  session.video_configuration.Update(1920,1080,false,8,true);
  session.frame_ns=100000000;
  assert(owner.state_.Enqueue(session.generation, Stream::kAudio,
    {Packet(0), Packet(100000), Packet(200000)}) == State::EnqueueResult::kAccepted);
  assert(owner.state_.Enqueue(session.generation, Stream::kVideo,
    {Packet(0,true), Packet(100000), Packet(200000)}) == State::EnqueueResult::kAccepted);
  owner.Step(session);
  assert(owner.error_.empty() && session.api->fed.size()==6);
}
int main() {
  Owner owner; NativeSession session(owner.state_.generation()); Seed(owner,session);
  owner.rate_=1.25; ++now_us; owner.Step(session);
  assert(session.api->rate_calls==1 && session.replaying && session.rate==1.25);
  assert(session.audio_replay.size()==3 && session.video_replay.size()==3);
  assert(session.api->fed.empty());
  auto next=Packet(300000);
  owner.state_.Enqueue(session.generation, Stream::kVideo, {next});
  session.api->full=true; owner.Step(session);
  assert(session.video_replay.size()==3 && owner.state_.queued_packets(Stream::kVideo)==1);
  session.api->full=false; owner.Step(session);
  assert(!session.replaying && session.api->fed.size()==6);
  assert(owner.state_.queued_packets(Stream::kVideo)==1); // replay must not consume fresh input
  assert(session.api->fed[3].stream==1 && session.api->fed[3].pts==0); // video starts at key
  owner.Step(session);
  assert(owner.state_.queued_packets(Stream::kVideo)==0 && session.api->fed.size()==7);
  owner.rate_=0; owner.Step(session);
  owner.rate_=1.25; owner.Step(session);
  assert(session.api->rate_calls==1); // pause/resume is not a new native speed
  owner.rate_=1.5; owner.Step(session);
  owner.rate_=2; owner.Step(session); // rapid second change rebuilds the snapshot
  assert(session.api->rate_calls==3 && session.replaying);
  assert(session.video_replay.front().keyframe);

  // Input EOS must wait until replay drains; native EOS must be resent.
  owner.state_.WriteEos(session.generation,Stream::kAudio);
  owner.state_.WriteEos(session.generation,Stream::kVideo);
  owner.Step(session);
  assert(session.api->eos_calls==1);
  owner.rate_=1; owner.Step(session);
  assert(session.replaying && session.api->eos_calls==1);
  owner.Step(session);
  assert(session.api->eos_calls==2);

  // A real seek invalidates the entire session, including its retained history.
  assert(owner.state_.Reset());
  const auto count=session.api->fed.size(); owner.Feed(session,Stream::kVideo);
  assert(session.api->fed.size()==count);

  Owner disabled; NativeSession ds(disabled.state_.generation()); Seed(disabled,ds);
  replay_enabled=false; disabled.rate_=1.25; disabled.Step(ds);
  assert(ds.api->rate_calls==1 && !ds.replaying && ds.video_replay.empty());
  replay_enabled=true;
  Owner rejected; NativeSession rs(rejected.state_.generation()); Seed(rejected,rs);
  rs.api->reject_rate=true; rejected.rate_=1.25; rejected.Step(rs);
  assert(!rejected.error_.empty() && rs.rate==1 && !rs.replaying);

  // Missing keyframe coverage leaves the old behavior observable, not a partial GOP replay.
  Owner missing; NativeSession ms(missing.state_.generation()); Seed(missing,ms);
  ms.video_history.Accept(Packet(250000, false), false, 100000);
  ms.video_history.Accept({std::make_shared<Buffer>(), 17*1024*1024, 300000}, false,100000);
  missing.rate_=1.25; missing.Step(ms);
  assert(!ms.replaying && ms.video_replay.empty());

  // The five-second lookahead still bounds replay and exposes limiter hits.
  Owner bounded; NativeSession bs(bounded.state_.generation()); Seed(bounded,bs);
  bs.replaying=true; bs.video_replay.push_back({Packet(6000000,true),true});
  bounded.Feed(bs,Stream::kVideo);
  assert(bs.video_limit_hits==1 && bs.video_replay.size()==1);
  std::puts("Actual Starfish Feed/Step rate-transition regressions passed");
}
'''
fixture = (fixture.replace('SESSION', session).replace('FEED', method('  void Feed('))
           .replace('SNAPSHOT', method('  void RateSnapshot(')).replace('STEP', step))
with tempfile.TemporaryDirectory(prefix='ytaf-rate-') as temp:
    root=Path(temp)
    (root/'test.cc').write_text(fixture)
    subprocess.run([os.environ.get('CXX','c++'), '-std=c++14', '-Wall', '-Wextra', '-Werror',
                    '-I'+str(repo/'cobalt-platform/webos/arm'), str(root/'test.cc'),
                    '-o', str(root/'test')], check=True)
    subprocess.run([str(root/'test')], check=True)
