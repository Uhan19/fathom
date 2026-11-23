#!/usr/bin/env bash
set -euo pipefail

icon_sizes=(16 32 48 64 128 256 512)
desktop_lines=(Name=Fathom Exec=fathom Icon=fathom StartupWMClass=fathom)

release_dir="$(cd "${1:?usage: check-linux-packages.sh <release dir>}" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() {
  echo "check-linux-packages: $*" >&2
  exit 1
}

only_file() {
  local matches=("$release_dir"/$1)
  [ "${#matches[@]}" -eq 1 ] && [ -f "${matches[0]}" ] || fail "expected exactly one $1 in $release_dir"
  echo "${matches[0]}"
}

check_desktop_entry() {
  local entry="$1"
  [ -f "$entry" ] || fail "missing desktop entry $entry"
  for line in "${desktop_lines[@]}"; do
    grep -qx "$line" "$entry" || fail "$entry lacks $line"
  done
}

check_png() {
  local icon="$1" size="$2"
  [ -f "$icon" ] || fail "missing $icon"
  file -L "$icon" | grep -q "PNG image data, $size x $size," || fail "$icon is not a ${size}x${size} PNG"
}

check_icons() {
  local hicolor="$1/usr/share/icons/hicolor"
  for size in "${icon_sizes[@]}"; do
    check_png "$hicolor/${size}x${size}/apps/fathom.png" "$size"
  done
  local scaled
  scaled="$(find "$hicolor" -path '*@*' -name fathom.png)"
  [ -z "$scaled" ] || fail "icon in a scaled directory: $scaled"
}

deb="$(only_file '*.deb')"
mkdir "$work/deb"
dpkg-deb -x "$deb" "$work/deb"
check_desktop_entry "$work/deb/usr/share/applications/Fathom.desktop"
check_icons "$work/deb"
echo "check-linux-packages: $(basename "$deb") has its desktop entry and icons"

appimage="$(only_file '*.AppImage')"
cp "$appimage" "$work/Fathom.AppImage"
chmod +x "$work/Fathom.AppImage"
(cd "$work" && ./Fathom.AppImage --appimage-extract >/dev/null)
check_desktop_entry "$work/squashfs-root/Fathom.desktop"
check_icons "$work/squashfs-root"
check_png "$work/squashfs-root/.DirIcon" 512
echo "check-linux-packages: $(basename "$appimage") has its desktop entry and icons"
