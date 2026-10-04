#ifndef STARBOARD_WEBOS_ARM_SDL_WHEEL_INPUT_H_
#define STARBOARD_WEBOS_ARM_SDL_WHEEL_INPUT_H_

#include <SDL2/SDL.h>

namespace starboard {
namespace shared {
namespace webos {

struct SdlWheelDelta {
  float x;
  float y;
};

inline SdlWheelDelta TranslateSdlWheelDelta(
    const SDL_MouseWheelEvent& wheel) {
  const float raw_x = wheel.preciseX != 0.0f
                          ? wheel.preciseX
                          : static_cast<float>(wheel.x);
  const float raw_y = wheel.preciseY != 0.0f
                          ? wheel.preciseY
                          : static_cast<float>(wheel.y);
  const float direction =
      wheel.direction == SDL_MOUSEWHEEL_FLIPPED ? -1.0f : 1.0f;

  // SDL reports positive Y when the wheel moves away from the user, while a
  // DOM WheelEvent uses a negative deltaY for scrolling up. Normalize flipped
  // (natural-scroll) events before converting to DOM-compatible directions.
  return {raw_x * direction, -raw_y * direction};
}

}  // namespace webos
}  // namespace shared
}  // namespace starboard

#endif  // STARBOARD_WEBOS_ARM_SDL_WHEEL_INPUT_H_
