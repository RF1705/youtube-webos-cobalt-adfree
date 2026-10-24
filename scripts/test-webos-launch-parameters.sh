#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/ytaf-launch-tests.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/include/starboard/webos"
ln -s "$repo_root/cobalt-platform/webos/arm" "$test_dir/include/starboard/webos/arm"

"${CXX:-g++}" -std=c++17 -Wall -Wextra -Werror \
  -I"$test_dir/include" -I"$repo_root/cobalt-platform/webos/arm" \
  "$repo_root/scripts/test-webos-launch-parameters.cc" \
  "$repo_root/cobalt-platform/webos/arm/launch_parameters.cc" \
  $(pkg-config --cflags --libs json-c) -o "$test_dir/test-webos-launch-parameters"
"$test_dir/test-webos-launch-parameters"
