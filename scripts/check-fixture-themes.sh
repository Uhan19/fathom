#!/usr/bin/env bash
# Runs `fathom theme check` on the fixture themes: the good ones must pass, the hostile ones must fail.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
fixtures="$root/fixtures/themes"
binary="$root/src-tauri/target/debug/fathom"
check_limit=420
passing=(plain phosphor switchboard riso painted-text)
failing=(hostile-hidden hostile-white:contrast hostile-cover hostile-paint:label)

pnpm --dir "$root" vite:build
cargo build --manifest-path "$root/src-tauri/Cargo.toml" --features tauri/custom-protocol

work="$(mktemp -d)"
trap 'rm -rf "${work:?}"' EXIT

limit_runtime="$(command -v timeout || command -v gtimeout || true)"

check() {
  local id="$1"
  cp -R "$fixtures/$id" "$work/$id"
  local started=$SECONDS code=0
  ${limit_runtime:+"$limit_runtime" --kill-after=10 "$check_limit"} "$binary" theme check "$work/$id" --json --db "$work/fathom.sqlite" >"$work/$id.json" 2>"$work/$id.log" || code=$?
  echo "$id: checked in $((SECONDS - started))s"
  if [ "$code" -eq 124 ] || [ "$code" -eq 137 ]; then
    echo "$id: the theme check did not finish within ${check_limit}s" >&2
    return 1
  fi
}

verdict() {
  node -e '
    const [file, want, problem] = process.argv.slice(1);
    const outcome = JSON.parse(require("fs").readFileSync(file, "utf8"));
    const reset = outcome.findings.filter((f) => f.control === "reset-theme");
    if (reset.length) { console.error("the reset shortcut was blocked:", reset); process.exit(1); }
    if (want === "pass" && !outcome.passed) { console.error(JSON.stringify(outcome.findings.slice(0, 20), null, 2)); process.exit(1); }
    if (want === "fail" && (outcome.passed || outcome.findings.length === 0)) { console.error("expected the check to fail"); process.exit(1); }
    if (problem && !outcome.findings.some((f) => f.problem.includes(problem))) { console.error(`expected a finding about ${problem}`); process.exit(1); }
    console.log(`${outcome.theme}: ${outcome.passed ? "passed" : `${outcome.findings.length} problems`}`);
  ' "$1" "$2" "${3:-}"
}

status=0
for id in "${passing[@]}"; do
  check "$id" && verdict "$work/$id.json" pass || { cat "$work/$id.log"; status=1; }
done
for entry in "${failing[@]}"; do
  id="${entry%%:*}"
  problem="${entry#"$id"}"
  check "$id" && verdict "$work/$id.json" fail "${problem#:}" || { cat "$work/$id.log"; status=1; }
done
exit "$status"
