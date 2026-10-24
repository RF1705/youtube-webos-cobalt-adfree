#ifndef STARBOARD_WEBOS_ARM_WEBOS_VERSION_H_
#define STARBOARD_WEBOS_ARM_WEBOS_VERSION_H_

#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace starboard {
namespace shared {
namespace webos {

inline int ReadWebOsMajorVersion() {
  FILE* file = std::fopen("/var/run/nyx/os_info.json", "r");
  if (!file) {
    return 0;
  }
  char buffer[2048];
  const size_t size = std::fread(buffer, 1, sizeof(buffer) - 1, file);
  std::fclose(file);
  buffer[size] = '\0';
  const char* key = std::strstr(buffer, "\"webos_release\"");
  if (!key) {
    return 0;
  }
  const char* value = std::strchr(key + std::strlen("\"webos_release\""), '"');
  return value ? std::atoi(value + 1) : 0;
}

inline int WebOsMajorVersion() {
  static const int version = ReadWebOsMajorVersion();
  return version;
}

}
}
}

#endif
