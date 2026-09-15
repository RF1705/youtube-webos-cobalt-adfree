#ifndef STARBOARD_WEBOS_ARM_STARFISH_VIDEO_CONFIGURATION_H_
#define STARBOARD_WEBOS_ARM_STARFISH_VIDEO_CONFIGURATION_H_

namespace starboard {
namespace shared {
namespace webos {

// Validates compressed-video configuration transitions before packets enter
// the shared Starfish session. Starfish advertises adaptive-resolution support,
// but representation changes must still begin on a keyframe. Color-mode changes
// remain a separate-player transition until they have been validated on device.
class StarfishVideoConfiguration {
 public:
  enum class UpdateResult {
    kInitial,
    kUnchanged,
    kResolutionChanged,
    kResolutionChangeNeedsKeyframe,
    kColorChanged,
  };

  UpdateResult Update(int width, int height, bool hdr, unsigned bits,
                      bool keyframe) {
    if (!initialized_) {
      initialized_ = true;
      width_ = width;
      height_ = height;
      hdr_ = hdr;
      bits_ = bits;
      return UpdateResult::kInitial;
    }
    if (hdr_ != hdr || bits_ != bits) return UpdateResult::kColorChanged;
    if (width_ == width && height_ == height)
      return UpdateResult::kUnchanged;
    if (!keyframe) return UpdateResult::kResolutionChangeNeedsKeyframe;
    width_ = width;
    height_ = height;
    return UpdateResult::kResolutionChanged;
  }

  void Reset() {
    initialized_ = false;
    width_ = 0;
    height_ = 0;
    hdr_ = false;
    bits_ = 0;
  }

  bool initialized() const { return initialized_; }
  int width() const { return width_; }
  int height() const { return height_; }
  bool hdr() const { return hdr_; }
  unsigned bits() const { return bits_; }

 private:
  bool initialized_ = false;
  int width_ = 0;
  int height_ = 0;
  bool hdr_ = false;
  unsigned bits_ = 0;
};

}  // namespace webos
}  // namespace shared
}  // namespace starboard

#endif  // STARBOARD_WEBOS_ARM_STARFISH_VIDEO_CONFIGURATION_H_
