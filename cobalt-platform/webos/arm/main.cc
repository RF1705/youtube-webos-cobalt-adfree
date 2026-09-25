#include <time.h>

#include <algorithm>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <thread>
#include <vector>

#include <unistd.h>

#include "starboard/configuration.h"
#include "starboard/shared/signal/crash_signals.h"
#include "starboard/shared/signal/debug_signals.h"
#include "starboard/shared/signal/suspend_signals.h"
#include "starboard/shared/starboard/link_receiver.h"
#include "starboard/webos/arm/application_sdl.h"

extern "C" SB_EXPORT_PLATFORM int main(int argc, char** argv) {
  // webOS exposes its system PulseAudio server here.  XDG_RUNTIME_DIR points
  // at the compositor runtime owned by root, so libpulse cannot discover the
  // socket automatically and would otherwise fall back to the incompatible
  // raw ALSA device.
  setenv("PULSE_SERVER", "unix:/var/run/pulse/native", 1);

  // Keep the most recent Cobalt diagnostics in a bounded circular log.
  // /tmp is memory-backed on webOS, so the file must never be allowed to grow
  // without limit. The file contains a small header followed by a 16 MiB ring.
  constexpr size_t kMaxLogBytes = 16 * 1024 * 1024;
  constexpr size_t kLogHeaderBytes = 64;
  const char* log_path = "/tmp/cobalt-starterless.log";
  int log_pipe[2] = {-1, -1};
  if (pipe(log_pipe) == 0) {
    dup2(log_pipe[1], STDOUT_FILENO);
    dup2(log_pipe[1], STDERR_FILENO);
    close(log_pipe[1]);

    std::thread([read_fd = log_pipe[0], log_path]() {
      FILE* log = std::fopen(log_path, "w+b");
      size_t write_offset = 0;

      auto write_header = [&]() {
        if (!log) return;
        char header[kLogHeaderBytes] = {};
        std::snprintf(header, sizeof(header),
                      "COBALT-RING-V1 offset=%010zu size=%010zu\n",
                      write_offset, kMaxLogBytes);
        std::fseek(log, 0, SEEK_SET);
        std::fwrite(header, 1, sizeof(header), log);
      };

      if (log) {
        write_header();
      }

      char buffer[16 * 1024];
      ssize_t count = 0;
      while ((count = read(read_fd, buffer, sizeof(buffer))) > 0) {
        if (!log) {
          log = std::fopen(log_path, "w+b");
          write_offset = 0;
          if (!log) continue;
          write_header();
        }

        size_t consumed = 0;
        const size_t bytes_to_write = static_cast<size_t>(count);
        while (consumed < bytes_to_write) {
          const size_t remaining = kMaxLogBytes - write_offset;
          const size_t chunk =
              std::min(bytes_to_write - consumed, remaining);

          std::fseek(log,
                     static_cast<long>(kLogHeaderBytes + write_offset),
                     SEEK_SET);
          std::fwrite(buffer + consumed, 1, chunk, log);
          consumed += chunk;
          write_offset = (write_offset + chunk) % kMaxLogBytes;
        }

        write_header();
        std::fflush(log);
      }

      if (log) std::fclose(log);
      close(read_fd);
    }).detach();
  }
  std::fprintf(stderr, "\n=== Cobalt starterless process started ===\n");

  tzset();
  starboard::shared::signal::InstallCrashSignalHandlers();
  starboard::shared::signal::InstallDebugSignalHandlers();
  starboard::shared::signal::InstallSuspendSignalHandlers();

  starboard::shared::webos::ApplicationSdl application;
  std::vector<char*> cobalt_argv;
  cobalt_argv.push_back(argv[0]);
  bool preload = false;
  for (int i = 1; i < argc; ++i) {
    if (argv[i] && argv[i][0] == '{' &&
        std::strstr(argv[i], "\"@system_native_app\"") != nullptr) {
      if (std::strstr(argv[i], "\"preload\":\"semi-full\"") != nullptr ||
          std::strstr(argv[i], "\"event\":\"preload\"") != nullptr) {
        preload = true;
      }
      continue;
    }
    cobalt_argv.push_back(argv[i]);
  }
  char preload_switch[] = "--preload";
  if (preload) {
    cobalt_argv.push_back(preload_switch);
    std::fprintf(stderr, "Translating webOS hidden preload launch.\n");
  }
  int result = 0;
  {
    starboard::shared::starboard::LinkReceiver receiver(&application);
    result = application.Run(static_cast<int>(cobalt_argv.size()),
                             cobalt_argv.data());
  }

  starboard::shared::signal::UninstallSuspendSignalHandlers();
  starboard::shared::signal::UninstallDebugSignalHandlers();
  starboard::shared::signal::UninstallCrashSignalHandlers();
  return result;
}
