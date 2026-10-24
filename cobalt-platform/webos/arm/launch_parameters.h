#ifndef STARBOARD_WEBOS_ARM_LAUNCH_PARAMETERS_H_
#define STARBOARD_WEBOS_ARM_LAUNCH_PARAMETERS_H_

#include <string>

namespace starboard {
namespace shared {
namespace webos {
// Returns an ordinary YouTube deep link, never an arbitrary URI or JS string.
std::string WebosLaunchUrl(const std::string& payload);
constexpr int kWebosRelaunchEvent = 0x59544146;
}  // namespace webos
}  // namespace shared
}  // namespace starboard
#endif  // STARBOARD_WEBOS_ARM_LAUNCH_PARAMETERS_H_
