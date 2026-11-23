import { AGENTS, type AgentKey } from "../agents";
import type { Card, Column, Detail, MoveRequest, RowKey, ShellTab, Terminal, Waits, Worker } from "../api";
import type { CardUpdates } from "../updates";

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
  ["led-44", "ledger-sync", "surface", "Decide what to do with orphaned ledger rows", { holdKind: "captain", holdReason: "There are 212 rows with no account. Options: (a) delete them; (b) archive them to cold storage (recommended); (c) keep them and flag them in the report." }],
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
  ["lan-33", "lantern-docs", "seabed", "Move the docs site to the new domain", { holdKind: "external", holdReason: "Waiting for the registrar to confirm the transfer." }],
];

const FIRST_NUMBER = 40;
const FIRST_BACKLOG_NUMBER = 12;

const seeded = ([id, project, row, title, extra]: Seed, number: number): Card => ({
  id,
  number,
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

export const FIXTURE_CARDS: Card[] = SEEDS.map((seed, i) => seeded(seed, FIRST_NUMBER + i));

const nextNumber = FIRST_NUMBER + SEEDS.length;

export const FIXTURE_LATE_CARD: Card = seeded(["kel-09", "keel-cli", "shallows", "Add a --quiet flag for scripts", { state: "in_flight" }], nextNumber);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const FIXTURE_WAITS: Waits = {
  tasks: {
    "hrb-17": [
      {
        kind: "pr-review",
        what: "Re-review of the keyboard focus order",
        who: ["Mira", "Tomas", "Priya"],
        need: 2,
        since: ago(3 * DAY),
        link: "https://github.com/example/harbor-web/pull/241",
        state: {},
      },
      {
        kind: "slack-reply",
        what: "Screen reader check of the sidebar",
        who: ["Tomas"],
        need: "all",
        since: ago(3 * DAY),
        link: "https://reef-co.slack.com/archives/C04WEB02/p1795100000000100?thread_ts=1795100000.000100",
        state: { Tomas: "asked" },
      },
    ],
    "atl-09": [
      {
        kind: "pr-review",
        what: "Review of the read path split",
        who: ["Sana", "Ollie"],
        need: "any",
        since: ago(4 * DAY),
        link: "https://github.com/example/atlas-api/pull/427",
        state: {},
      },
    ],
    "pil-08": [
      {
        kind: "slack-reply",
        what: "Which night suits the production certificate swap",
        who: ["Mira"],
        need: "all",
        since: ago(HOUR),
        link: "https://reef-co.slack.com/archives/C04OPS01/p1795103600000200?thread_ts=1795103600.000200",
        state: { Mira: "asked" },
      },
    ],
    "lan-33": [
      {
        kind: "email-reply",
        what: "Confirmation of the domain transfer",
        who: [],
        need: "all",
        since: ago(5 * DAY),
        link: null,
        state: {},
      },
    ],
  },
  people: {
    Mira: { github: "mira-k" },
    Tomas: { github: "tomas-r" },
    Priya: { github: "priya-s" },
    Sana: { github: "sana-p" },
    Ollie: { github: "ollie-w" },
  },
};

export const NO_FIXTURE_WAITS: Waits = { tasks: {}, people: {} };

export const FIXTURE_WORKERS: Worker[] = [
  { taskId: "atl-09", terminal: "t3", status: "working" },
  { taskId: "hrb-18", terminal: "t4", status: "idle" },
  { taskId: "hrb-16", terminal: "t5", status: "working" },
  { taskId: "pil-08", terminal: "t6", status: "idle" },
];

const FIXTURE_UPDATE_MARKS: Record<string, string> = {
  "atl-09": "3 working [at=1795100000]: read and write paths split, running the invoice tests",
  "atl-15": "2 needs-decision [at=1795100900]: canary plan updated with a rollback step, still needs your yes",
  "atl-04": "2 paused [at=1795100700]: the queue migration slipped a week, waiting until it lands",
  "hrb-18": "4 needs-decision [at=1795100400]: the form kit has no date picker; keep the old one or wait for the kit?",
  "lan-31": "2 working [at=1795100600]: first draft of the v3 guide is up for review",
  "pil-08": "3 done [at=1795100800]: staging certificates rotated, PR ready",
  "led-37": "2 done [at=1795090000]: report written",
};

const FIXTURE_SEEN_MARKS: Record<string, string> = {
  "atl-09": FIXTURE_UPDATE_MARKS["atl-09"],
  "lan-31": "1 working [at=1795090400]: setup done",
  "atl-04": "1 paused [at=1795090200]: waiting for the queue migration",
  "atl-15": "1 needs-decision [at=1795090300]: plan ready, needs your yes",
  "led-37": FIXTURE_UPDATE_MARKS["led-37"],
};

export const fixtureUpdates = (unseen: boolean): CardUpdates => ({
  marks: { ...FIXTURE_UPDATE_MARKS },
  seen: { ...(unseen ? FIXTURE_SEEN_MARKS : FIXTURE_UPDATE_MARKS) },
});

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

export const FIXTURE_UNFILED_CARDS: Card[] = [
  ...FIXTURE_CARDS,
  seeded(["gen-02", "", "shallows", "Tidy the shared notes folder", { state: "in_flight" }], nextNumber + 1),
  seeded(["gen-01", "", "deep", "Sort the inbox of half-written ideas", { holdKind: "parked" }], nextNumber + 2),
];

export const FIXTURE_UNFILED_COLUMNS: Column[] = columnsFor(FIXTURE_UNFILED_CARDS);

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
  seeded([String(id), project, row, title, { kind: "task", state: row === "landed" ? "done" : "open", closed: row === "landed" ? "2026-11-16" : "" }], FIRST_BACKLOG_NUMBER + id - 1),
);

export const FIXTURE_BACKLOG_COLUMNS: Column[] = columnsFor(FIXTURE_BACKLOG_CARDS);

export const fixtureBacklogUpdates = (unseen: boolean): CardUpdates => ({
  marks: { "2": "1795100000000", "9": "1795090000000" },
  seen: unseen ? { "9": "1795090000000" } : { "2": "1795100000000", "9": "1795090000000" },
});

export const FIXTURE_BACKLOG_WORKERS: Worker[] = [
  { taskId: "2", terminal: "t3", status: "working" },
  { taskId: "5", terminal: "t4", status: "idle" },
];

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

const BACKLOG_WORKER_LINES: Record<string, string[]> = {
  "2": [
    ` ${ESC}36m●${ESC}0m Read task 2 and moved it to shallows.`,
    ` ${ESC}36m●${ESC}0m Plotted 41 of 58 soundings on the north reef grid.`,
    ` ${ESC}36m●${ESC}0m Added progress to the task detail.`,
    ` ${ESC}33m…${ESC}0m Checking the depth contours against last season's chart.`,
  ],
  "5": [
    ` ${ESC}36m●${ESC}0m Read task 5 and moved it to shallows.`,
    ` ${ESC}36m●${ESC}0m Found the hour shift: the table adds the offset twice in the changeover week.`,
    ` ${ESC}32m✓${ESC}0m Fixed it and added the finding to the task detail.`,
  ],
};

export const backlogWorkerScreen = (terminal: string) => {
  const taskId = FIXTURE_BACKLOG_WORKERS.find((w) => w.terminal === terminal)?.taskId ?? "";
  return [
    `${ESC}1m worker on ${terminal}${ESC}0m ${ESC}2m- preview screen with invented text${ESC}0m`,
    "",
    ...(BACKLOG_WORKER_LINES[taskId] ?? []),
    "",
    ` > `,
  ].join("\r\n");
};

export const FIXTURE_AGENT_ADDRESS = "t7";

export const agentTerminal = (agent: AgentKey, cwd: string): Terminal => ({
  address: FIXTURE_AGENT_ADDRESS,
  name: "",
  title: "",
  state: "live",
  cwd,
  agent: AGENTS[agent].program,
  labels: { "fathom.role": "chat", "fathom.agent": agent },
  cols: 120,
  rows: 40,
});

export const agentScreen = (agent: AgentKey) =>
  [
    `${ESC}1m ${AGENTS[agent].name}${ESC}0m ${ESC}2m- preview screen with invented text${ESC}0m`,
    "",
    ` ${ESC}36m●${ESC}0m Ready for your first message.`,
    "",
    ` > `,
  ].join("\r\n");

export const FIXTURE_HELPER: Terminal = {
  address: "t9",
  name: "",
  title: "",
  state: "live",
  cwd: "/home/demo/.local/share/app.fathom.board/bosun",
  agent: "claude",
  labels: { "fathom.role": "helper" },
  cols: 120,
  rows: 16,
};

const HELPER_SCREENS: Record<string, string[]> = {
  starting: [
    ` ${ESC}1mDo you trust the files in this folder?${ESC}0m ${ESC}2m- preview screen with invented text${ESC}0m`,
    "",
    ` ${FIXTURE_HELPER.cwd}`,
    "",
    ` ${ESC}36m❯ 1. Yes, proceed${ESC}0m`,
    "   2. No, exit",
  ],
  signedOut: [
    ` ${ESC}1mSelect login method:${ESC}0m ${ESC}2m- preview screen with invented text${ESC}0m`,
    "",
    ` ${ESC}36m❯ 1. Claude account with subscription${ESC}0m`,
    "   2. Anthropic Console account",
  ],
  ready: [
    ` ${ESC}1mBosun${ESC}0m ${ESC}2m- preview screen with invented text${ESC}0m`,
    "",
    ` > show me only the harbor-web tasks`,
    ` ${ESC}36m●${ESC}0m fathom - show_projects (projects: ["harbor-web"])`,
    ` ${ESC}32m✓${ESC}0m Only harbor-web shows now. Show all brings the rest back.`,
    "",
    ` > `,
  ],
  working: [
    ` ${ESC}1mBosun${ESC}0m ${ESC}2m- preview screen with invented text${ESC}0m`,
    "",
    ` > collapse every column except atlas-api`,
    ` ${ESC}36m●${ESC}0m fathom - get_board_layout`,
    ` ${ESC}33m✻${ESC}0m Collapsing 6 columns…`,
  ],
  asking: [
    ` ${ESC}1mBosun${ESC}0m ${ESC}2m- preview screen with invented text${ESC}0m`,
    "",
    ` > drop the scratch column into keel-cli`,
    ` ${ESC}1mTool use${ESC}0m  fathom - delete_column (id: 8, move_to_column: 3)`,
    ` Do you want to proceed?`,
    ` ${ESC}36m❯ 1. Yes${ESC}0m`,
    "   2. No, and tell Claude what to do differently",
  ],
};

export const helperScreen = (state: string) => (HELPER_SCREENS[state] ?? HELPER_SCREENS.ready).join("\r\n");

export const FIXTURE_HOME = "/home/demo";

export const FIXTURE_SHELL_TABS: ShellTab[] = [
  { terminal: "t11", name: "zsh · atlas-api", folder: "/home/demo/projects/atlas-api" },
  { terminal: "t12", name: "zsh · ~", folder: "/home/demo" },
  { terminal: "t13", name: "npm · harbor-web", folder: "/home/demo/projects/harbor-web" },
  { terminal: "t16", name: "zsh · ledger-sync", folder: "/home/demo/projects/ledger-sync" },
  { terminal: "t17", name: "codex · keel-cli", folder: "/home/demo/projects/keel-cli" },
  { terminal: "t18", name: "zsh · lantern-docs", folder: "/home/demo/projects/lantern-docs" },
];

const running = (address: string, agent: string, name: string, cwd: string): Terminal => ({
  address,
  name,
  title: name || agent,
  state: "live",
  cwd,
  agent,
  labels: {},
  cols: 120,
  rows: 40,
});

export const FIXTURE_ATTACHABLE: Terminal[] = [
  running("t2", "zsh", "scratch", "/home/demo"),
  running("t14", "codex", "", "/home/demo/projects/keel-cli"),
  running("t15", "tail", "", "/home/demo/projects/atlas-api/logs"),
];

export const shellScreen = (tab: ShellTab) => {
  const place = tab.folder === FIXTURE_HOME ? "~" : tab.folder.split("/").pop();
  const prompt = `${ESC}97;44m  ${ESC}34;46m${ESC}30m ${place}  09:41 ${ESC}0;36m${ESC}0m `;
  return [
    `${prompt}git status --short`,
    ` M src/handlers/invoice.ts`,
    `?? notes/retry-budget.md`,
    `${prompt}ls`,
    `README.md  notes  package.json  src  tests`,
    prompt,
  ].join("\r\n");
};
