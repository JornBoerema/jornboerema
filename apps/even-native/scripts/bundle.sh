#!/bin/sh
# Builds the release binary and puts it in an app bundle that runs on this Mac:
#   scripts/bundle.sh            -> target/bundle/Even Native.app
# The bundle is called "Even" in the menu bar and the Dock, with the id
# nl.jornboerema.even-native: not the Tauri app's, so both can be installed
# side by side and keep their own session and cache. Signed ad hoc, which is
# enough to run it here; not notarized, not published anywhere.
set -e
cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
APP="target/bundle/Even Native.app"
ICON_SOURCE=../desktop/src-tauri/icons/icon.png
ICON=assets/app/Even.icns

# The icon of the Tauri app, as an .icns of our own. The source is only read.
if [ ! -f "$ICON" ] || [ "$ICON_SOURCE" -nt "$ICON" ]; then
  SET=target/bundle/Even.iconset
  rm -rf "$SET"; mkdir -p "$SET" "$(dirname "$ICON")"
  for SIZE in 16 32 128 256 512; do
    sips -z $SIZE $SIZE "$ICON_SOURCE" --out "$SET/icon_${SIZE}x${SIZE}.png" >/dev/null
  done
  # The source is 512 wide: every @2x up to that, none above it.
  for SIZE in 16 32 128 256; do
    DOUBLE=$((SIZE * 2))
    sips -z $DOUBLE $DOUBLE "$ICON_SOURCE" --out "$SET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$ICON"
  rm -rf "$SET"
fi

cargo build --release

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp target/release/even-native "$APP/Contents/MacOS/even-native"
cp "$ICON" "$APP/Contents/Resources/Even.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Even</string>
  <key>CFBundleDisplayName</key><string>Even</string>
  <key>CFBundleIdentifier</key><string>nl.jornboerema.even-native</string>
  <key>CFBundleExecutable</key><string>even-native</string>
  <key>CFBundleIconFile</key><string>Even</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleLocalizations</key><array><string>en</string><string>nl</string></array>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>12.3</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict>
</plist>
PLIST

codesign --force -s - "$APP"
echo "$APP ($VERSION)"
