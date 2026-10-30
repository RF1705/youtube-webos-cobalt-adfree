// Exercise the real socket/buffer/lifecycle code with a deterministic LS2 peer.
#include <glib.h>
#include <json-c/json.h>
#include <luna-service2/lunaservice.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <atomic>
#include <cassert>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <thread>
#include <vector>

#include "lg_native_bus.h"
#include "lg_voice_capture.h"

struct LSHandle {
  GMainContext* context = nullptr;
};
struct LSMessage {
  std::string payload;
};
namespace {
std::string path;
bool reject_record = false;
bool reject_register = false;
bool fallback = false;
bool fallback_no_device = false;
bool fallback_reject_stream = false;
unsigned reply_delay_ms = 0;
unsigned stop_reply_delay_ms = 0;
std::atomic<int> stops{0}, stream_stops{0}, cancellations{0}, handles{0};
LSHandle app_bus;
std::vector<std::pair<LSMessageToken, GSource*>> pending;
struct Reply {
  LSHandle* bus;
  LSFilterFunc callback;
  void* data;
  std::string payload;
};
gboolean Deliver(gpointer opaque) {
  auto* reply = static_cast<Reply*>(opaque);
  LSMessage message{reply->payload};
  reply->callback(reply->bus, &message, reply->data);
  return G_SOURCE_REMOVE;
}
void Queue(LSHandle* bus, LSFilterFunc callback, void* data,
           const std::string& payload, LSMessageToken token = 42) {
  unsigned delay = (token == 43 || token == 46) ? stop_reply_delay_ms
                                                : reply_delay_ms;
  GSource* source = delay ? g_timeout_source_new(delay) : g_idle_source_new();
  g_source_set_callback(
      source, Deliver, new Reply{bus, callback, data, payload},
      [](gpointer opaque) { delete static_cast<Reply*>(opaque); });
  g_source_attach(source, bus->context);
  pending.emplace_back(token, g_source_ref(source));
  g_source_unref(source);
}
}  // namespace
namespace starboard {
namespace shared {
namespace webos {
LSHandle* LgNativeAppBus() { return reject_register ? nullptr : &app_bus; }
}  // namespace webos
}  // namespace shared
}  // namespace starboard
extern "C" {
bool LSErrorInit(LSError* error) {
  std::memset(error, 0, sizeof(*error));
  return true;
}
void LSErrorFree(LSError*) {}
bool LSRegister(const char* name, LSHandle** handle, LSError*) {
  assert(name && std::strcmp(name, "youtube.leanback.v4") == 0);
  if (reject_register) return false;
  *handle = new LSHandle;
  ++handles;
  return true;
}
bool LSGmainContextAttach(LSHandle* bus, GMainContext* context, LSError*) {
  bus->context = context;
  return true;
}
GMainContext* LSGmainGetContext(LSHandle* bus, LSError*) {
  return bus->context;
}
bool LSCall(LSHandle* bus, const char* uri, const char* payload,
            LSFilterFunc callback, void* data, LSMessageToken* token,
            LSError*) {
  if (std::strstr(uri, "/getDevices")) {
    *token = 44;
    Queue(bus, callback, data,
          fallback_no_device
              ? "{\"returnValue\":true,\"devices\":[]}"
              : "{\"returnValue\":true,\"devices\":[{\"id\":\"remote1\","
                "\"deviceType\":\"remote\",\"deviceName\":\"test\"}]}",
          44);
    return true;
  }
  if (std::strstr(uri, "/startStreaming")) {
    assert(std::strstr(payload, "remote1"));
    assert(std::strstr(payload, "\"subscribe\":true"));
    *token = 45;
    if (fallback_reject_stream) {
      Queue(bus, callback, data,
            "{\"returnValue\":false,\"errorCode\":2000,"
            "\"errorText\":\"fail to find voice device\"}",
            45);
    } else {
      json_object* object = json_object_new_object();
      json_object_object_add(object, "returnValue",
                             json_object_new_boolean(true));
      json_object_object_add(object, "subscribed",
                             json_object_new_boolean(true));
      json_object_object_add(object, "websocket",
                             json_object_new_string(path.c_str()));
      Queue(bus, callback, data, json_object_to_json_string(object), 45);
      json_object_put(object);
    }
    return true;
  }
  assert(std::strstr(uri, "/recordVoice"));
  assert(std::strstr(payload, "\"socketType\":\"socket\""));
  *token = 42;
  if (fallback) {
    Queue(bus, callback, data,
          "{\"returnValue\":false,\"errorCode\":300,"
          "\"errorText\":\"precondition not satisfied\"}",
          42);
  } else if (reject_record) {
    Queue(bus, callback, data,
          "{\"returnValue\":true,\"event\":\"error\",\"errorCode\":\"6020\","
          "\"errorText\":\"failed to open voice stream\"}");
  } else {
    json_object* object = json_object_new_object();
    json_object_object_add(object, "returnValue",
                           json_object_new_boolean(true));
    json_object_object_add(object, "voiceTicket",
                           json_object_new_string("TEST-TICKET"));
    json_object_object_add(object, "websocket",
                           json_object_new_string(path.c_str()));
    Queue(bus, callback, data, json_object_to_json_string(object));
    json_object_put(object);
  }
  return true;
}
bool LSCallOneReply(LSHandle* bus, const char* uri, const char* payload,
                    LSFilterFunc callback, void* data, LSMessageToken* token,
                    LSError*) {
  if (std::strstr(uri, "/getDevices")) {
    *token = 44;
    Queue(bus, callback, data,
          fallback_no_device
              ? "{\"returnValue\":true,\"devices\":[]}"
              : "{\"returnValue\":true,\"devices\":[{\"id\":\"remote1\","
                "\"deviceType\":\"remote\",\"deviceName\":\"test\"}]}",
          44);
    return true;
  }
  if (std::strstr(uri, "/stopStreaming")) {
    assert(fallback_no_device || std::strstr(payload, "remote1"));
    assert(std::strstr(payload, "\"deviceType\":\"remote\""));
    ++stream_stops;
    *token = 46;
    Queue(bus, callback, data, "{\"returnValue\":true}", 46);
    return true;
  }
  assert(std::strstr(uri, "/stopRecordingVoice"));
  assert(std::strstr(payload, "TEST-TICKET"));
  ++stops;
  *token = 43;
  Queue(bus, callback, data, "{\"returnValue\":true}", 43);
  return true;
}
const char* LSMessageGetPayload(LSMessage* message) {
  return message->payload.c_str();
}
bool LSCallCancel(LSHandle*, LSMessageToken token, LSError*) {
  assert(token >= 42 && token <= 46);
  if (token == 42 || token == 44 || token == 45) ++cancellations;
  for (auto it = pending.begin(); it != pending.end();) {
    if (it->first == token) {
      g_source_destroy(it->second);
      g_source_unref(it->second);
      it = pending.erase(it);
    } else
      ++it;
  }
  return true;
}
bool LSUnregister(LSHandle* bus, LSError*) {
  delete bus;
  --handles;
  return true;
}
}

int main() {
  using namespace std::chrono;
  app_bus.context = g_main_context_new();
  GMainLoop* app_loop = g_main_loop_new(app_bus.context, false);
  std::thread app_dispatch([&] { g_main_loop_run(app_loop); });
  char directory[] = "/tmp/ytaf-mic-test-XXXXXX";
  assert(mkdtemp(directory));
  path = std::string(directory) + "/pcm.sock";
  int server = socket(AF_UNIX, SOCK_STREAM, 0);
  assert(server >= 0);
  sockaddr_un address{};
  address.sun_family = AF_UNIX;
  std::strcpy(address.sun_path, path.c_str());
  assert(bind(server, reinterpret_cast<sockaddr*>(&address), sizeof(address)) ==
         0);
  assert(listen(server, 1) == 0);
  std::thread writer([server] {
    int client = accept(server, nullptr, nullptr);
    assert(client >= 0);
    // Split a sample across recv calls; overflow must discard complete samples.
    const unsigned char data[]{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
    assert(send(client, data, 1, 0) == 1);
    std::this_thread::sleep_for(milliseconds(30));
    assert(send(client, data + 1, sizeof(data) - 1, 0) == 11);
    std::this_thread::sleep_for(milliseconds(300));
    close(client);
  });
  ::starboard::shared::webos::LgVoiceCapture capture(8);
  assert(capture.Open());
  unsigned char data[16]{};
  int received = 0;
  auto read_deadline = steady_clock::now() + seconds(2);
  while (received == 0 && steady_clock::now() < read_deadline) {
    received = capture.Read(data, sizeof(data));
    if (received == 0) std::this_thread::sleep_for(milliseconds(10));
  }
  assert(received == 8);
  for (int i = 0; i < 8; ++i) assert(data[i] == i + 1);
  assert(capture.Read(data, sizeof(data)) == 0);
  // Opening an already open microphone clears unread data gracefully.
  assert(capture.Open());
  capture.Close();
  capture.Close();
  assert(capture.Read(data, sizeof(data)) == -1);
  writer.join();
  close(server);
  assert(stops == 1 && cancellations == 1 && handles == 0);

  // Closing before the asynchronous ticket arrives must still stop that ticket.
  // A recording ticket can arrive after the old 500 ms shutdown window.
  reply_delay_ms = 900;
  assert(capture.Open());
  capture.Close();
  assert(stops == 2 && cancellations == 2 && handles == 0);
  reply_delay_ms = 0;

  reject_record = true;
  assert(capture.Open());
  auto deadline = steady_clock::now() + seconds(1);
  while (capture.Read(data, sizeof(data)) >= 0 &&
         steady_clock::now() < deadline)
    std::this_thread::sleep_for(milliseconds(10));
  assert(capture.Error().find("6020") != std::string::npos);
  capture.Close();
  assert(cancellations == 3 && handles == 0);

  reject_register = true;
  assert(!capture.Open());
  capture.Close();
  assert(handles == 0);
  reject_register = false;
  reject_record = false;
  // A delayed stop reply must be cancelled before the microphone is destroyed;
  // libhelpers' shared app connection and dispatch thread keep running.
  stop_reply_delay_ms = 900;
  {
    ::starboard::shared::webos::LgVoiceCapture delayed_stop(320);
    assert(delayed_stop.Open());
    std::this_thread::sleep_for(milliseconds(30));
    delayed_stop.Close();
  }
  std::this_thread::sleep_for(milliseconds(950));
  assert(pending.empty() && handles == 0);

  // C1: voiceconductor returns 300, so capture must fall back to voiceinput.
  const std::string pcm_path = path;
  path = std::string(directory) + "/fallback.sock";
  int fallback_server = socket(AF_UNIX, SOCK_STREAM, 0);
  assert(fallback_server >= 0);
  sockaddr_un fallback_address{};
  fallback_address.sun_family = AF_UNIX;
  std::strcpy(fallback_address.sun_path, path.c_str());
  assert(bind(fallback_server,
              reinterpret_cast<sockaddr*>(&fallback_address),
              sizeof(fallback_address)) == 0);
  assert(listen(fallback_server, 1) == 0);
  std::thread fallback_writer([fallback_server] {
    int client = accept(fallback_server, nullptr, nullptr);
    assert(client >= 0);
    const unsigned char pcm[]{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
    assert(send(client, pcm, sizeof(pcm), 0) ==
           static_cast<ssize_t>(sizeof(pcm)));
    std::this_thread::sleep_for(milliseconds(300));
    close(client);
  });
  fallback = true;
  const int stops_before = stops.load();
  const int cancels_before = cancellations.load();
  {
    ::starboard::shared::webos::LgVoiceCapture fallback_capture(8);
    assert(fallback_capture.Open());
    unsigned char fallback_data[16]{};
    int fallback_received = 0;
    auto fallback_deadline = steady_clock::now() + seconds(2);
    while (fallback_received == 0 &&
           steady_clock::now() < fallback_deadline) {
      fallback_received = fallback_capture.Read(fallback_data,
                                                sizeof(fallback_data));
      if (fallback_received == 0)
        std::this_thread::sleep_for(milliseconds(10));
    }
    assert(fallback_received == 8);
    for (int i = 0; i < 8; ++i) assert(fallback_data[i] == i + 1);
    fallback_capture.Close();
  }
  fallback_writer.join();
  close(fallback_server);
  fallback = false;
  assert(stops == stops_before);
  assert(stream_stops == 1);
  assert(cancellations == cancels_before + 3);
  assert(handles == 0);

  // No remote in the device list must fail cleanly instead of hanging.
  fallback = true;
  fallback_no_device = true;
  {
    ::starboard::shared::webos::LgVoiceCapture no_device(8);
    assert(no_device.Open());
    auto no_device_deadline = steady_clock::now() + seconds(1);
    while (no_device.Error().empty() &&
           steady_clock::now() < no_device_deadline)
      std::this_thread::sleep_for(milliseconds(10));
    assert(no_device.Error().find("no remote device") != std::string::npos);
    no_device.Close();
  }
  fallback_no_device = false;
  fallback = false;
  assert(handles == 0);

  unlink(path.c_str());
  unlink(pcm_path.c_str());
  rmdir(directory);
  g_main_loop_quit(app_loop);
  app_dispatch.join();
  g_main_loop_unref(app_loop);
  g_main_context_unref(app_bus.context);
  std::puts(
      "LG voice capture: PCM, overflow, reopen, shutdown, service failures and "
      "C1 fallback passed");
}
