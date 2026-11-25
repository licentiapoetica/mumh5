#!/usr/bin/env bash
# Desktop share end to end: two instances of the smoke-test build on the test server
# (127.0.0.1:64750), one sharing its mock camera or mock screen, the other watching.
# Usage: tools/desktop-share-e2e.sh [camera|screen] [path/to/mumh5-desktop]
# Runs on whatever display the environment names (a virtual compositor is best:
# kwin_wayland --virtual --socket NAME, then WAYLAND_DISPLAY=NAME GDK_BACKEND=wayland).
set -u
kind=${1:-camera}
app=${2:-./target/debug/mumh5-desktop}
out=$(mktemp -d)
pids=()
for role in sender viewer; do
  { echo "const ROLE = '$role'; const KIND = '$kind';"; cat crates/desktop/tests/share-e2e.js; } > "$out/$role.js"
  mkdir -p "$out/profile-$role"
  env LANG=en_US.UTF-8 MUMH5_PROFILE="$out/profile-$role" MUMH5_SMOKE_STAY=1 MUMH5_SMOKE_MOCK_MEDIA=1 \
    MUMH5_SMOKE_REPORT="$out/$role.json" MUMH5_SMOKE_SCRIPT="$out/$role.js" PULSE_SERVER=unix:/nonexistent \
    timeout 150 dbus-run-session -- "$app" > "$out/$role.log" 2>&1 &
  pids+=($!)
  sleep 2
done
for _ in $(seq 1 140); do sleep 1; grep -q '"done": true' "$out/viewer.json" 2>/dev/null && break; done
kill "${pids[@]}" 2>/dev/null; wait "${pids[@]}" 2>/dev/null
cat "$out/viewer.json" 2>/dev/null || echo "no report; logs in $out"
grep -q '"ok": true' "$out/viewer.json" 2>/dev/null
