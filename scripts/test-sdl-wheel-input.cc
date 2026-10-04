#include <cassert>
#include <iostream>

#include "sdl_wheel_input.h"

using starboard::shared::webos::SdlWheelDelta;
using starboard::shared::webos::TranslateSdlWheelDelta;

namespace {

SDL_MouseWheelEvent Wheel(float precise_x,
                          float precise_y,
                          Sint32 x,
                          Sint32 y,
                          Uint32 direction) {
  SDL_MouseWheelEvent wheel = {};
  wheel.type = SDL_MOUSEWHEEL;
  wheel.preciseX = precise_x;
  wheel.preciseY = precise_y;
  wheel.x = x;
  wheel.y = y;
  wheel.direction = direction;
  return wheel;
}

void ExpectDelta(const SDL_MouseWheelEvent& wheel, float x, float y) {
  const SdlWheelDelta delta = TranslateSdlWheelDelta(wheel);
  assert(delta.x == x);
  assert(delta.y == y);
}

}  // namespace

int main() {
  ExpectDelta(Wheel(0.0f, 1.0f, 0, 1, SDL_MOUSEWHEEL_NORMAL), 0.0f,
              -1.0f);
  ExpectDelta(Wheel(0.0f, -1.0f, 0, -1, SDL_MOUSEWHEEL_NORMAL), 0.0f,
              1.0f);
  ExpectDelta(Wheel(0.5f, -0.25f, 0, 0, SDL_MOUSEWHEEL_NORMAL), 0.5f,
              0.25f);
  ExpectDelta(Wheel(-1.0f, -1.0f, -1, -1, SDL_MOUSEWHEEL_FLIPPED), 1.0f,
              -1.0f);
  ExpectDelta(Wheel(0.0f, 0.0f, -2, 3, SDL_MOUSEWHEEL_NORMAL), -2.0f,
              -3.0f);

  std::cout << "SDL wheel input translation tests passed\n";
  return 0;
}
