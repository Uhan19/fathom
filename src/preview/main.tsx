import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { AgentKey } from "../agents";
import { ROW_ORDER, type AgentFilter, type BoardView, type Card, type CardPlace, type Column, type FileEntry, type HelperStatus, type Layout, type MoveRequest, type MoveTo, type Overlay, type Placement, type RowKey, type Settings, type ShellTab, type Terminal, type WindowChange } from "../api";
import { presetFonts } from "../appearance";
import { cellCount, groupCards, MIN_COLUMN_WIDTH, type Cells } from "../board";
import { moveTo } from "../columnOrder";
import { isMac } from "../bosun";
import { defaultShortcuts, type Shortcuts } from "../shortcuts";
import {
  FIXTURE_BACKLOG_CARDS,
  FIXTURE_BACKLOG_COLUMNS,
  FIXTURE_BACKLOG_REQUESTS,
  FIXTURE_BACKLOG_WORKERS,
  FIXTURE_CARDS,
  FIXTURE_AGENT_ADDRESS,
  FIXTURE_ATTACHABLE,
  FIXTURE_HOME,
  FIXTURE_SHELL_TABS,
  FIXTURE_UNFILED_CARDS,
  FIXTURE_UNFILED_COLUMNS,
  FIXTURE_WAITS,
  NO_FIXTURE_WAITS,
  FIXTURE_COLUMNS, FIXTURE_HELPER, FIXTURE_LATE_CARD, FIXTURE_REQUESTS, FIXTURE_SCREEN, FIXTURE_TERMINALS, FIXTURE_WORKERS,
  agentScreen,
  agentTerminal,
  backlogWorkerScreen,
  fixtureBacklogUpdates,
  fixtureDetail,
  fixtureUpdates,
  helperScreen,
  shellScreen,
  workerScreen,
} from "./fixture";
import { FIXTURE_NOTES, fixtureContext, fixtureFiles, fixtureImages, fixturePreview, fixturePrStatus } from "./detailFixture";

const params = new URLSearchParams(location.search);
const noLabel = params.has("nolabel");
const failing = params.has("error");
const empty = params.has("empty");
const backlog = params.has("backlog");
const unfiled = params.has("unfiled");
const otherClient = params.get("other")?.match(/^(\d+)x(\d+)$/);
const sendFails = params.has("sendfail");
const lateCard = params.has("late");
const deleteFails = params.has("deletefail");
const unseenUpdates = params.has("unseen");
const foldedColumns = params.get("folded")?.split(",").filter(Boolean) ?? [];
const narrowColumns = params.get("narrow")?.split(",").filter(Boolean) ?? [];
const waits = backlog || params.has("nowaits") ? NO_FIXTURE_WAITS : FIXTURE_WAITS;
const KITTY_PUSH = params.has("kitty") ? "\x1b[>1u" : "";
const rememberedAgent = (params.get("agent") as AgentKey | null) ?? null;
const missingTool = params.get("missing");
const ghSignedIn = !params.has("nogh");
const PR_STATUS_DELAY_MS = 600;
let openedAgent: AgentKey | null = rememberedAgent;
const bosun = params.get("bosun") ?? "ready";
if (params.has("linux")) Object.defineProperty(navigator, "platform", { value: "Linux x86_64" });
const mac = isMac(navigator.platform);
const customShortcuts = (): Shortcuts => ({ ...defaultShortcuts(mac), toggleChat: mac ? "Alt+Meta+KeyB" : "Ctrl+Alt+KeyB", toggleTheme: "" });
const NO_HELPER: HelperStatus = { terminal: null, status: "", asking: false };
const HELPER_STATUS: Record<string, Omit<HelperStatus, "terminal">> = {
  starting: { status: "", asking: false },
  ready: { status: "idle", asking: false },
  working: { status: "working", asking: false },
  asking: { status: "idle", asking: true },
  stopped: { status: "idle", asking: false },
};
let helperStatus: HelperStatus = bosun in HELPER_STATUS ? { terminal: FIXTURE_HELPER.address, ...HELPER_STATUS[bosun] } : NO_HELPER;
let helperShown = bosun === "stopped" ? "ready" : bosun;

const publishHelper = (next: HelperStatus) => {
  helperStatus = next;
  setTimeout(() => void emit("helper://updated", helperStatus), 0);
};

const openHelper = () => {
  if (bosun === "failed") throw { kind: "failed", message: "hc start failed: the herdr-core server is not answering" };
  settings = { ...settings, helperStarted: true };
  helperShown = bosun === "signedout" ? "signedOut" : "starting";
  publishHelper({ terminal: FIXTURE_HELPER.address, status: bosun === "signedout" ? "idle" : "", asking: false });
  return FIXTURE_HELPER;
};

const helperCheck = () =>
  bosun === "missing" ? { claude: null, signIn: null } : { claude: "/home/demo/.local/bin/claude", signIn: bosun === "signedout" ? "signedOut" : "signedIn" };

let settings: Settings = {
  home: backlog ? "" : "/home/demo/firstmate",
  terminalLabel: backlog ? "fathom.role=chat" : "firstmate.role=primary",
  hcSession: "",
  hcSocket: "",
  chatFont: presetFonts("chat")[0].key,
  chatFontSize: 13,
  boardFont: "default",
  boardFontSize: 14,
  chatAddedFonts: [],
  boardAddedFonts: [],
  agentFolder: "/home/demo",
  chatAgent: rememberedAgent,
  theme: params.get("theme") === "dark" ? "dark" : "light",
  chatOpen: !params.has("nochat"),
  chatWidth: Number(params.get("chatwidth")) || 600,
  detailWidth: Number(params.get("detailwidth")) || 460,
  projectFilter: params.get("filter")?.split(",").filter(Boolean) ?? [],
  agentFilter: (params.get("agents") as AgentFilter | null) ?? "all",
  focus: params.get("focus")?.split(",").filter(Boolean).map(Number) ?? [],
  helperStarted: bosun !== "notstarted",
  shortcuts: params.get("shortcuts") === "custom" ? customShortcuts() : defaultShortcuts(mac),
  linearWorkspace: params.has("nolinear") ? "" : "reef-co",
  ticketPrefixes: params.has("nolinear") ? [] : ["ATL", "OPS"],
};

const openChatTerminal = (agent: AgentKey) => {
  if (missingTool) throw { kind: "missing", tool: missingTool };
  settings = { ...settings, chatAgent: agent };
  openedAgent = agent;
  setTimeout(() => void emit("herdr://terminals"), 0);
  return agentTerminal(agent, agent === "firstmate" ? settings.home : settings.agentFolder);
};

const chatScreen = (terminal: string) => (terminal === FIXTURE_AGENT_ADDRESS && openedAgent ? agentScreen(openedAgent) : KITTY_PUSH + FIXTURE_SCREEN);
const INSTALLED_FONTS = ["American Typewriter", "Andale Mono", "Avenir Next", "Courier New", "Georgia", "Helvetica Neue", "Menlo", "PT Mono", "Times New Roman", "Trebuchet MS"];
let columns: Column[] = (backlog ? FIXTURE_BACKLOG_COLUMNS : unfiled ? FIXTURE_UNFILED_COLUMNS : FIXTURE_COLUMNS).map((c) => ({
  ...c,
  width: narrowColumns.includes(c.name) ? MIN_COLUMN_WIDTH : c.width,
  collapsed: foldedColumns.includes(c.name),
}));
let updates = empty ? { marks: {}, seen: {} } : (backlog ? fixtureBacklogUpdates : fixtureUpdates)(unseenUpdates);
let nextColumnId = columns.length + 1;
const rowNames = new Map<string, string>();
const collapsedRows = new Set(params.get("rows")?.split(",").filter(Boolean) ?? []);
let cards: Card[] = empty ? [] : backlog ? FIXTURE_BACKLOG_CARDS : unfiled ? FIXTURE_UNFILED_CARDS : FIXTURE_CARDS;
let places: CardPlace[] = [];
let requests: MoveRequest[] = empty ? [] : (backlog ? FIXTURE_BACKLOG_REQUESTS : FIXTURE_REQUESTS).map((r) => ({ ...r }));
const OPEN = ["sending", "asked", "failed", "answered"];
const overlay = (): Overlay => ({ places, requests: requests.filter((r) => OPEN.includes(r.status)) });

const sendRequest = (request: MoveRequest) => {
  request.status = sendFails ? "failed" : "asked";
  request.noteId = sendFails ? null : `${Date.now()}-preview`;
  request.error = sendFails ? "fm-inbox: no inbox at /home/demo/firstmate/state/inbox" : null;
  console.info("move request", request.requestId, request.status);
};

const askAgent = (request: MoveRequest, chatTerminal: string | null) => {
  request.status = "asked";
  const waiting = requests.filter((r) => r.status === "asked").length;
  const line = waiting === 1 ? "1 board request waiting" : `${waiting} board requests waiting`;
  console.info("board request", request.requestId, chatTerminal ? `nudged ${chatTerminal}: ${line}` : "waiting without a chat terminal");
};

const placeCard = (p: Placement, chatTerminal: string | null) => {
  const previous = new Map(places.map((place) => [place.cardId, place.column]));
  places = [
    ...places.filter((place) => !p.order.includes(place.cardId)),
    ...p.order.map((id, position) => ({ cardId: id, column: id === p.cardId ? p.column : (previous.get(id) ?? null), row: p.toRow, position })),
  ];
  if (p.fromRow === p.toRow) return;
  requests.filter((r) => r.cardId === p.cardId && OPEN.includes(r.status)).forEach((r) => (r.status = "superseded"));
  const request: MoveRequest = {
    requestId: `fathom-move-${p.cardId}-${Date.now()}`,
    cardId: p.cardId,
    title: p.title,
    fromRow: p.fromRow,
    toRow: p.toRow,
    createdMs: Date.now(),
    status: "sending",
    noteId: null,
    answer: null,
    error: null,
  };
  requests.push(request);
  if (cards.find((c) => c.id === p.cardId)?.row === p.toRow) request.status = "landed";
  else if (backlog) askAgent(request, chatTerminal);
  else sendRequest(request);
};

const addColumn = (name: string): Column[] => {
  const trimmed = name.trim();
  if (!trimmed) throw "a new column needs a name";
  const position = Math.max(-1, ...columns.map((c) => c.position)) + 1;
  columns = [...columns, { id: nextColumnId++, project: null, name: trimmed, position, width: 240, collapsed: false }];
  return columns;
};

const arriveLate = (column: Column) => {
  if (!lateCard || cards.some((c) => c.id === FIXTURE_LATE_CARD.id)) return;
  cards = [...cards, { ...FIXTURE_LATE_CARD, project: column.project ?? FIXTURE_LATE_CARD.project }];
  if (column.project === null) places = [...places, { cardId: FIXTURE_LATE_CARD.id, column: column.id, row: FIXTURE_LATE_CARD.row, position: 0 }];
  setTimeout(() => void emit("board://updated", view(false)), 0);
};

const cardCount = (n: number) => (n === 1 ? "1 card" : `${n} cards`);

const moveTarget = (column: Column, held: number, moveTo: MoveTo | null): number | string => {
  if (!moveTo) throw `${column.name} now holds ${cardCount(held)}; choose a column to move to`;
  if (moveTo.kind === "newColumn") {
    if (!moveTo.name.trim()) throw "a new column needs a name";
    return moveTo.name.trim();
  }
  if (moveTo.id === column.id) throw `${column.name} cannot take its own cards`;
  if (!columns.some((c) => c.id === moveTo.id)) throw "the column to move the cards to is gone";
  return moveTo.id;
};

const newColumnId = (name: string) => {
  addColumn(name);
  return nextColumnId - 1;
};

const nextPosition = (cells: Cells, column: number, row: RowKey) =>
  Math.max(-1, ...(cells.get(column)?.get(row) ?? []).map((card) => places.find((p) => p.cardId === card.id && p.row === row)?.position ?? -1)) + 1;

const deleteColumn = (id: number, moveTo: MoveTo | null): Layout => {
  const column = columns.find((c) => c.id === id);
  if (!column) return { columns, overlay: overlay() };
  arriveLate(column);
  const cells = groupCards(cards, columns, overlay());
  const held = cellCount(cells, id);
  const target = held > 0 ? moveTarget(column, held, moveTo) : null;
  if (deleteFails) throw "disk is full";
  const into = typeof target === "string" ? newColumnId(target) : target;
  if (into !== null) {
    const moved = ROW_ORDER.flatMap((row) => {
      const start = nextPosition(cells, into, row);
      return (cells.get(id)?.get(row) ?? []).map((card, i) => ({ cardId: card.id, column: into, row, position: start + i }));
    });
    places = [...places.filter((p) => !moved.some((m) => m.cardId === p.cardId)), ...moved];
  }
  places = places.map((place) => (place.column === id ? { ...place, column: null } : place));
  columns = columns.filter((c) => c.id !== id);
  return { columns, overlay: overlay() };
};

const SHELL_TABS_SHOWN = 3;
const shellEnded = params.has("shellended");
let shellTabs: ShellTab[] = FIXTURE_SHELL_TABS.slice(0, params.has("tabs") ? Number(params.get("tabs")) || SHELL_TABS_SHOWN : 0);
let runningShells: Terminal[] = [...FIXTURE_ATTACHABLE];
let nextShell = 40;
const endedShells = new Set<string>();
const columnFolders = new Map<number, string>(backlog ? [[columns[0].id, "/home/demo/charts/reef-map"]] : []);
const placeName = (folder: string) => (folder === FIXTURE_HOME ? "~" : (folder.split("/").pop() ?? folder));

const launcherFolders = () => ({
  projects: columns
    .filter((c) => backlog || c.project)
    .map((c) => ({ column: c.id, name: c.name, path: backlog ? (columnFolders.get(c.id) ?? null) : `${FIXTURE_HOME}/projects/${c.project}` })),
  home: FIXTURE_HOME,
});

const openShell = (folder: string): ShellTab => {
  const tab = { terminal: `t${nextShell++}`, name: `zsh · ${placeName(folder)}`, folder };
  shellTabs = [...shellTabs, tab];
  runningShells = [...runningShells, { ...FIXTURE_ATTACHABLE[0], address: tab.terminal, name: "", agent: "zsh", cwd: folder }];
  console.info("open_shell", tab.terminal, folder);
  return tab;
};

const attachShellTab = (terminal: string): ShellTab => {
  const found = runningShells.find((t) => t.address === terminal);
  if (!found) throw `the terminal ${terminal} is gone`;
  const tab = { terminal, name: `${found.agent || found.name || terminal} · ${placeName(found.cwd)}`, folder: found.cwd };
  shellTabs = [...shellTabs.filter((t) => t.terminal !== terminal), tab];
  return tab;
};

const shellOutput = (terminal: string) => {
  const tab = shellTabs.find((t) => t.terminal === terminal) ?? FIXTURE_SHELL_TABS[0];
  if (shellEnded && terminal === FIXTURE_SHELL_TABS[1].terminal && !endedShells.has(terminal)) {
    endedShells.add(terminal);
    setTimeout(() => void emit("terminal://ended", { view: `shell:${terminal}`, terminal }), 300);
  }
  return shellScreen(tab);
};

const view = (fromCache: boolean): BoardView => ({
  columns: empty ? [] : columns,
  rows: ROW_ORDER.map((row) => ({
    row,
    name: rowNames.get(row) ?? row[0].toUpperCase() + row.slice(1),
    collapsed: collapsedRows.has(row),
  })),
  cards,
  takenAtMs: Date.now(),
  home: settings.home,
  source: settings.home.trim() ? "firstmate" : "fathom",
  fromCache,
  error: failing && !fromCache ? "fm-tasks-axi.sh exited with status 1: error: \"backlog not found\"" : null,
  waits,
  ...overlay(),
});

type Output = { onmessage: (message: number[] | { cols: number; rows: number }) => void };
const outputs = new Map<unknown, Output>();
const bytes = (text: string) => [...new TextEncoder().encode(text)];

mockWindows("main");

let detailFiles: FileEntry[] = [];

mockIPC(
  (cmd, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "cached_board":
        return view(true);
      case "read_board":
        return view(false);
      case "log_launch":
        return 42;
      case "card_detail": {
        const detail = fixtureDetail(cards.find((c) => c.id === args.id) ?? FIXTURE_CARDS[0]);
        return { ...detail, body: FIXTURE_NOTES[detail.card.id] ?? detail.body };
      }
      case "card_context":
        return fixtureContext(args.id as string, !backlog);
      case "card_files":
        detailFiles = backlog ? [] : fixtureFiles(args.id as string, args.mentioned as string[]);
        return detailFiles;
      case "card_images":
        return backlog ? [] : fixtureImages(args.id as string);
      case "file_preview":
        return fixturePreview(args.path as string, detailFiles);
      case "open_file":
      case "reveal_file":
        console.info(cmd, args.path);
        return null;
      case "pr_status":
        return new Promise((resolve) => setTimeout(() => resolve(fixturePrStatus(args.url as string, ghSignedIn)), PR_STATUS_DELAY_MS));
      case "update_column":
        columns = columns.map((c) =>
          c.id === args.id
            ? { ...c, width: (args.width as number | null) ?? c.width, collapsed: (args.collapsed as boolean | null) ?? c.collapsed }
            : c,
        );
        return null;
      case "set_column_name":
        console.info("set_column_name", args.id, JSON.stringify(args.name));
        columns = columns.map((c) => (c.id === args.id ? { ...c, name: (args.name as string).trim() || c.project || c.name } : c));
        return null;
      case "move_column":
        columns = moveTo(columns, args.id as number, args.index as number).map((c, position) => ({ ...c, position }));
        return columns;
      case "add_column":
        return addColumn(args.name as string);
      case "delete_column":
        return deleteColumn(args.id as number, (args.moveTo as MoveTo | null) ?? null);
      case "set_row_name":
        rowNames.set(args.row as string, args.name as string);
        return null;
      case "set_rows_collapsed":
        (args.rows as RowKey[]).forEach((row) => (args.collapsed ? collapsedRows.add(row) : collapsedRows.delete(row)));
        return null;
      case "place_card":
        placeCard(args.placement as Placement, (args.chatTerminal as string | null) ?? null);
        return overlay();
      case "resend_request": {
        const request = requests.find((r) => r.requestId === args.requestId);
        if (request?.status === "failed") sendRequest(request);
        return overlay();
      }
      case "dismiss_request":
        requests = requests.map((r) => (r.requestId === args.requestId ? { ...r, status: "dismissed" } : r));
        return overlay();
      case "workers":
        return empty ? [] : backlog ? FIXTURE_BACKLOG_WORKERS : FIXTURE_WORKERS;
      case "card_updates":
        return updates;
      case "mark_seen":
        console.info("mark_seen", args.cardId, args.mark);
        updates = { ...updates, seen: { ...updates.seen, [args.cardId as string]: args.mark as string } };
        setTimeout(() => void emit("updates://updated", updates), 0);
        return null;
      case "get_settings":
        return settings;
      case "save_settings":
        settings = args.settings as Settings;
        return settings;
      case "change_window":
        settings = { ...settings, ...(args.change as WindowChange) };
        return settings;
      case "show_all_projects":
        settings = { ...settings, projectFilter: [] };
        return settings;
      case "set_agent_filter":
        settings = { ...settings, agentFilter: args.filter as AgentFilter };
        return settings;
      case "clear_focus":
        settings = { ...settings, focus: [] };
        return settings;
      case "find_helper":
        return helperStatus.terminal ? FIXTURE_HELPER : null;
      case "helper_status":
        return helperStatus;
      case "helper_check":
        return helperCheck();
      case "open_helper":
        return openHelper();
      case "stop_helper":
        console.info("stop_helper", args.terminal);
        publishHelper(NO_HELPER);
        return null;
      case "data_info":
        return { path: "/home/demo/Library/Application Support/app.fathom.board.dev/fathom.sqlite", bytes: 49152 };
      case "installed_fonts":
        return INSTALLED_FONTS;
      case "plugin:clipboard-manager|write_text":
        console.info("clipboard", JSON.stringify(args.text));
        return null;
      case "export_data":
        return `${args.directory}/fathom-export-1763400000000`;
      case "terminal_input":
        console.info("terminal_input", args.view, JSON.stringify(args.data));
        if (!(args.data as string).includes("\x1b")) outputs.get(args.view)?.onmessage(bytes((args.data as string).replace(/\r/g, "\r\n")));
        return null;
      case "resize_terminal":
        console.info("resize_terminal", args.view, args.cols, args.rows);
        return null;
      case "detach_terminal":
        console.info("detach_terminal", args.view);
        outputs.delete(args.view);
        return null;
      case "open_link":
        return null;
      case "send_to_terminal":
        console.info("send_to_terminal", args.terminal, args.text);
        return null;
      case "herdr_status":
        return { connected: true, message: "" };
      case "find_chat_terminal":
        if (noLabel) return null;
        return rememberedAgent ? agentTerminal(rememberedAgent, rememberedAgent === "firstmate" ? settings.home : settings.agentFolder) : FIXTURE_TERMINALS[0];
      case "open_chat_terminal":
        return openChatTerminal(args.agent as AgentKey);
      case "list_terminals":
        return FIXTURE_TERMINALS;
      case "attach_terminal": {
        const output = args.output as Output;
        outputs.set(args.view, output);
        const screen = String(args.view).startsWith("shell:")
          ? shellOutput(args.terminal as string)
          : args.view === "worker" || args.view === "agent"
            ? (backlog ? backlogWorkerScreen : workerScreen)(args.terminal as string)
            : args.view === "helper"
              ? helperScreen(helperShown)
              : chatScreen(args.terminal as string);
        if (args.view === "helper" && bosun === "stopped") {
          setTimeout(() => {
            publishHelper(NO_HELPER);
            void emit("terminal://ended", { view: "helper", terminal: FIXTURE_HELPER.address });
          }, 300);
        }
        console.info("attach_terminal", args.view, args.terminal, args.cols, args.rows);
        setTimeout(() => output.onmessage(bytes(screen)), 50);
        if (otherClient && args.view === "chat") {
          const [cols, rows] = [Number(otherClient[1]), Number(otherClient[2])];
          setTimeout(() => output.onmessage({ cols, rows }), 300);
        }
        return { terminal: args.terminal, cols: args.cols, rows: args.rows };
      }
      case "plugin:dialog|open":
        return "/home/demo/exports";
      case "shell_tabs":
        return shellTabs;
      case "open_shell":
        return openShell(args.folder as string);
      case "attach_shell_tab":
        return attachShellTab(args.terminal as string);
      case "close_shell_tab":
        console.info("close_shell_tab", args.terminal);
        shellTabs = shellTabs.filter((t) => t.terminal !== args.terminal);
        outputs.delete(`shell:${args.terminal}`);
        return null;
      case "attachable_terminals":
        return runningShells;
      case "launcher_folders":
        return launcherFolders();
      case "remember_column_folder":
        columnFolders.set(args.column as number, args.folder as string);
        return null;
      default:
        throw new Error(`preview has no mock for ${cmd}`);
    }
  },
  { shouldMockEvents: true },
);

const previewFeed = (view: string, text: string) => outputs.get(view)?.onmessage(bytes(text));

Object.assign(window, { previewEmit: emit, previewFeed });

await import("../main");

const pressLauncher = () => {
  const add = document.querySelector<HTMLButtonElement>(".tab-add");
  if (add) add.click();
  else setTimeout(pressLauncher, 50);
};
if (params.has("launcher")) setTimeout(pressLauncher, 400);

const openShortcuts = () => {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".btn-header")].find((b) => b.textContent === "Settings" && !b.disabled);
  if (!button) return setTimeout(openShortcuts, 50);
  button.click();
  setTimeout(() => document.querySelector(".shortcuts")?.closest("fieldset")?.scrollIntoView({ block: "start" }), 50);
};
if (params.has("settings")) setTimeout(openShortcuts, 400);
