#!/bin/sh
# Looks at the app without getting in the way: starts the debug build behind
# every other window, waits, saves a picture of its window, and quits it.
#   scripts/shot.sh out.png [seconds] [app]     app: mail | todo | notes
# Needs `cargo build` first. Never click or type on the screen to test.
set -e
cd "$(dirname "$0")/.."
OUT="$1"; WAIT="${2:-6}"; APP="${3:-mail}"
BIN=target/winid
[ -x "$BIN" ] || swiftc -O -o "$BIN" scripts/winid.swift
EVEN_BACKGROUND=1 EVEN_APP="$APP" ./target/debug/even-native >/dev/null 2>&1 &
PID=$!
sleep "$WAIT"
ID=$("$BIN" even-native | head -1)
screencapture -x -o -l"$ID" "$OUT" || true
kill $PID
