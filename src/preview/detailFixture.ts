import type { CardContext, FileEntry, FilePreview, PrStatus, StatusEntry } from "../api";

const HOME = "/home/demo/firstmate";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const FIXTURE_NOTES: Record<string, string> = {
  "atl-15": [
    "## Rollout plan",
    "The new limiter replaces the fixed window counter. Tracking ticket ATL-212, follow-up OPS-88.",
    "",
    "1. **Canary** on 5% of traffic for a day.",
    "2. Widen to 50% if the error rate stays under `0.1%`.",
    "3. Full rollout, then remove the old limiter in https://github.com/example/atlas-api/pull/421.",
    "",
    "### Context",
    "- Design discussion: https://reef-co.slack.com/archives/C04REEF01/p1795100000123456",
    "- Background issue: [why bursts slip through](https://github.com/example/atlas-api/issues/377)",
    "- Report: `data/atl-15/report.md`, numbers in data/atl-15/latency.png.",
    "- Dashboard while it runs: http://localhost:3000/limits",
    "- Limits doc in the repo: ~/projects/atlas-api/docs/limits.md",
    "",
    "> The canary needs a quiet hour; Tuesdays after 10:00 work best.",
  ].join("\n"),
  "atl-12": [
    "Retries on the payments webhook back off exponentially, but the budget is unbounded.",
    "",
    "Both options are compared in data/atl-12/options.md. See ATL-198 and the Linear project https://linear.app/reef-co/project/payments-hardening-4c1d2e.",
  ].join("\n"),
};

const ago = (ms: number) => Date.now() - ms;
const at = (ms: number) => Math.floor(ago(ms) / 1000) * 1000;

const ACTIVITY: Record<string, StatusEntry[]> = {
  "atl-15": [
    { state: "needs-decision", atMs: at(12 * MINUTE), key: null, text: "canary plan updated with a rollback step in `data/atl-15/report.md`, still needs your yes" },
    { state: "working", atMs: at(3 * HOUR), key: null, text: "opened https://github.com/example/atlas-api/pull/418 with the limiter behind a flag" },
    { state: "blocked", atMs: at(5 * HOUR), key: "ci", text: "CI could not reach the staging Redis; asked OPS-88 for access" },
    { state: "working", atMs: at(DAY + 2 * HOUR), key: null, text: "measured burst latency, chart saved to data/atl-15/latency.png" },
    { state: "working", atMs: at(3 * DAY), key: null, text: "started; reading the old limiter and ATL-212" },
  ],
  "atl-09": [
    { state: "working", atMs: at(40 * MINUTE), key: null, text: "read and write paths split, running the invoice tests" },
    { state: "paused", atMs: at(9 * DAY), key: null, text: "waiting for the schema freeze to lift" },
  ],
};

const RECORDED_PR: Record<string, string> = {
  "atl-15": "https://github.com/example/atlas-api/pull/418",
  "hrb-18": "https://github.com/example/harbor-web/pull/233",
};

export function fixtureContext(id: string, hasHome: boolean): CardContext {
  if (!hasHome) return { hasHome: false, recordedPr: null, activity: [], taskFolder: null };
  return { hasHome: true, recordedPr: RECORDED_PR[id] ?? null, activity: ACTIVITY[id] ?? [], taskFolder: `data/${id}` };
}

type Seed = [name: string, preview: FileEntry["preview"], size: number | null, age: number, kind?: FileEntry["kind"]];

const TASK_FILES: Record<string, Seed[]> = {
  "atl-15": [
    ["report.md", "markdown", 6_412, 12 * MINUTE],
    ["latency.png", "image", 48_210, DAY + 2 * HOUR],
    ["canary-plan.txt", "text", 1_204, 2 * DAY],
    ["rollout.html", "html", 22_840, 2 * DAY],
    ["worker.log", "text", 3_840_000, 4 * MINUTE],
    ["runs", "none", null, 3 * DAY, "folder"],
  ],
  "atl-12": [["options.md", "markdown", 3_100, 6 * HOUR]],
};

const MENTIONED: Record<string, string> = {
  "~/projects/atlas-api/docs/limits.md": "/home/demo/projects/atlas-api/docs/limits.md",
};

const entry = (id: string, [name, preview, size, age, kind = "file"]: Seed): FileEntry => ({
  path: `${HOME}/data/${id}/${name}`,
  name,
  folder: `data/${id}`,
  kind,
  preview,
  size,
  modifiedMs: ago(age),
  inTaskFolder: true,
  mentions: [],
});

export function fixtureFiles(id: string, mentioned: string[]): FileEntry[] {
  const inFolder = (TASK_FILES[id] ?? []).map((seed) => entry(id, seed));
  const byPath = new Map(inFolder.map((f) => [f.path, f]));
  const extra: FileEntry[] = [];
  for (const raw of mentioned) {
    const path = MENTIONED[raw] ?? (raw.startsWith("/") ? raw : `${HOME}/${raw}`);
    const known = byPath.get(path) ?? extra.find((f) => f.path === path);
    if (known) {
      known.mentions.push(raw);
      continue;
    }
    if (!MENTIONED[raw]) continue;
    extra.push({
      path,
      name: path.split("/").pop() ?? path,
      folder: "~/projects/atlas-api/docs",
      kind: "file",
      preview: "markdown",
      size: 2_048,
      modifiedMs: ago(20 * DAY),
      inTaskFolder: false,
      mentions: [raw],
    });
  }
  return [...inFolder, ...extra];
}

const REPORT = [
  "# Rate limiter rollout",
  "",
  "A token bucket per API key replaces the fixed one-minute window. The old window let **bursts of 2x** through at the minute boundary.",
  "",
  "## Numbers",
  "",
  "| Step | Traffic | p99 latency | Errors |",
  "| --- | --- | --- | --- |",
  "| Today | 100% old | 182 ms | 0.04% |",
  "| Canary | 5% new | 176 ms | 0.03% |",
  "",
  "The chart is in [latency.png](latency.png).",
  "",
  "## Rollback",
  "",
  "Flip `limiter.v2` off in the flag service; the old counter keeps running in shadow mode until step 3.",
  "",
  "```sh",
  "atlas flags set limiter.v2 off --env prod",
  "```",
  "",
  "- [x] Shadow mode verified",
  "- [ ] Canary approved",
  "",
  "Raw HTML stays text: <script>alert(1)</script>",
  "",
  "![remote image](https://example.com/tracker.png)",
].join("\n");

const LATENCY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320"><rect width="640" height="320" fill="#f6f4ef"/><g stroke="#d9d4c7"><line x1="48" y1="40" x2="608" y2="40"/><line x1="48" y1="120" x2="608" y2="120"/><line x1="48" y1="200" x2="608" y2="200"/><line x1="48" y1="280" x2="608" y2="280"/></g><polyline fill="none" stroke="#c2553b" stroke-width="4" points="48,210 128,190 208,230 288,120 368,210 448,200 528,90 608,205"/><polyline fill="none" stroke="#2f6f8f" stroke-width="4" points="48,220 128,215 208,222 288,205 368,218 448,214 528,208 608,216"/><text x="48" y="28" font-family="sans-serif" font-size="16" fill="#3b3a36">p99 latency during bursts (ms)</text></svg>`;

const PREVIEWS: Record<string, Omit<FilePreview, "size">> = {
  "report.md": { kind: "markdown", text: REPORT, dataUrl: null, truncated: false },
  "options.md": { kind: "markdown", text: "# Two options\n\n**A**: cap at 8 retries.\n\n**B**: cap at 4 retries and alert a minute later.", dataUrl: null, truncated: false },
  "limits.md": { kind: "markdown", text: "# Limits\n\nEach API key gets 600 requests a minute with bursts up to 50.", dataUrl: null, truncated: false },
  "latency.png": { kind: "image", text: null, dataUrl: `data:image/svg+xml;base64,${btoa(LATENCY_SVG)}`, truncated: false },
  "canary-plan.txt": { kind: "text", text: "09:30  enable limiter.v2 for 5% of keys\n10:30  check error rate < 0.1%\n11:00  widen to 50%\n", dataUrl: null, truncated: false },
  "worker.log": {
    kind: "text",
    text: Array.from({ length: 400 }, (_, i) => `2026-11-20T09:${String(Math.floor(i / 7) % 60).padStart(2, "0")}:00Z  limiter shadow check ${i + 1}: ok`).join("\n"),
    dataUrl: null,
    truncated: true,
  },
};

export function fixturePreview(path: string, files: FileEntry[]): FilePreview {
  const name = path.split("/").pop() ?? "";
  const found = PREVIEWS[name];
  if (!found) throw `Fathom cannot preview ${name}; open it in its app instead.`;
  return { ...found, size: files.find((f) => f.path === path)?.size ?? 0 };
}

const PR_STATUS: Record<string, Pick<PrStatus, "state" | "checks">> = {
  "https://github.com/example/atlas-api/pull/418": { state: "open", checks: "passing" },
  "https://github.com/example/atlas-api/pull/421": { state: "draft", checks: "running" },
  "https://github.com/example/atlas-api/pull/402": { state: "merged", checks: "passing" },
  "https://github.com/example/harbor-web/pull/233": { state: "open", checks: "failing" },
  "https://github.com/example/ledger-sync/pull/97": { state: "closed", checks: "none" },
};

export function fixturePrStatus(url: string, signedIn: boolean): PrStatus {
  const known = PR_STATUS[url];
  if (!signedIn || !known) return { url, state: "unknown", checks: "unknown", title: null, note: "the GitHub CLI is not signed in" };
  return { url, ...known, title: null, note: null };
}
