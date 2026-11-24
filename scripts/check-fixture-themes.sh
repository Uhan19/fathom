#!/usr/bin/env bash
# Runs `fathom theme check` on the fixture themes: the good ones must pass, the hostile ones must fail.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
fixtures="$root/fixtures/themes"
binary="$root/src-tauri/target/debug/fathom"
dev_url="http://localhost:1420/themecheck.html"
passing=(plain phosphor switchboard riso)
failing=(hostile-hidden hostile-white hostile-cover)

cargo build --manifest-path "$root/src-tauri/Cargo.toml"

work="$(mktemp -d)"
server=""
cleanup() {
  if [ -n "$server" ]; then kill "$server" 2>/dev/null || true; fi
  rm -rf "${work:?}"
}
trap cleanup EXIT

if ! curl -sf "$dev_url" >/dev/null; then
  "$root/node_modules/.bin/vite" --config "$root/vite.config.ts" --port 1420 --strictPort "$root" >"$work/vite.log" 2>&1 &
  server=$!
  for _ in $(seq 1 60); do
    curl -sf "$dev_url" >/dev/null && break
    sleep 1
  done
fi

check() {
  local id="$1"
  cp -R "$fixtures/$id" "$work/$id"
  "$binary" theme check "$work/$id" --json --db "$work/fathom.sqlite" >"$work/$id.json" 2>"$work/$id.log" || true
}

verdict() {
  node -e '
    const [file, want] = process.argv.slice(1);
    const outcome = JSON.parse(require("fs").readFileSync(file, "utf8"));
    const reset = outcome.findings.filter((f) => f.control === "reset-theme");
    if (reset.length) { console.error("the reset shortcut was blocked:", reset); process.exit(1); }
    if (want === "pass" && !outcome.passed) { console.error(JSON.stringify(outcome.findings.slice(0, 20), null, 2)); process.exit(1); }
    if (want === "fail" && (outcome.passed || outcome.findings.length === 0)) { console.error("expected the check to fail"); process.exit(1); }
    console.log(`${outcome.theme}: ${outcome.passed ? "passed" : `${outcome.findings.length} problems`}`);
  ' "$1" "$2"
}

status=0
for id in "${passing[@]}"; do
  check "$id"
  verdict "$work/$id.json" pass || { cat "$work/$id.log"; status=1; }
done
for id in "${failing[@]}"; do
  check "$id"
  verdict "$work/$id.json" fail || { cat "$work/$id.log"; status=1; }
done
exit "$status"
