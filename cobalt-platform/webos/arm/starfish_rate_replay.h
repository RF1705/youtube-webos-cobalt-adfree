#ifndef STARBOARD_WEBOS_ARM_STARFISH_RATE_REPLAY_H_
#define STARBOARD_WEBOS_ARM_STARFISH_RATE_REPLAY_H_

#include <cstddef>
#include <cstdint>
#include <deque>

namespace starboard {
namespace shared {
namespace webos {

// Retain owning references to accepted compressed packets, not decoded frames.
// Eviction never fabricates a keyframe: an incomplete GOP makes replay unavailable.
template <typename Packet>
class StarfishRateReplay {
 public:
  struct Entry { Packet packet; bool keyframe; };
  StarfishRateReplay(size_t max_packets, size_t max_bytes, bool video)
      : max_packets_(max_packets), max_bytes_(max_bytes), video_(video) {}

  void Prune(int64_t current_us) {
    if (video_) {
      size_t keep = 0;
      for (size_t i = 0; i < packets_.size(); ++i)
        if (packets_[i].keyframe && packets_[i].packet.pts_us <= current_us)
          keep = i;
      while (keep > 0) { Pop(); --keep; }
    } else {
      // Keep audio preroll as well as every accepted packet ahead of the clock.
      while (!packets_.empty() &&
             packets_.front().packet.pts_us < current_us - 100000) Pop();
    }
  }
  void Accept(const Packet& packet, bool keyframe, int64_t current_us) {
    Prune(current_us);
    if (packet.bytes > max_bytes_) {
      packets_.clear(); bytes_ = 0;
      return;
    }
    while (!packets_.empty() &&
           (packets_.size() >= max_packets_ || bytes_ > max_bytes_ - packet.bytes))
      Pop();
    packets_.push_back({packet, keyframe});
    bytes_ += packet.bytes;
  }
  bool Snapshot(int64_t current_us, std::deque<Entry>* result) {
    Prune(current_us);
    result->clear();
    if (packets_.empty()) return false;
    if (video_ && (!packets_.front().keyframe ||
                  packets_.front().packet.pts_us > current_us)) return false;
    if (!video_ && (packets_.front().packet.pts_us > current_us ||
                    packets_.back().packet.pts_us < current_us - 100000)) return false;
    *result = packets_;
    return true;
  }
  size_t bytes() const { return bytes_; }
  size_t size() const { return packets_.size(); }
 private:
  void Pop() { bytes_ -= packets_.front().packet.bytes; packets_.pop_front(); }
  const size_t max_packets_, max_bytes_;
  const bool video_;
  size_t bytes_ = 0;
  std::deque<Entry> packets_;
};

}  // namespace webos
}  // namespace shared
}  // namespace starboard
#endif
