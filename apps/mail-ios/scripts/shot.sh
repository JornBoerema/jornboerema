#!/bin/sh
# Builds the app, runs it in a simulator with made-up mail (EVEN_DEMO=1) and
# saves a screenshot: scripts/shot.sh out.png [device-udid] [nl|en] [light|dark]
# Nothing is asked of the API in this mode, so no account is touched.
set -eu
cd "$(dirname "$0")/.."
out=${1:-shot.png}
device=${2:-$(xcrun simctl list devices available | grep -m1 "iPhone" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')}
xcodebuild -project EvenMail.xcodeproj -scheme EvenMail -destination 'generic/platform=iOS Simulator' \
  -configuration Debug -derivedDataPath build CODE_SIGNING_ALLOWED=NO ARCHS=arm64 build 2>&1 | grep -E "error:|BUILD" | sort -u
xcrun simctl boot "$device" 2>/dev/null || true
xcrun simctl bootstatus "$device" >/dev/null
xcrun simctl install "$device" "$(find build/Build/Products -name EvenMail.app | head -1)"
xcrun simctl terminate "$device" nl.jornboerema.even.mail 2>/dev/null || true
SIMCTL_CHILD_EVEN_DEMO=1 SIMCTL_CHILD_EVEN_LANG=${3:-nl} SIMCTL_CHILD_EVEN_THEME=${4:-light} \
  SIMCTL_CHILD_EVEN_SHOW=${EVEN_SHOW:-} xcrun simctl launch "$device" nl.jornboerema.even.mail >/dev/null
sleep "${EVEN_WAIT:-5}"
xcrun simctl io "$device" screenshot "$out" >/dev/null 2>&1
echo "$out"
