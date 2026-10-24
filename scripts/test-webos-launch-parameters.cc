#include <cassert>
#include <cstdio>

#include "launch_parameters.h"
int main() {
  using ::starboard::shared::webos::WebosLaunchUrl;
  assert(WebosLaunchUrl("garbage").empty());
  assert(WebosLaunchUrl("{}").empty());
  assert(
      WebosLaunchUrl(
          R"({"@system_native_app":true,"contentTarget":"v=aqz-KE-bpKQ"})") ==
      "https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  assert(
      WebosLaunchUrl(
          R"({"event":"relaunch","parameters":{"contentTarget":"v=v=abc&list=123"}})") ==
      "https://www.youtube.com/watch?v=abc&list=123");
  assert(
      WebosLaunchUrl(
          R"({"params":{"contentTarget":"pairingCode=TEST&theme=cl&dialLaunch=watch"}})") ==
      "https://www.youtube.com/tv?pairingCode=TEST&theme=cl&dialLaunch=watch");
  assert(
      WebosLaunchUrl(
          R"({"contentTarget":{"intent":"SearchContent","intentParam":"ação & gatos"}})") ==
      "https://www.youtube.com/"
      "tv?inApp=true&vs=9&va=search&launch=voice&launch=search&vq=a%C3%A7%C3%"
      "A3o%20%26%20gatos");
  assert(
      WebosLaunchUrl(
          R"({"contentTarget":"https://www.youtube.com/tv#/watch?v=abc"})") ==
      "https://www.youtube.com/watch?v=abc");
  assert(
      WebosLaunchUrl(
          R"({"contentTarget":"https://www.youtube.com.attacker.test/watch?v=abc"})")
          .empty());
  assert(WebosLaunchUrl(R"json({"contentTarget":"javascript:alert(1)"})json")
             .empty());
  assert(WebosLaunchUrl(R"({"contentTarget":"v=abc\nignored"})").empty());
  assert(WebosLaunchUrl(
             R"({"contentTarget":{"intent":"Unknown","intentParam":"text"}})")
             .empty());
  std::puts("webOS launch parsing: 11 cases passed");
}
