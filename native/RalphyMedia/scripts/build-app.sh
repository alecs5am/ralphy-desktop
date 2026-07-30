#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
app_bundle="$project_dir/dist/Ralphy Media.app"
resources_dir="$app_bundle/Contents/Resources"
icon_source="$project_dir/Resources/AppIcon.png"
info_plist="$project_dir/Resources/Info.plist"
iconset_dir="$(mktemp -d "${TMPDIR:-/tmp}/RalphyMedia.XXXXXX.iconset")"

cleanup() {
    rm -rf "$iconset_dir"
}
trap cleanup EXIT

cd "$project_dir"
swift build -c release
binary_dir="$(swift build -c release --show-bin-path)"
binary="$binary_dir/RalphyMedia"

[[ -x "$binary" ]] || {
    printf 'Release executable not found: %s\n' "$binary" >&2
    exit 1
}
[[ -f "$icon_source" && -f "$info_plist" ]] || {
    printf 'Missing bundle resource.\n' >&2
    exit 1
}

rm -rf "$app_bundle"
mkdir -p "$app_bundle/Contents/MacOS" "$resources_dir"

while IFS=: read -r filename pixels; do
    sips -z "$pixels" "$pixels" "$icon_source" --out "$iconset_dir/$filename" >/dev/null
done <<'ICON_SIZES'
icon_16x16.png:16
icon_16x16@2x.png:32
icon_32x32.png:32
icon_32x32@2x.png:64
icon_128x128.png:128
icon_128x128@2x.png:256
icon_256x256.png:256
icon_256x256@2x.png:512
icon_512x512.png:512
icon_512x512@2x.png:1024
ICON_SIZES

iconutil -c icns "$iconset_dir" -o "$resources_dir/AppIcon.icns"
cp "$info_plist" "$app_bundle/Contents/Info.plist"
cp "$binary" "$app_bundle/Contents/MacOS/RalphyMedia"
codesign --force --deep --sign - "$app_bundle"

printf '%s\n' "$app_bundle"
