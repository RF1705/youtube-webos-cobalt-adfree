#include "starboard/webos/arm/application_sdl.h"

#include <SDL2/SDL_syswm.h>
#include <SDL2/SDL_webOS.h>

#include <EGL/egl.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

#include "starboard/common/log.h"
#include "starboard/input.h"
#include "starboard/key.h"
#include "starboard/shared/starboard/audio_sink/audio_sink_internal.h"
#include "starboard/webos/arm/sdl_wheel_input.h"
#include "starboard/webos/arm/window_internal.h"

namespace starboard {
namespace shared {
namespace webos {
namespace {

SbKey SdlKeyToSbKey(const SDL_Keysym& keysym) {
  switch (keysym.scancode) {
    case SDL_SCANCODE_RETURN:
    case SDL_SCANCODE_KP_ENTER:
      return kSbKeyReturn;
    case SDL_SCANCODE_ESCAPE:
    case SDL_SCANCODE_AC_BACK:
      return kSbKeyEscape;
    case SDL_SCANCODE_LEFT:
      return kSbKeyLeft;
    case SDL_SCANCODE_RIGHT:
      return kSbKeyRight;
    case SDL_SCANCODE_UP:
      return kSbKeyUp;
    case SDL_SCANCODE_DOWN:
      return kSbKeyDown;
    case SDL_SCANCODE_SPACE:
      return kSbKeySpace;
    case SDL_SCANCODE_HOME:
      return kSbKeyHome;
    case SDL_SCANCODE_AUDIOPLAY:
      return kSbKeyMediaPlayPause;
    case SDL_SCANCODE_AUDIOREWIND:
      return kSbKeyMediaRewind;
    case SDL_SCANCODE_AUDIOFASTFORWARD:
      return kSbKeyMediaFastForward;
    case SDL_SCANCODE_WEBOS_RED:
      return kSbKeyRed;
    case SDL_SCANCODE_WEBOS_GREEN:
      return kSbKeyGreen;
    case SDL_SCANCODE_WEBOS_YELLOW:
      return kSbKeyYellow;
    case SDL_SCANCODE_WEBOS_BLUE:
      return kSbKeyBlue;
    case SDL_SCANCODE_WEBOS_CH_UP:
      return kSbKeyChannelUp;
    case SDL_SCANCODE_WEBOS_CH_DOWN:
      return kSbKeyChannelDown;
    default:
      break;
  }

  const int scancode = static_cast<int>(keysym.scancode);
  if (scancode == SDL_WEBOS_SCANCODE_BACK ||
      scancode == SDL_WEBOS_SCANCODE_EXIT) {
    return kSbKeyEscape;
  }
  // These are the key symbols observed on LG webOS TV hardware by the
  // ScummVM port.  Keep them as a fallback because older SDL webOS builds do
  // not always populate the newer SDL_SCANCODE_WEBOS_* values above.
  switch (static_cast<int>(keysym.sym)) {
    case 0x200011:
      return kSbKeyRed;
    case 0x200012:
      return kSbKeyGreen;
    case 0x200013:
      return kSbKeyYellow;
    case 0x200014:
      return kSbKeyBlue;
    case 0x200021:
      return kSbKeyChannelUp;
    case 0x200022:
      return kSbKeyChannelDown;
    default:
      break;
  }
  if (keysym.sym >= SDLK_0 && keysym.sym <= SDLK_9) {
    return static_cast<SbKey>(kSbKey0 + keysym.sym - SDLK_0);
  }
  if (keysym.sym >= SDLK_a && keysym.sym <= SDLK_z) {
    return static_cast<SbKey>(kSbKeyA + keysym.sym - SDLK_a);
  }
  return kSbKeyUnknown;
}

unsigned int SdlModifiersToSbModifiers(SDL_Keymod modifiers) {
  unsigned int result = kSbKeyModifiersNone;
  if (modifiers & KMOD_SHIFT) {
    result |= kSbKeyModifiersShift;
  }
  if (modifiers & KMOD_CTRL) {
    result |= kSbKeyModifiersCtrl;
  }
  if (modifiers & KMOD_ALT) {
    result |= kSbKeyModifiersAlt;
  }
  if (modifiers & KMOD_GUI) {
    result |= kSbKeyModifiersMeta;
  }
  return result;
}

}  // namespace

ApplicationSdl::ApplicationSdl()
    : sdl_initialized_(false),
      window_(kSbWindowInvalid),
      gl_context_(nullptr),
      egl_surface_(nullptr),
      egl_config_id_(0),
      wake_event_type_(0) {}

ApplicationSdl::~ApplicationSdl() = default;

ApplicationSdl* ApplicationSdl::Get() {
  return static_cast<ApplicationSdl*>(starboard::Application::Get());
}

void ApplicationSdl::Initialize() {
  SbAudioSinkPrivate::Initialize();
  SDL_SetMainReady();
  SDL_SetHint(SDL_HINT_WEBOS_REGISTER_APP, "1");
  SDL_SetHint(SDL_HINT_WEBOS_ACCESS_POLICY_KEYS_BACK, "1");
  SDL_SetHint(SDL_HINT_WEBOS_ACCESS_POLICY_KEYS_EXIT, "1");
  // SDL disables the screen saver by default.  On webOS that registers a
  // process-wide wake lock whose response vetoes every screen-saver request,
  // including while this app is only semi-full preloaded.  Start uninhibited;
  // the Starfish decoder below controls inhibition during active playback.
  SDL_SetHint(SDL_HINT_VIDEO_ALLOW_SCREENSAVER, "1");
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS) != 0) {
    SB_LOG(ERROR) << "SDL_Init failed: " << SDL_GetError();
    Stop(10);
    return;
  }
  sdl_initialized_ = true;
  wake_event_type_ = SDL_RegisterEvents(1);
  SB_LOG(INFO) << "webOS SDL initialized with driver "
               << SDL_GetCurrentVideoDriver();
}

void ApplicationSdl::Teardown() {
  if (SbWindowIsValid(window_)) {
    DestroyWindow(window_);
  }
  if (sdl_initialized_) {
    SDL_Quit();
    sdl_initialized_ = false;
  }
  SbAudioSinkPrivate::TearDown();
}

SbWindow ApplicationSdl::CreateWindow(const SbWindowOptions* options) {
  if (!sdl_initialized_ || SbWindowIsValid(window_)) {
    return kSbWindowInvalid;
  }

  // Keep SDL's Wayland EGL window format aligned with Cobalt's renderer.
  // webOS otherwise chooses its default native format, which may reject the
  // RGBA8 EGLConfig later passed to eglCreateWindowSurface().
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 2);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
  SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
  SDL_GL_SetAttribute(SDL_GL_RED_SIZE, 8);
  SDL_GL_SetAttribute(SDL_GL_GREEN_SIZE, 8);
  SDL_GL_SetAttribute(SDL_GL_BLUE_SIZE, 8);
  SDL_GL_SetAttribute(SDL_GL_ALPHA_SIZE, 8);
  SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 0);
  SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 0);

  int panel_width = 1920;
  int panel_height = 1080;
  SDL_webOSGetPanelResolution(&panel_width, &panel_height);
  int width = panel_width;
  int height = panel_height;
  if (options) {
    if (options->size.width > 0) {
      width = options->size.width;
    }
    if (options->size.height > 0) {
      height = options->size.height;
    }
  }

  // Keep Cobalt's GLES/HTML UI at webOS' logical Full-HD application
  // resolution.  Rendering the complete UI at the physical 4K panel size is
  // needlessly expensive on TV SoCs; Starfish still decodes and presents the
  // exported video layer at its native resolution.
  if (width > 1920 || height > 1080) {
    width = 1920;
    height = 1080;
  }
  const float video_pixel_ratio = std::min(
      static_cast<float>(panel_width) / width,
      static_cast<float>(panel_height) / height);

  SDL_Window* sdl_window = SDL_CreateWindow(
      "Cobalt", SDL_WINDOWPOS_UNDEFINED, SDL_WINDOWPOS_UNDEFINED, width,
      height, SDL_WINDOW_OPENGL | SDL_WINDOW_FULLSCREEN | SDL_WINDOW_SHOWN);
  if (!sdl_window) {
    SB_LOG(ERROR) << "SDL_CreateWindow failed: " << SDL_GetError();
    return kSbWindowInvalid;
  }

  gl_context_ = SDL_GL_CreateContext(sdl_window);
  if (!gl_context_) {
    SB_LOG(ERROR) << "SDL_GL_CreateContext failed: " << SDL_GetError();
    SDL_DestroyWindow(sdl_window);
    return kSbWindowInvalid;
  }
  SDL_GL_SetSwapInterval(1);
  EGLDisplay egl_display = eglGetCurrentDisplay();
  EGLContext egl_context = eglGetCurrentContext();
  egl_surface_ = eglGetCurrentSurface(EGL_DRAW);
  if (egl_display == EGL_NO_DISPLAY || egl_context == EGL_NO_CONTEXT ||
      egl_surface_ == EGL_NO_SURFACE ||
      !eglQueryContext(egl_display, egl_context, EGL_CONFIG_ID,
                       &egl_config_id_)) {
    SB_LOG(ERROR) << "SDL did not expose its current EGL surface/config.";
    SDL_GL_DeleteContext(gl_context_);
    gl_context_ = nullptr;
    egl_surface_ = nullptr;
    egl_config_id_ = 0;
    SDL_DestroyWindow(sdl_window);
    return kSbWindowInvalid;
  }

  SDL_SysWMinfo info;
  SDL_VERSION(&info.version);
  if (!SDL_GetWindowWMInfo(sdl_window, &info) ||
      info.subsystem != SDL_SYSWM_WAYLAND || !info.info.wl.display ||
      !info.info.wl.egl_window) {
    SB_LOG(ERROR) << "SDL did not expose a Wayland EGL window: "
                  << SDL_GetError();
    SDL_GL_DeleteContext(gl_context_);
    gl_context_ = nullptr;
    egl_surface_ = nullptr;
    egl_config_id_ = 0;
    SDL_DestroyWindow(sdl_window);
    return kSbWindowInvalid;
  }

  window_ = new SbWindowPrivate(sdl_window, info.info.wl.display,
                                info.info.wl.egl_window, width, height,
                                video_pixel_ratio);
  return window_;
}

bool ApplicationSdl::DestroyWindow(SbWindow window) {
  if (!SbWindowIsValid(window) || window != window_) {
    return false;
  }
  if (gl_context_) {
    SDL_GL_DeleteContext(gl_context_);
    gl_context_ = nullptr;
  }
  if (!exported_window_id_.empty()) {
    SDL_webOSDestroyExportedWindow(exported_window_id_.c_str());
    exported_window_id_.clear();
  }
  SDL_EnableScreenSaver();
  exported_video_clients_ = 0;
  video_screen_saver_inhibited_ = false;
  exported_geometry_valid_ = false;
  egl_surface_ = nullptr;
  egl_config_id_ = 0;
  SDL_DestroyWindow(window->sdl_window);
  delete window;
  window_ = kSbWindowInvalid;
  return true;
}

bool ApplicationSdl::AcquireExportedVideoWindow() {
  ScopedLock lock(exported_geometry_mutex_);
  if (!SbWindowIsValid(window_)) {
    return false;
  }
  if (!exported_window_id_.empty()) {
    ++exported_video_clients_;
    return true;
  }

  const char* exported_window = SDL_webOSCreateExportedWindow(
      SDL_WEBOS_EXPORED_WINDOW_TYPE_VIDEO);
  if (!exported_window) {
    SB_LOG(ERROR) << "SDL_webOSCreateExportedWindow failed: "
                  << SDL_GetError();
    return false;
  }
  exported_window_id_ = exported_window;
  exported_video_clients_ = 1;
  exported_geometry_valid_ = false;
  SDL_DisableScreenSaver();
  video_screen_saver_inhibited_ = true;
  SB_LOG(INFO) << "Created exported video window " << exported_window_id_;
  return true;
}

void ApplicationSdl::ReleaseExportedVideoWindow() {
  ScopedLock lock(exported_geometry_mutex_);
  if (exported_video_clients_ <= 0) {
    return;
  }
  --exported_video_clients_;
  if (exported_video_clients_ != 0 || exported_window_id_.empty()) {
    return;
  }
  SDL_webOSDestroyExportedWindow(exported_window_id_.c_str());
  SB_LOG(INFO) << "Destroyed exported video window " << exported_window_id_;
  exported_window_id_.clear();
  exported_geometry_valid_ = false;
  SDL_EnableScreenSaver();
  video_screen_saver_inhibited_ = false;
}

void ApplicationSdl::SetVideoPaused(bool paused) {
  ScopedLock lock(exported_geometry_mutex_);
  if (!sdl_initialized_ || exported_window_id_.empty()) {
    return;
  }
  const bool inhibit_screen_saver = !paused;
  if (video_screen_saver_inhibited_ == inhibit_screen_saver) {
    return;
  }
  video_screen_saver_inhibited_ = inhibit_screen_saver;
  inhibit_screen_saver ? SDL_DisableScreenSaver() : SDL_EnableScreenSaver();
  SB_LOG(INFO) << "Screen saver " << (paused ? "allowed" : "inhibited")
               << " for video pause state.";
}

void* ApplicationSdl::GetNativeDisplay() const {
  return SbWindowIsValid(window_) ? window_->display : nullptr;
}

void ApplicationSdl::ConfigureFullscreenVideo() {
  if (!SbWindowIsValid(window_)) {
    return;
  }
  AcceptFrame(kSbPlayerInvalid, scoped_refptr<VideoFrame>(), 0, 0, 0,
              window_->width, window_->height);
}

void ApplicationSdl::AcceptFrame(SbPlayer,
                                 const scoped_refptr<VideoFrame>&,
                                 int,
                                 int x,
                                 int y,
                                 int width,
                                 int height) {
  if (exported_window_id_.empty() || !SbWindowIsValid(window_) || width <= 0 ||
      height <= 0) {
    return;
  }
  ScopedLock lock(exported_geometry_mutex_);
  const int video_width = video_width_.load() > 0 ? video_width_.load()
                                                   : window_->width;
  const int video_height = video_height_.load() > 0 ? video_height_.load()
                                                     : window_->height;
  SDL_Rect original = {0, 0, video_width, video_height};
  SDL_Rect source = original;

  // webOS' exported-video protocol uses the logical 1080p application
  // coordinate space even when SDL exposes the physical 3840x2160 panel.
  // Passing physical coordinates makes the compositor scale a second time and
  // displays only the upper-left quarter of the decoded image.
  const int logical_width = std::min(window_->width, 1920);
  const int logical_height = std::min(window_->height, 1080);
  if (window_->width > logical_width &&
      (x + width > logical_width || y + height > logical_height)) {
    x = x * logical_width / window_->width;
    y = y * logical_height / window_->height;
    width = width * logical_width / window_->width;
    height = height * logical_height / window_->height;
  }
  SDL_Rect destination = {x, y, width, height};
  if (exported_geometry_valid_ &&
      std::memcmp(&original, &last_video_original_, sizeof(original)) == 0 &&
      std::memcmp(&source, &last_video_source_, sizeof(source)) == 0 &&
      std::memcmp(&destination, &last_video_destination_,
                  sizeof(destination)) == 0) {
    return;
  }
  if (SDL_webOSExportedSetCropRegion(exported_window_id_.c_str(), &original,
                                     &source, &destination) == SDL_TRUE) {
    last_video_original_ = original;
    last_video_source_ = source;
    last_video_destination_ = destination;
    exported_geometry_valid_ = true;
    SB_LOG(INFO) << "Configured exported video crop " << video_width << "x"
                 << video_height << " -> " << x << "," << y << " "
                 << width << "x" << height;
  } else {
    SB_LOG(ERROR) << "SDL_webOSExportedSetCropRegion failed: "
                  << SDL_GetError();
  }
}

bool ApplicationSdl::MayHaveSystemEvents() {
  return sdl_initialized_;
}

ApplicationSdl::Event* ApplicationSdl::WaitForSystemEventWithTimeout(
    SbTime time) {
  SDL_Event event;
  int timeout_ms = 0;
  if (time > 0) {
    const SbTime milliseconds = (time + kSbTimeMillisecond - 1) /
                                kSbTimeMillisecond;
    timeout_ms = static_cast<int>(std::min<SbTime>(milliseconds, 1000));
  }
  if (!SDL_WaitEventTimeout(&event, timeout_ms)) {
    return nullptr;
  }
  return TranslateEvent(event);
}

void ApplicationSdl::WakeSystemEventWait() {
  if (!sdl_initialized_ || wake_event_type_ == static_cast<Uint32>(-1)) {
    return;
  }
  SDL_Event event;
  SDL_zero(event);
  event.type = wake_event_type_;
  SDL_PushEvent(&event);
}

ApplicationSdl::Event* ApplicationSdl::TranslateEvent(const SDL_Event& event) {
  if (event.type == wake_event_type_) {
    return nullptr;
  }
  if (event.type == SDL_QUIT || event.type == SDL_APP_TERMINATING) {
    Stop(0);
    return nullptr;
  }
  if (event.type == SDL_APP_WILLENTERBACKGROUND) {
    Blur(nullptr, nullptr);
    return nullptr;
  }
  if (event.type == SDL_APP_DIDENTERBACKGROUND) {
    Conceal(nullptr, nullptr);
    return nullptr;
  }
  if (event.type == SDL_APP_WILLENTERFOREGROUND) {
    Reveal(nullptr, nullptr);
    return nullptr;
  }
  if (event.type == SDL_APP_DIDENTERFOREGROUND) {
    Focus(nullptr, nullptr);
    return nullptr;
  }
  if (event.type == SDL_APP_LOWMEMORY) {
    InjectLowMemoryEvent();
    return nullptr;
  }

  if (event.type == SDL_KEYDOWN || event.type == SDL_KEYUP) {
    SbInputData* data = new SbInputData();
    std::memset(data, 0, sizeof(*data));
    data->window = window_;
    data->type = event.type == SDL_KEYDOWN ? kSbInputEventTypePress
                                           : kSbInputEventTypeUnpress;
    data->device_type = kSbInputDeviceTypeRemote;
    data->device_id = 1;
    data->key = SdlKeyToSbKey(event.key.keysym);
    data->character = event.key.keysym.sym >= 32 && event.key.keysym.sym < 127
                          ? event.key.keysym.sym
                          : 0;
    data->key_location = kSbKeyLocationUnspecified;
    data->key_modifiers = SdlModifiersToSbModifiers(
        static_cast<SDL_Keymod>(event.key.keysym.mod));
    return new Event(kSbEventTypeInput, data, &DeleteDestructor<SbInputData>);
  }

  if (event.type == SDL_MOUSEMOTION || event.type == SDL_MOUSEBUTTONDOWN ||
      event.type == SDL_MOUSEBUTTONUP || event.type == SDL_MOUSEWHEEL) {
    SbInputData* data = new SbInputData();
    std::memset(data, 0, sizeof(*data));
    data->window = window_;
    data->device_type = kSbInputDeviceTypeMouse;
    data->device_id = 2;
    data->pressure = std::numeric_limits<float>::quiet_NaN();
    data->size.x = data->size.y = data->pressure;
    data->tilt.x = data->tilt.y = data->pressure;
    if (event.type == SDL_MOUSEMOTION) {
      data->type = kSbInputEventTypeMove;
      data->position.x = event.motion.x;
      data->position.y = event.motion.y;
      data->delta.x = event.motion.xrel;
      data->delta.y = event.motion.yrel;
    } else if (event.type == SDL_MOUSEWHEEL) {
      const SdlWheelDelta delta = TranslateSdlWheelDelta(event.wheel);
      int mouse_x = 0;
      int mouse_y = 0;
      SDL_GetMouseState(&mouse_x, &mouse_y);
      data->type = kSbInputEventTypeWheel;
      data->position.x = mouse_x;
      data->position.y = mouse_y;
      data->delta.x = delta.x;
      data->delta.y = delta.y;
      data->key_modifiers = SdlModifiersToSbModifiers(SDL_GetModState());
    } else {
      data->type = event.type == SDL_MOUSEBUTTONDOWN ? kSbInputEventTypePress
                                                     : kSbInputEventTypeUnpress;
      data->key = static_cast<SbKey>(kSbKeyMouse1 + event.button.button - 1);
      data->position.x = event.button.x;
      data->position.y = event.button.y;
    }
    return new Event(kSbEventTypeInput, data, &DeleteDestructor<SbInputData>);
  }
  return nullptr;
}

}  // namespace webos
}  // namespace shared
}  // namespace starboard

extern "C" void* SbWebOSGetSdlEglSurface() {
  return starboard::shared::webos::ApplicationSdl::Get()->GetEglSurface();
}

extern "C" int SbWebOSGetSdlEglConfigId() {
  return starboard::shared::webos::ApplicationSdl::Get()->GetEglConfigId();
}
