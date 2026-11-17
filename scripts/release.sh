#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
releases="$root/release"
keep=2

version="$(node -p 'require(process.argv[1]).version' "$root/src-tauri/tauri.conf.json")"
target="$releases/$version"

if [ -e "$target" ]; then
  echo "release: $target already exists; bump the version in src-tauri/tauri.conf.json first" >&2
  exit 1
fi

(cd "$root" && pnpm tauri build --bundles app)

built="$root/src-tauri/target/release/bundle/macos/Fathom.app"
mkdir -p "$target"
ditto "$built" "$target/Fathom.app"
codesign --verify --deep "$target/Fathom.app"

find "$releases" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort -V | awk -v keep="$keep" '{ names[NR] = $0 } END { for (i = 1; i <= NR - keep; i++) print names[i] }' |
  while read -r old; do
    echo "release: removing $releases/$old"
    rm -rf "${releases:?}/$old"
  done

echo "release: built $target/Fathom.app"
ls -1 "$releases" | sort -V | sed 's/^/release: kept /'
