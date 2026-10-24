#include "starboard/webos/arm/launch_parameters.h"

#include <json-c/json.h>

#include <cstring>

namespace starboard {
namespace shared {
namespace webos {
namespace {
std::string Encode(const std::string& value) {
  const char* digits = "0123456789ABCDEF";
  std::string out;
  for (unsigned char c : value) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '.' || c == '_' || c == '~')
      out += c;
    else {
      out += '%';
      out += digits[c >> 4];
      out += digits[c & 15];
    }
  }
  return out;
}

json_object* Field(json_object* object, const char* key) {
  json_object* result = nullptr;
  if (!object || !json_object_is_type(object, json_type_object)) return nullptr;
  json_object_object_get_ex(object, key, &result);
  return result;
}

std::string String(json_object* object) {
  return object && json_object_is_type(object, json_type_string)
             ? json_object_get_string(object)
             : "";
}

bool HasQuery(const std::string& query, const char* key) {
  return query.compare(0, std::strlen(key), key) == 0 ||
         query.find(std::string("&") + key) != std::string::npos;
}

std::string TargetUrl(json_object* target) {
  if (json_object_is_type(target, json_type_object)) {
    std::string intent = String(Field(target, "intent"));
    std::string text = String(Field(target, "intentParam"));
    if ((intent != "SearchContent" && intent != "PlayContent") || text.empty())
      return {};
    std::string engine = String(Field(target, "voiceEngine"));
    const char* system = engine == "googleAssistant" ? "2"
                         : engine == "amazonAlexa"   ? "3"
                                                     : "9";
    return std::string("https://www.youtube.com/tv?inApp=true&vs=") + system +
           "&va=" + (intent == "SearchContent" ? "search" : "play") +
           "&launch=voice" +
           (intent == "SearchContent" ? "&launch=search" : "") +
           "&vq=" + Encode(text);
  }
  std::string query = String(target);
  if (query.empty() || query.find_first_of("\r\n") != std::string::npos)
    return {};
  if (query.compare(0, 8, "https://") == 0 ||
      query.compare(0, 7, "http://") == 0) {
    size_t start = query.find("://") + 3;
    size_t end = query.find('/', start);
    if (end == std::string::npos) return {};
    std::string host = query.substr(start, end - start);
    if (host != "www.youtube.com" && host != "youtube.com" &&
        host != "m.youtube.com")
      return {};
    std::string path = query.substr(end);
    // Internal browser routes do not work as native Cobalt deep links.
    if (path.compare(0, 11, "/tv#/watch?") == 0) path = path.substr(4);
    return "https://www.youtube.com" + path;
  }
  if (query.compare(0, 4, "v=v=") == 0) query.erase(0, 2);
  // Preserve pairingCode, list, index, time, and DIAL launch attributes.
  if (HasQuery(query, "v=")) return "https://www.youtube.com/watch?" + query;
  if (HasQuery(query, "pairingCode=") || HasQuery(query, "q="))
    return "https://www.youtube.com/tv?" + query;
  return {};
}

std::string Find(json_object* object, int depth) {
  if (!object || depth > 6) return {};
  json_object* target = Field(object, "contentTarget");
  if (!target) target = Field(object, "target");
  if (target) return TargetUrl(target);
  for (const char* key :
       {"parameters", "params", "payload", "@system_native_app"}) {
    json_object* child = Field(object, key);
    if (!child) continue;
    if (json_object_is_type(child, json_type_string)) {
      json_object* parsed = json_tokener_parse(json_object_get_string(child));
      std::string found = Find(parsed, depth + 1);
      if (parsed) json_object_put(parsed);
      if (!found.empty()) return found;
    } else {
      std::string found = Find(child, depth + 1);
      if (!found.empty()) return found;
    }
  }
  return {};
}
}  // namespace

std::string WebosLaunchUrl(const std::string& payload) {
  if (payload.size() > 65536) return {};
  json_object* object = json_tokener_parse(payload.c_str());
  if (!object) return {};
  std::string result = Find(object, 0);
  json_object_put(object);
  return result;
}
}  // namespace webos
}  // namespace shared
}  // namespace starboard
