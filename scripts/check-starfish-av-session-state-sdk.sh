#!/usr/bin/env bash
# Syntax-check only: no overlay installation or modifications to Cobalt/SDK.
# Run inside the existing SDK container with /repo and /sdk mounted read-only.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cobalt_root="${COBALT_SOURCE_DIR:-$repo_root/workdir/cobalt-23.lts.6}"
sdk_root="${WEBOS_SDK_ROOT:-/sdk/arm-webos-linux-gnueabi_sdk-buildroot}"
compiler="$sdk_root/bin/arm-webos-linux-gnueabi-g++"
"$compiler" \
  --sysroot="$sdk_root/arm-webos-linux-gnueabi/sysroot" \
  -std=c++14 -Wall -Wextra -Werror -Wno-expansion-to-defined -fsyntax-only \
  -mcpu=cortex-a9 -mfloat-abi=softfp -mfpu=neon \
  -DYTAF_TEST_COBALT_INPUT_BUFFER \
  -DSTARBOARD -DSTARBOARD_WEBOS -DCOBALT -DSTARBOARD_IMPLEMENTATION -DSB_API_VERSION=13 \
  -DSB_IS_ARCH_ARM=1 -DSB_IS_32_BIT=1 -DSB_IS_LITTLE_ENDIAN=1 \
  -DSB_SIZE_OF_POINTER=4 -DSB_SIZE_OF_LONG=4 \
  '-DSTARBOARD_CONFIGURATION_INCLUDE="starboard/webos/arm/configuration_public.h"' \
  '-DSTARBOARD_ATOMIC_INCLUDE="starboard/webos/arm/atomic_public.h"' \
  -I"$repo_root/cobalt-platform/webos/arm" -I"$cobalt_root" \
  "$repo_root/scripts/test-starfish-av-session-state.cc"
echo 'Shared Starfish A/V state passed ARM/Cobalt InputBuffer syntax checks.'

# Keep the SDK and Cobalt headers as system includes: existing upstream
# default virtual methods intentionally have unused parameters.
"$compiler" \
  --sysroot="$sdk_root/arm-webos-linux-gnueabi/sysroot" \
  -std=c++14 -Wall -Wextra -Werror -Wno-expansion-to-defined -fsyntax-only \
  -mcpu=cortex-a9 -mfloat-abi=softfp -mfpu=neon \
  -DSTARBOARD -DSTARBOARD_WEBOS -DCOBALT -DSTARBOARD_IMPLEMENTATION -DSB_API_VERSION=13 \
  -DSB_IS_ARCH_ARM=1 -DSB_IS_32_BIT=1 -DSB_IS_LITTLE_ENDIAN=1 \
  -DSB_SIZE_OF_POINTER=4 -DSB_SIZE_OF_LONG=4 \
  '-DSTARBOARD_CONFIGURATION_INCLUDE="starboard/webos/arm/configuration_public.h"' \
  '-DSTARBOARD_ATOMIC_INCLUDE="starboard/webos/arm/atomic_public.h"' \
  -isystem "$repo_root/workdir/deps/SDL2-2.30.12-webos-abi/include" \
  -isystem "$cobalt_root" \
  "$repo_root/cobalt-platform/webos/arm/starfish_av_components.cc"
echo 'Shared Starfish A/V native components passed ARM syntax checks.'
