#!/bin/sh
# Archives a release build and uploads it to App Store Connect, where it shows
# up under TestFlight after processing. Uses the Apple account Xcode is signed
# in with; the build number is raised by App Store Connect itself.
set -eu
cd "$(dirname "$0")/.."
rm -rf build/EvenMail.xcarchive build/export
xcodebuild -project EvenMail.xcodeproj -scheme EvenMail -destination 'generic/platform=iOS' \
  -configuration Release -derivedDataPath build -archivePath build/EvenMail.xcarchive \
  -allowProvisioningUpdates archive | grep -E "error:|ARCHIVE" | sort -u
xcodebuild -exportArchive -archivePath build/EvenMail.xcarchive \
  -exportOptionsPlist scripts/ExportOptions.plist -exportPath build/export \
  -allowProvisioningUpdates 2>&1 | grep -E "error|Upload|EXPORT|not found" | sort -u
