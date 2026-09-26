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

  // Keep Cobalt diagnostics bounded. /tmp is memory-backed on webOS, so an
  // unbounded append-only log can otherwise consume the complete tmpfs during
  // a long-running session. Once the log reaches 16 MiB, retain the newest
  // 8 MiB and continue appending.
  constexpr off_t kMaxLogBytes = 16 * 1024 * 1024;
  constexpr off_t kRetainedLogBytes = 8 * 1024 * 1024;
  const char* log_path = "/tmp/cobalt-starterless.log";

  auto trim_log = [log_path, kMaxLogBytes, kRetainedLogBytes](off_t size) {
    if (size < kMaxLogBytes) return;

    const off_t source_start = size - kRetainedLogBytes;
    int fd = open(log_path, O_RDWR);
    if (fd < 0) return;

    char buffer[64 * 1024];
    off_t copied = 0;
    while (copied < kRetainedLogBytes) {
      const size_t chunk = static_cast<size_t>(
          std::min<off_t>(sizeof(buffer), kRetainedLogBytes - copied));
      const ssize_t bytes_read =
          pread(fd, buffer, chunk, source_start + copied);
      if (bytes_read <= 0) break;

      ssize_t written = 0;
      while (written < bytes_read) {
        const ssize_t result =
            pwrite(fd, buffer + written,
                   static_cast<size_t>(bytes_read - written),
                   copied + written);
        if (result <= 0) {
          close(fd);
          return;
        }
        written += result;
      }
      copied += bytes_read;
    }

    if (copied == kRetainedLogBytes) {
      ftruncate(fd, kRetainedLogBytes);
    }
    close(fd);
  };

  struct stat log_stat;
  if (stat(log_path, &log_stat) == 0) {
    trim_log(log_stat.st_size);
  }

  FILE* stdout_log = std::freopen(log_path, "a", stdout);
  FILE* stderr_log = std::freopen(log_path, "a", stderr);
  if (stdout_log) {
    std::setvbuf(stdout_log, nullptr, _IOLBF, 0);
  }
  if (stderr_log) {
    // Cobalt 23 logs unsupported modern YouTube selectors in large bursts.
    // Buffer those diagnostics so thousands of small writes cannot starve the
    // real-time PulseAudio thread during playback startup.
    std::setvbuf(stderr_log, nullptr, _IOFBF, 256 * 1024);
  }

  std::thread([log_path, trim_log, kMaxLogBytes]() {
    while (true) {
      sleep(1);
      struct stat current_stat;
      if (stat(log_path, &current_stat) != 0 ||
          current_stat.st_size < kMaxLogBytes) {
        continue;
      }

      flockfile(stdout);
      flockfile(stderr);
      std::fflush(stdout);
      std::fflush(stderr);

      if (stat(log_path, &current_stat) == 0) {
        trim_log(current_stat.st_size);
      }

      funlockfile(stderr);
      funlockfile(stdout);
    }
  }).detach();

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
