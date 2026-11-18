import type { Card, Column, Detail, MoveRequest, RowKey, Terminal, Worker } from "../api";

type Seed = [id: string, project: string, row: RowKey, title: string, extra?: Partial<Card>];

const SEEDS: Seed[] = [
  ["atl-12", "atlas-api", "surface", "Pick a retry budget for the payments webhook", { holdKind: "captain", holdReason: "Two options are written up in the report. Option B halves retries but delays alerts by a minute. Which one do you want?" }],
  ["atl-15", "atlas-api", "surface", "Approve the rate limiter rollout plan", { holdKind: "captain", holdReason: "The plan is ready; it needs your yes before the canary starts.", links: [{ kind: "pr", target: "https://github.com/example/atlas-api/pull/418" }] }],
  ["atl-09", "atlas-api", "shallows", "Split the invoice service into read and write paths", { state: "in_flight" }],
  ["atl-04", "atlas-api", "deep", "Move the nightly export to the new queue", { holdKind: "captain", holdUntil: "2026-12-02", holdReason: "Waiting until the queue migration finishes." }],
  ["atl-02", "atlas-api", "landed", "Fix duplicate receipts after a timeout", { state: "done", closed: "2026-11-14", links: [{ kind: "pr", target: "https://github.com/example/atlas-api/pull/402" }] }],
  ["atl-03", "atlas-api", "landed", "Find why webhook retries spike on Mondays", { state: "done", kind: "scout", closed: "2026-11-13", links: [{ kind: "report", target: "data/atl-03/report.md" }] }],
  ["atl-01", "atlas-api", "landed", "Add request ids to every log line", { state: "done", closed: "2026-11-09" }],
  ["hrb-21", "harbor-web", "surface", "Choose the empty-state copy for the dashboard", { holdKind: "captain", holdReason: "Three drafts are in the report. Pick one or edit." , links: [{ kind: "report", target: "data/harbor-web/empty-state-drafts.md" }] }],
  ["hrb-18", "harbor-web", "shallows", "Rebuild the settings page with the new form kit", { state: "in_flight", links: [{ kind: "pr", target: "https://github.com/example/harbor-web/pull/233" }] }],
  ["hrb-17", "harbor-web", "shallows", "Make the sidebar keyboard friendly", { state: "in_flight" }],
  ["hrb-16", "harbor-web", "shallows", "Compare three charting libraries", { state: "in_flight", kind: "scout" }],
  ["hrb-14", "harbor-web", "deep", "Try a denser table layout", { holdKind: "parked", holdReason: "Parked until the design review." }],
  ["hrb-11", "harbor-web", "seabed", "Ship dark mode", { blockedBy: ["hrb-18"] }],
  ["hrb-10", "harbor-web", "landed", "Lazy-load the charts bundle", { state: "done", closed: "2026-11-12" }],
  ["kel-07", "keel-cli", "surface", "Confirm the new flag names before release", { holdKind: "captain", holdReason: "Renaming --out to --output breaks two scripts we know about. OK to ship?" }],
  ["kel-05", "keel-cli", "deep", "Add shell completions for fish", { holdKind: "parked" }],
  ["kel-03", "keel-cli", "landed", "Print a hint when the config file is missing", { state: "done", closed: "2026-11-15" }],
  ["lan-31", "lantern-docs", "shallows", "Write the migration guide for v3", { state: "in_flight" }],
  ["lan-29", "lantern-docs", "deep", "Record the quick start screencast", { holdKind: "captain", holdUntil: "2026-11-28", holdReason: "Needs a quiet afternoon with a microphone." }],
  ["lan-27", "lantern-docs", "seabed", "Publish the v3 announcement", { blockedBy: ["lan-31", "kel-07"] }],
  ["led-44", "ledger-sync", "surface", "Decide what to do with orphaned ledger rows", { holdKind: "captain", holdReason: "There are 212 rows with no account. Delete, archive, or keep?" }],
  ["led-40", "ledger-sync", "deep", "Backfill currency codes for 2023", { holdKind: "parked" }],
  ["led-38", "ledger-sync", "deep", "Rewrite the reconciliation job in batches", { holdKind: "parked", holdReason: "Waiting for a quieter week." }],
  ["led-37", "ledger-sync", "landed", "Survey the flaky tests in the sync job", { state: "done", kind: "scout", closed: "2026-11-17" }],
  ["led-35", "ledger-sync", "landed", "Stop double-counting refunds", { state: "done", closed: "2026-11-16", links: [{ kind: "pr", target: "https://github.com/example/ledger-sync/pull/97" }] }],
  ["pil-08", "pilot-infra", "shallows", "Rotate the staging certificates", { state: "in_flight" }],
  ["pil-06", "pilot-infra", "deep", "Move backups to the cheaper storage tier", { holdKind: "captain", holdUntil: "2026-12-10" }],
  ["pil-05", "pilot-infra", "seabed", "Turn off the old build runners", { blockedBy: ["pil-08"] }],
  ["pil-02", "pilot-infra", "landed", "Alert when disk usage passes 80 percent", { state: "done", closed: "2026-11-10" }],
  ["son-13", "sonar-mobile", "deep", "Prototype offline mode", { holdKind: "parked" }],
  ["son-12", "sonar-mobile", "deep", "Upgrade the push notification library", { holdKind: "parked" }],
  ["son-09", "sonar-mobile", "landed", "Fix the crash on rotating the camera screen", { state: "done", closed: "2026-11-11" }],
];

const seeded = ([id, project, row, title, extra]: Seed): Card => ({
  id,
  title,
  project,
  row,
  state: "open",
  kind: "ship",
  holdKind: "",
  holdUntil: "",
  holdReason: "",
  blockedBy: [],
  links: [],
  closed: "",
  ...extra,
});

export const FIXTURE_CARDS: Card[] = SEEDS.map(seeded);

export const FIXTURE_LATE_CARD: Card = seeded(["kel-09", "keel-cli", "shallows", "Add a --quiet flag for scripts", { state: "in_flight" }]);

export const FIXTURE_WORKERS: Worker[] = [
  { taskId: "atl-09", terminal: "t3", status: "working" },
  { taskId: "hrb-18", terminal: "t4", status: "idle" },
  { taskId: "hrb-16", terminal: "t5", status: "working" },
  { taskId: "pil-08", terminal: "t6", status: "idle" },
];

const fixtureRequest = (over: Partial<MoveRequest> & Pick<MoveRequest, "cardId" | "fromRow" | "toRow">): MoveRequest => ({
  requestId: `fathom-move-${over.cardId}-1763400000000`,
  title: FIXTURE_CARDS.find((c) => c.id === over.cardId)?.title ?? "",
  createdMs: 1763400000000,
  status: "asked",
  noteId: `1763400000-${over.cardId}`,
  answer: null,
  error: null,
  ...over,
});

export const FIXTURE_REQUESTS: MoveRequest[] = [
  fixtureRequest({ cardId: "lan-27", fromRow: "seabed", toRow: "shallows" }),
  fixtureRequest({
    cardId: "kel-05",
    fromRow: "deep",
    toRow: "shallows",
    status: "answered",
    answer: "Not yet: completions depend on the flag rename in kel-07. I will pick this up once that ships.",
  }),
];

const columnsFor = (cards: Card[]): Column[] =>
  [...new Set(cards.map((c) => c.project))]
    .sort()
    .map((project, position) => ({ id: position + 1, project, name: project, position, width: 240, collapsed: false }));

export const FIXTURE_COLUMNS: Column[] = columnsFor(FIXTURE_CARDS);

type BacklogSeed = [id: number, project: string, row: RowKey, title: string];

const BACKLOG_SEEDS: BacklogSeed[] = [
  [1, "reef-map", "surface", "Confirm which survey grid to use"],
  [2, "reef-map", "shallows", "Chart the north reef from the new soundings"],
  [3, "reef-map", "seabed", "Mark the shipwrecks on the chart"],
  [4, "reef-map", "landed", "Import last year's buoy positions"],
  [5, "tide-tables", "shallows", "Fix the off-by-one hour in daylight saving weeks"],
  [6, "tide-tables", "seabed", "Add spring tide warnings"],
  [7, "tide-tables", "deep", "Port the tide model to the new library"],
  [8, "dry-dock", "seabed", "List the hull repairs for the winter"],
  [9, "dry-dock", "landed", "Book the crane for the mast lift"],
];

export const FIXTURE_BACKLOG_CARDS: Card[] = BACKLOG_SEEDS.map(([id, project, row, title]) =>
  seeded([String(id), project, row, title, { kind: "task", state: row === "landed" ? "done" : "open", closed: row === "landed" ? "2026-11-16" : "" }]),
);

export const FIXTURE_BACKLOG_COLUMNS: Column[] = columnsFor(FIXTURE_BACKLOG_CARDS);

const backlogRequest = (over: Partial<MoveRequest> & Pick<MoveRequest, "cardId" | "fromRow" | "toRow">): MoveRequest => ({
  ...fixtureRequest(over),
  title: FIXTURE_BACKLOG_CARDS.find((c) => c.id === over.cardId)?.title ?? "",
  noteId: null,
  ...over,
});

export const FIXTURE_BACKLOG_REQUESTS: MoveRequest[] = [
  backlogRequest({ cardId: "3", fromRow: "seabed", toRow: "shallows" }),
  backlogRequest({
    cardId: "7",
    fromRow: "deep",
    toRow: "shallows",
    status: "answered",
    answer: "Not yet: the new library has no tide model until its next release.",
  }),
];

export function fixtureDetail(card: Card): Detail {
  if (card.kind === "task") {
    return { card, body: `Invented preview notes for ${card.title.toLowerCase()}.`, created: "2026-11-02", priority: "", deps: [] };
  }
  return {
    card,
    body: `${card.title}.\n\nThis is invented preview text for ${card.project}. It stands in for the full task body that tasks-axi show returns.`,
    created: "2026-11-01",
    priority: card.row === "surface" ? "high" : "normal",
    deps: card.blockedBy,
  };
}

export const FIXTURE_TERMINALS: Terminal[] = [
  {
    address: "t1",
    name: "firstmate",
    title: "firstmate",
    state: "running",
    cwd: "/home/demo/firstmate",
    agent: "claude",
    labels: { "firstmate.role": "primary" },
    cols: 120,
    rows: 40,
  },
  {
    address: "t2",
    name: "scratch",
    title: "zsh",
    state: "running",
    cwd: "/home/demo",
    agent: "",
    labels: {},
    cols: 120,
    rows: 40,
  },
];

const ESC = "\u001b[";

export const FIXTURE_SCREEN = [
  `${ESC}1m firstmate${ESC}0m ${ESC}2m- preview screen with invented text${ESC}0m`,
  "",
  ` ${ESC}36m●${ESC}0m Checked 7 projects. 5 cards need you at the surface.`,
  ` ${ESC}36m●${ESC}0m atlas-api: the rate limiter plan is ready for a yes.`,
  ` ${ESC}36m●${ESC}0m ledger-sync: 212 orphaned rows, waiting on your call.`,
  ` ${ESC}32m✓${ESC}0m ledger-sync landed "Stop double-counting refunds".`,
  "",
  `${ESC}2m─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────${ESC}0m`,
  ` > `,
].join("\r\n");

export const workerScreen = (terminal: string) =>
  [
    `${ESC}1m crewmate on ${terminal}${ESC}0m ${ESC}2m- preview screen with invented text${ESC}0m`,
    "",
    ` ${ESC}36m●${ESC}0m Reading the invoice service handlers.`,
    ` ${ESC}36m●${ESC}0m Split GET routes into a read module; 14 of 22 tests pass.`,
    ` ${ESC}33m…${ESC}0m Running the remaining tests.`,
    "",
    ` > `,
  ].join("\r\n");
