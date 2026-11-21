#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$root/site/favicon.svg" "$work/"
sed "s#</head>#<style>$(tr -d '\n' < "$root/scripts/og-image/og.css")</style></head>#" "$root/site/index.html" > "$work/index.html"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$work/profile" \
  --force-device-scale-factor=2 --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot="$work/og@2x.png" "file://$work/index.html" >/dev/null 2>&1
sips -z 630 1200 "$work/og@2x.png" --out "$root/site/og.png" >/dev/null
sips -g pixelWidth -g pixelHeight "$root/site/og.png" | tail -2
ls -l "$root/site/og.png" | awk '{print $5" bytes"}'
