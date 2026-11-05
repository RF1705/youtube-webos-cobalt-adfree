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
  int rate_calls=0, eos_calls=0, fed_before_rate=-1;
  std::string last_rate;
  std::string Feed(const char* payload) {
    if (full) return "BufferFull";
    const auto* pts = std::strstr(payload, "\"pts\":");
    const auto* stream = std::strstr(payload, "\"esData\":");
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
  session.frame_count.store(10);  // the session is presenting
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
    {Packet(0), Packet(100000), Packet(200000)}) == State::EnqueueResult::kAccepted);
  assert(waiting.state_.Enqueue(ws.generation, Stream::kVideo,
    {Packet(0,true), Packet(100000), Packet(200000)}) == State::EnqueueResult::kAccepted);
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
  assert(later.state_.Enqueue(ls.generation, Stream::kAudio, {Packet(0)}) == State::EnqueueResult::kAccepted);
  assert(later.state_.Enqueue(ls.generation, Stream::kVideo, {Packet(0,true)}) == State::EnqueueResult::kAccepted);
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
  assert(us.api->rate_calls==1 && us.rate==1.75 && us.replaying && !us.rate_deferred);

  // Bounded history that never covers the GOP must not defer forever.
  Owner timeout; NativeSession ts(timeout.state_.generation());
  ts.api.reset(new StarfishMediaAPIs);
  ts.video_configuration.Update(1920,1080,false,8,true);
  ts.loaded=true;
  timeout.rate_=1.75;
  timeout.Step(ts);
  assert(ts.api->rate_calls==0 && ts.rate_deferred);
  now_us = ts.rate_deferred_at + 2 * kSecond + 1;
  timeout.Step(ts);
  assert(ts.api->rate_calls==1 && ts.rate==1.75 && !ts.replaying);

  // A pause/resume must not be used to fake a rate change: this firmware
  // restores the stored rate on Play, so the call has to stay a SetPlayRate.
  replay_enabled = true;  // an earlier case disables replay
  // Rates are sent unchanged and apply in place, upward or downward.
  Owner forward; NativeSession fw(forward.state_.generation()); Seed(forward,fw);
  forward.rate_ = 1.5; ++now_us; forward.Step(fw);
  assert(fw.api->last_rate == std::string("{\"playRate\":1.5000,\"audioOutput\":true}"));
  fw.rate = 1.5; forward.rate_ = 0.5; ++now_us; forward.Step(fw);
  assert(fw.api->last_rate == std::string("{\"playRate\":0.5000,\"audioOutput\":true}"));

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
  assert(rs2.api->rate_calls==1 && rs2.rate==1.5);

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
  assert(no_replay.state_.Enqueue(ns.generation, Stream::kAudio, {Packet(0)}) == State::EnqueueResult::kAccepted);
  assert(no_replay.state_.Enqueue(ns.generation, Stream::kVideo, {Packet(0,true)}) == State::EnqueueResult::kAccepted);
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
  assert(rejected_initial.state_.Enqueue(ris.generation, Stream::kAudio, {Packet(0)}) == State::EnqueueResult::kAccepted);
  assert(rejected_initial.state_.Enqueue(ris.generation, Stream::kVideo, {Packet(0,true)}) == State::EnqueueResult::kAccepted);
  rejected_initial.Step(ris);
  replay_enabled=true;
  assert(ris.api->rate_calls==2 && ris.rate==1.75);

  Owner disabled; NativeSession ds(disabled.state_.generation()); Seed(disabled,ds);
  replay_enabled=false; disabled.rate_=1.25; disabled.Step(ds);
  assert(ds.api->rate_calls==1 && !ds.replaying && ds.video_replay.empty());
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
