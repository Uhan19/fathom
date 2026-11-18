#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
releases="$root/release"
bundles="$root/src-tauri/target/release/bundle"
keep=2

version="$(node -p 'require(process.argv[1]).version' "$root/src-tauri/tauri.conf.json")"
target="$releases/$version"

if [ -e "$target" ]; then
  echo "release: $target already exists; bump the version in src-tauri/tauri.conf.json first" >&2
  exit 1
fi

release_macos() {
  (cd "$root" && pnpm tauri build --bundles app)
  mkdir -p "$target"
  ditto "$bundles/macos/Fathom.app" "$target/Fathom.app"
  codesign --verify --deep "$target/Fathom.app"
}

release_linux() {
  (cd "$root" && pnpm tauri build --bundles deb,appimage)
  mkdir -p "$target"
  cp "$bundles/deb/Fathom_${version}_"*.deb "$bundles/appimage/Fathom_${version}_"*.AppImage "$target/"
}

case "$(uname -s)" in
  Darwin) release_macos ;;
  Linux) release_linux ;;
  *)
    echo "release: only macOS and Linux are supported" >&2
    exit 1
    ;;
esac

find "$releases" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort -V | awk -v keep="$keep" '{ names[NR] = $0 } END { for (i = 1; i <= NR - keep; i++) print names[i] }' |
  while read -r old; do
    echo "release: removing $releases/$old"
    rm -rf "${releases:?}/$old"
  done

echo "release: built $target"
ls -1 "$target" | sed 's/^/release: /'
ls -1 "$releases" | sort -V | sed 's/^/release: kept /'
