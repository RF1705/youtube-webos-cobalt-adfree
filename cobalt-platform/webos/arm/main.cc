#include <time.h>

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

  // Keep Cobalt diagnostics bounded. /tmp is a memory-backed filesystem on
  // webOS, so an unbounded append-only log can otherwise consume the complete
  // tmpfs during a long-running session.
  constexpr size_t kMaxLogBytes = 16 * 1024 * 1024;
  const char* log_path = "/tmp/cobalt-starterless.log";
  int log_pipe[2] = {-1, -1};
  if (pipe(log_pipe) == 0) {
    dup2(log_pipe[1], STDOUT_FILENO);
    dup2(log_pipe[1], STDERR_FILENO);
    close(log_pipe[1]);

    std::thread([read_fd = log_pipe[0], log_path]() {
      FILE* log = std::fopen(log_path, "a");
      size_t written = 0;
      if (log) {
        if (std::fseek(log, 0, SEEK_END) == 0) {
          const long current_size = std::ftell(log);
          if (current_size > 0) {
            written = static_cast<size_t>(current_size);
          }
        }
        if (written >= kMaxLogBytes) {
          std::fclose(log);
          log = std::fopen(log_path, "w");
          written = 0;
        }
      }

      char buffer[16 * 1024];
      ssize_t count = 0;
      while ((count = read(read_fd, buffer, sizeof(buffer))) > 0) {
        if (!log) {
          log = std::fopen(log_path, "a");
          if (!log) continue;
        }

        if (written + static_cast<size_t>(count) > kMaxLogBytes) {
          std::fclose(log);
          log = std::fopen(log_path, "w");
          written = 0;
          if (!log) continue;
        }

        const size_t bytes =
            std::fwrite(buffer, 1, static_cast<size_t>(count), log);
        written += bytes;
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
