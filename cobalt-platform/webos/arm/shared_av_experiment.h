#ifndef STARBOARD_WEBOS_ARM_SHARED_AV_EXPERIMENT_H_
#define STARBOARD_WEBOS_ARM_SHARED_AV_EXPERIMENT_H_

#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace starboard {
namespace shared {
namespace webos {

// Eligible Opus streams use the shared native backend by default. Explicit
// values retain the diagnostic modes and provide a rollback to the existing
// backend (0). Set the override before starting Cobalt; the first query latches
// it for this process so new players cannot mix two backend policies.
// Environment takes precedence over the
// temporary TV marker used by earlier diagnostic packages.
// 1 = H.264 SDR, 2 = VP9/AV1 UHD SDR, 3 = VP9/AV1 UHD HDR (default).
inline int ParseSharedAvBackendMode(const char* value) {
  if (!value) return 3;
  if (std::strcmp(value, "0") == 0) return 0;
  if (std::strcmp(value, "1") == 0) return 1;
  if (std::strcmp(value, "2") == 0) return 2;
  if (std::strcmp(value, "3") == 0) return 3;
  // An unrecognized explicit override fails closed to the legacy backend.
  return 0;
}

inline int ReadConfiguredSharedAvBackendMode() {
  const char* value = std::getenv("YTAF_SHARED_AV");
  if (value) return ParseSharedAvBackendMode(value);

  FILE* marker = std::fopen("/tmp/ytaf-shared-av.enable", "r");
  if (!marker) {
    return 3;
  }
  const int marker_value = std::fgetc(marker);
  std::fclose(marker);
  const char marker_mode[] = {static_cast<char>(marker_value), '\0'};
  return ParseSharedAvBackendMode(marker_mode);
}

inline int SharedAvBackendMode() {
  static const int mode = ReadConfiguredSharedAvBackendMode();
  return mode;
}

}  // namespace webos
}  // namespace shared
}  // namespace starboard

#endif  // STARBOARD_WEBOS_ARM_SHARED_AV_EXPERIMENT_H_
