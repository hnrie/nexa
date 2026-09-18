#!/usr/bin/env bash
# Starts the Android emulator the fast way on this Mac.
#
#   tools/emulator.sh          start it (and wait until it has booted)
#   tools/emulator.sh stop     shut it down
#
# The emulator decides by itself that an Intel HD 4600 is not good enough and
# falls back to SwiftShader — software rendering, every frame of the Android UI
# drawn by the CPU — even when told `-gpu host`, and even though the global
# advancedFeatures.ini says `ForceSwiftshader = off`. Only overriding the feature
# on the command line wins. Measured on the same scroll through a chat:
#
#                     frames drawn   median frame   90th percentile
#   SwiftShader            33           500 ms           750 ms
#   host GPU               96            61 ms           129 ms
#
# About eight times faster, and rendering correctly. It is still not 60 fps —
# a ten-year-old integrated GPU running Android 16 through OpenGL translation
# will not be — but it is usable, where two frames a second was not.
#
# Gradle's daemon is stopped first: it holds one to three gigabytes, and on a
# sixteen-gigabyte machine that is the difference between the emulator's own
# lowmemorykiller staying quiet and the system_server inside it timing out.
set -euo pipefail
[ -f "$HOME/.local/toolchain/env.sh" ] && . "$HOME/.local/toolchain/env.sh"
AVD="${AVD:-pixel}"

if [ "${1:-}" = "stop" ]; then
  adb emu kill >/dev/null 2>&1 || true
  # adb goes on listing a dying emulator for a few seconds, and a start in
  # that window would refuse, thinking one is still running
  for _ in $(seq 1 30); do
    adb get-state >/dev/null 2>&1 || exit 0
    sleep 1
  done
  exit 0
fi

if adb get-state >/dev/null 2>&1; then
  echo "an emulator is already running; run one at a time (tools/emulator.sh stop)"
  exit 1
fi

(cd "$(dirname "$0")/../android" && gradle --stop >/dev/null 2>&1) || true

nohup emulator -avd "$AVD" -gpu host -feature -ForceSwiftshader -no-boot-anim \
  >"${TMPDIR:-/tmp}/emulator.log" 2>&1 &

for _ in $(seq 1 90); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 3
done
renderer=$(grep -m1 "Graphics Adapter Android" "${TMPDIR:-/tmp}/emulator.log" | sed 's/.*Translator (//; s/)$//')
echo "booted — rendering on: ${renderer:-unknown}"
