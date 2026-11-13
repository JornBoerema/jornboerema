#!/bin/sh
# Rebuilds the asset catalog from the shared sources: every Hugeicon the native
# desktop app carries (apps/even-native/assets/hi) as a template vector named
# hi-<name>, the brand mark, and the app icon from the web app's icon.
set -eu
cd "$(dirname "$0")/.."
catalog=EvenMail/Assets.xcassets
icons=$catalog/Icons
rm -rf "$icons" && mkdir -p "$icons"
printf '{"info":{"author":"xcode","version":1},"properties":{"provides-namespace":false}}\n' > "$icons/Contents.json"
for svg in ../even-native/assets/hi/*.svg; do
  name=hi-$(basename "$svg" .svg)
  set=$icons/$name.imageset
  mkdir -p "$set"
  cp "$svg" "$set/$name.svg"
  printf '{"images":[{"filename":"%s.svg","idiom":"universal"}],"info":{"author":"xcode","version":1},"properties":{"preserves-vector-representation":true,"template-rendering-intent":"template"}}\n' "$name" > "$set/Contents.json"
done
brand=$catalog/Brand.imageset
mkdir -p "$brand"
cp ../mail-web/public/icon.svg "$brand/brand.svg"
printf '{"images":[{"filename":"brand.svg","idiom":"universal"}],"info":{"author":"xcode","version":1},"properties":{"preserves-vector-representation":true}}\n' > "$brand/Contents.json"
# iOS rounds the icon itself and refuses transparency: the same picture, square.
app=$catalog/AppIcon.appiconset
mkdir -p "$app"
sed -e 's/rx="10"//g' -e 's/rx="9.5"//g' ../mail-web/public/icon.svg > /tmp/even-mail-icon.svg
rsvg-convert -w 1024 -h 1024 -b '#f07a2b' /tmp/even-mail-icon.svg -o "$app/icon.png"
rm /tmp/even-mail-icon.svg
printf '{"images":[{"filename":"icon.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}\n' > "$app/Contents.json"
printf '{"info":{"author":"xcode","version":1}}\n' > "$catalog/Contents.json"
