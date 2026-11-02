#include <cassert>
#include <iostream>
#include <memory>
#include "starfish_rate_replay.h"
#include "starfish_av_session_state.h"

using namespace starboard::shared::webos;
using State = StarfishAvSessionState<std::shared_ptr<int>>;
using Replay = StarfishRateReplay<State::Packet>;
State::Packet Packet(int value, int64_t pts, size_t bytes = 10) {
  return {std::make_shared<int>(value), bytes, pts};
}

int main() {
  std::deque<Replay::Entry> replay;
  Replay video(10, 100, true);
  auto key = Packet(1, 0);
  std::weak_ptr<int> lifetime = key.buffer;
  video.Accept(key, true, 0);
  key.buffer.reset();
  video.Accept(Packet(2, 33000), false, 33000);
  video.Accept(Packet(3, 66000), false, 33000);
  assert(video.Snapshot(33000, &replay));
  assert(replay.size() == 3 && replay.front().keyframe);
  assert(!lifetime.expired());
  // Retain an earlier GOP until presentation actually reaches the next key.
  video.Accept(Packet(4, 100000), true, 33000);
  assert(video.Snapshot(66000, &replay) && replay.size() == 4);
  assert(video.Snapshot(100000, &replay) && replay.size() == 1);
  assert(lifetime.expired());

  // Byte/count eviction cannot replay a partial GOP. Recover at the next key.
  Replay small(2, 20, true);
  small.Accept(Packet(1, 0), true, 0);
  small.Accept(Packet(2, 1000), false, 0);
  small.Accept(Packet(3, 2000), false, 0);
  assert(small.bytes() <= 20 && small.size() <= 2);
  assert(!small.Snapshot(2000, &replay) && replay.empty());
  small.Accept(Packet(4, 3000), true, 2000);
  assert(!small.Snapshot(2000, &replay));
  assert(small.Snapshot(3000, &replay) && replay.front().keyframe);
  small.Accept(Packet(5, 4000, 21), false, 3000);
  small.Accept(Packet(6, 5000), false, 5000);
  assert(!small.Snapshot(5000, &replay));

  Replay audio(100, 1000, false);
  for (int i = 0; i <= 20; ++i) audio.Accept(Packet(i, i * 20000 - 6500), false, 0);
  assert(audio.Snapshot(200000, &replay));
  assert(replay.front().packet.pts_us == 113500);
  assert(replay.back().packet.pts_us == 393500);
  assert(!audio.Snapshot(600000, &replay));
  Replay missing_audio(10, 100, false);
  missing_audio.Accept(Packet(1, 200000), false, 0);
  assert(!missing_audio.Snapshot(100000, &replay));

  // A native flush must not consume new queued input; input EOS survives and
  // native EOS can be submitted again only after pending packets have drained.
  State state({10, 100}, {10, 100});
  const auto generation = state.generation();
  auto packet = Packet(7, 0);
  assert(state.Enqueue(generation, State::Stream::kVideo, {packet}) == State::EnqueueResult::kAccepted);
  State::FeedTicket ticket{};
  assert(state.NextFeed(State::Stream::kVideo, &ticket));
  assert(state.CompleteFeed(ticket, State::FeedResult::kAccepted));
  state.WriteEos(generation, State::Stream::kAudio);
  state.WriteEos(generation, State::Stream::kVideo);
  assert(state.EosSubmitted(generation));
  assert(!state.ReadyToSubmitEos());
  state.NativeFlushed();
  assert(state.ReadyToSubmitEos());
  assert(state.EosSubmitted(generation));
  assert(state.NativeEnded(generation));
  state.NativeFlushed();
  assert(state.ended() && !state.ReadyToSubmitEos());
  assert(state.Reset());
  assert(!state.CompleteFeed(ticket, State::FeedResult::kAccepted));
  std::cout << "Starfish bounded rate replay tests passed\n";
}
