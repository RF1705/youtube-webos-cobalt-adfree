#ifndef STARBOARD_WEBOS_ARM_STARFISH_RATE_TRANSITION_H_
#define STARBOARD_WEBOS_ARM_STARFISH_RATE_TRANSITION_H_

#include <cmath>
#include <cstdint>
#include "starfish_av_session_state.h"

namespace starboard {
namespace shared {
namespace webos {

// Worker-owned fallback policy. It runs only after the in-place SetPlayRate call
// was rejected. The worker retries that call on every step, so the only action
// this policy can publish is a Normal reload; it never replays input consumed by
// a live pipeline. Request revisions distinguish a withdrawn/replaced request,
// even when its numeric rate returns to the same value. Every changed request
// must advance Input::revision; the policy does not keep a duplicate rate.
class StarfishRateTransition {
 public:
  enum class Action { kKeep, kWait, kReloadNormal, kFailNoProgress };
  struct Input {
    bool loaded = false, paused = false;
    double requested = 1, applied = 1;
    uint64_t revision = 0;
    bool presented = false;
    bool restart_usable = false, input_drained = false;
    int64_t now_us = 0, frame_ns = -1;
  };

  Action Decide(const Input& in) {
    if (!in.loaded) return Action::kKeep;
    if (in.paused || in.requested <= 0 ||
        std::fabs(in.requested - in.applied) <= 0.0001) {
      Reset();
      return Action::kKeep;
    }
    // Exactly Normal keeps a reload fallback: a freshly loaded session starts
    // at 1x. Other requests must stay in place or fail, never replay.
    if (std::fabs(in.requested - 1) < 0.0001 &&
        std::fabs(in.applied - 1) > 0.0001 && in.restart_usable) {
      Reset();
      return Action::kReloadNormal;
    }
    if (!waiting_ || revision_ != in.revision || in.frame_ns > frame_ns_) {
      since_us_ = in.now_us;
      frame_ns_ = in.frame_ns;
      revision_ = in.revision;
    }
    waiting_ = true;
    // Healthy long GOPs extend the wait. Fully fed tails finish at the applied
    // rate under the session's existing stall watchdog; never force a flush.
    if (!(in.input_drained && in.presented) &&
        in.now_us - since_us_ >= kStarfishRateTransitionDeadlineUs)
      return Action::kFailNoProgress;
    return Action::kWait;
  }

  bool waiting() const { return waiting_; }
  int64_t since_us() const { return since_us_; }

 private:
  void Reset() {
    waiting_ = false;
    since_us_ = 0;
    frame_ns_ = -1;
    revision_ = 0;
  }
  bool waiting_ = false;
  int64_t since_us_ = 0, frame_ns_ = -1;
  uint64_t revision_ = 0;
};

}  // namespace webos
}  // namespace shared
}  // namespace starboard
#endif
