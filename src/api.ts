import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { AgentKey } from "./agents";
import type { Shortcuts } from "./shortcuts";
import type { Theme } from "./theme";
import type { ActiveTheme, ThemeList } from "./themes/contract";
import type { CardUpdates } from "./updates";

export type RowKey = "surface" | "shallows" | "deep" | "seabed" | "landed";

export const ROW_ORDER: RowKey[] = ["surface", "shallows", "deep", "seabed", "landed"];

export interface Link {
  kind: string;
  target: string;
}

export interface Card {
  id: string;
  title: string;
  state: string;
  kind: string;
  project: string;
  row: RowKey;
  holdKind: string;
  holdUntil: string;
  holdReason: string;
  blockedBy: string[];
  links: Link[];
  closed: string;
  number: number | null;
}

export interface Detail {
  card: Card;
  body: string;
  created: string;
  priority: string;
  deps: string[];
}

export interface StatusEntry {
  state: string;
  atMs: number | null;
  key: string | null;
  text: string;
}

export interface CardContext {
  hasHome: boolean;
  recordedPr: string | null;
  activity: StatusEntry[];
  taskFolder: string | null;
}

export type PreviewKind = "markdown" | "text" | "image" | "html" | "none";

export interface FileEntry {
  path: string;
  name: string;
  folder: string;
  kind: "file" | "folder";
  preview: PreviewKind;
  size: number | null;
  modifiedMs: number | null;
  inTaskFolder: boolean;
  mentions: string[];
}

export interface FilePreview {
  kind: PreviewKind;
  text: string | null;
  dataUrl: string | null;
  truncated: boolean;
  size: number;
}

export type PrState = "open" | "draft" | "merged" | "closed" | "unknown";
export type Checks = "passing" | "failing" | "running" | "none" | "unknown";

export type ReviewState = "approved" | "changesRequested" | "commented" | "dismissed";
export type ReviewDecision = "approved" | "changesRequested" | "reviewRequired";

export interface Review {
  login: string;
  state: ReviewState;
}

export interface PrStatus {
  url: string;
  state: PrState;
  checks: Checks;
  title: string | null;
  note: string | null;
  reviewDecision: ReviewDecision | null;
  requested: string[];
  reviews: Review[];
}

export const unknownPrStatus = (url: string, note: string | null): PrStatus => ({
  url,
  state: "unknown",
  checks: "unknown",
  title: null,
  note,
  reviewDecision: null,
  requested: [],
  reviews: [],
});

export type WaitKind = "pr-review" | "slack-reply" | "email-reply" | "other";
export type Need = "all" | "any" | number;

export interface Wait {
  kind: WaitKind;
  what: string;
  who: string[];
  need: Need;
  since: string | null;
  link: string | null;
  state: Record<string, string>;
}

export interface Person {
  github: string | null;
}

export interface Waits {
  tasks: Record<string, Wait[]>;
  people: Record<string, Person>;
}

export interface Column {
  id: number;
  project: string | null;
  name: string;
  position: number;
  width: number;
  collapsed: boolean;
}

export interface RowView {
  row: RowKey;
  name: string;
  collapsed: boolean;
}

export type MoveStatus = "sending" | "asked" | "failed" | "answered" | "landed" | "superseded" | "dismissed";

export interface CardPlace {
  cardId: string;
  column: number | null;
  row: RowKey;
  position: number;
}

export interface MoveRequest {
  requestId: string;
  cardId: string;
  title: string;
  fromRow: RowKey;
  toRow: RowKey;
  createdMs: number;
  status: MoveStatus;
  noteId: string | null;
  answer: string | null;
  error: string | null;
}

export interface Overlay {
  places: CardPlace[];
  requests: MoveRequest[];
}

export interface Layout {
  columns: Column[];
  overlay: Overlay;
}

export type MoveTo = { kind: "column"; id: number } | { kind: "newColumn"; name: string };

export interface Placement {
  cardId: string;
  title: string;
  column: number;
  fromRow: RowKey;
  toRow: RowKey;
  order: string[];
}

export type WorkerStatus = "working" | "idle";

export interface Worker {
  taskId: string;
  terminal: string;
  status: WorkerStatus;
}

export type SourceKind = "firstmate" | "fathom";

export type AgentFilter = "all" | "withAgent" | "withActiveAgent";

export interface BoardView extends Overlay {
  columns: Column[];
  rows: RowView[];
  cards: Card[];
  takenAtMs: number | null;
  home: string;
  source: SourceKind;
  fromCache: boolean;
  error: string | null;
  waits: Waits;
}

export interface Settings {
  home: string;
  terminalLabel: string;
  hcSession: string;
  hcSocket: string;
  chatFont: string;
  chatFontSize: number;
  boardFont: string;
  boardFontSize: number;
  chatAddedFonts: string[];
  boardAddedFonts: string[];
  agentFolder: string;
  chatAgent: AgentKey | null;
  theme: Theme;
  themeId: string;
  chatOpen: boolean;
  chatWidth: number;
  detailWidth: number;
  projectFilter: string[];
  agentFilter: AgentFilter;
  focus: number[];
  helperStarted: boolean;
  shortcuts: Shortcuts;
  linearWorkspace: string;
  ticketPrefixes: string[];
  memoryBadgeMb: number;
  view: Tab;
}

export type Tab = "board" | "dashboard";

export type Pressure = "normal" | "warning" | "critical";
export type GroupKind = "fathom" | "orchestrator" | "worker" | "docker";

export interface MemoryPart {
  label: string;
  bytes: number;
  processes: number;
}

export interface MemoryGroup {
  kind: GroupKind;
  id: string;
  name: string;
  taskId: string | null;
  terminal: string | null;
  bytes: number;
  parts: MemoryPart[];
}

export interface MemorySample {
  takenAtMs: number;
  total: number;
  used: number;
  available: number;
  pressure: Pressure | null;
  activityMonitor: boolean;
  herdrConnected: boolean;
  groups: MemoryGroup[];
  rest: { bytes: number; apps: { name: string; bytes: number }[] };
}

export interface MetricsDemand {
  dashboard: boolean;
  badges: boolean;
}

export interface WindowChange {
  theme?: Theme;
  themeId?: string;
  chatOpen?: boolean;
  chatWidth?: number;
  detailWidth?: number;
  view?: Tab;
}

export type SignIn = "signedIn" | "signedOut" | "unknown";

export interface HelperStatus {
  terminal: string | null;
  status: string;
  asking: boolean;
}

export interface HelperCheck {
  claude: string | null;
  signIn: SignIn | null;
}

export interface Terminal {
  address: string;
  name: string;
  title: string;
  state: string;
  cwd: string;
  agent: string;
  labels: Record<string, string>;
  cols: number;
  rows: number;
}

export interface Size {
  cols: number;
  rows: number;
}

export type View = "chat" | "worker" | "agent" | "helper" | `shell:${string}`;

export interface ShellTab {
  terminal: string;
  name: string;
  folder: string;
}

export interface ProjectFolder {
  column: number;
  name: string;
  path: string | null;
}

export interface LauncherFolders {
  projects: ProjectFolder[];
  home: string;
}

export interface AttachedSize extends Size {
  terminal: string;
}

export interface EndedView {
  view: View;
  terminal: string;
}

export interface HerdrStatus {
  connected: boolean;
  message: string;
}

export interface DataInfo {
  path: string;
  bytes: number;
}

export const api = {
  cachedBoard: () => invoke<BoardView>("cached_board"),
  readBoard: () => invoke<BoardView>("read_board"),
  logLaunch: (source: string, cards: number) => invoke<number | null>("log_launch", { source, cards }),
  cardDetail: (id: string) => invoke<Detail>("card_detail", { id }),
  cardContext: (id: string) => invoke<CardContext>("card_context", { id }),
  cardFiles: (id: string, mentioned: string[]) => invoke<FileEntry[]>("card_files", { id, mentioned }),
  cardImages: (id: string) => invoke<FileEntry[]>("card_images", { id }),
  filePreview: (path: string) => invoke<FilePreview>("file_preview", { path }),
  openFile: (path: string) => invoke<void>("open_file", { path }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  prStatus: (url: string) => invoke<PrStatus>("pr_status", { url }),
  updateColumn: (id: number, change: { width?: number; collapsed?: boolean }) =>
    invoke<void>("update_column", { id, width: change.width ?? null, collapsed: change.collapsed ?? null }),
  setColumnName: (id: number, name: string) => invoke<void>("set_column_name", { id, name }),
  moveColumn: (id: number, index: number) => invoke<Column[]>("move_column", { id, index }),
  addColumn: (name: string) => invoke<Column[]>("add_column", { name }),
  deleteColumn: (id: number, moveTo?: MoveTo) => invoke<Layout>("delete_column", { id, moveTo: moveTo ?? null }),
  setRowName: (row: RowKey, name: string) => invoke<void>("set_row_name", { row, name }),
  setRowsCollapsed: (rows: RowKey[], collapsed: boolean) => invoke<void>("set_rows_collapsed", { rows, collapsed }),
  placeCard: (placement: Placement, chatTerminal: string | null) =>
    invoke<Overlay>("place_card", { placement, chatTerminal }),
  resendRequest: (requestId: string) => invoke<Overlay>("resend_request", { requestId }),
  dismissRequest: (requestId: string) => invoke<Overlay>("dismiss_request", { requestId }),
  workers: () => invoke<Worker[]>("workers"),
  cardUpdates: () => invoke<CardUpdates>("card_updates"),
  markSeen: (cardId: string, mark: string) => invoke<void>("mark_seen", { cardId, mark }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  changeWindow: (change: WindowChange) => invoke<Settings>("change_window", { change }),
  activeTheme: (id?: string) => invoke<ActiveTheme | null>("active_theme", { id: id ?? null }),
  listThemes: () => invoke<ThemeList>("list_themes"),
  duplicateNautical: (name: string) => invoke<string>("duplicate_nautical", { name }),
  revealThemes: () => invoke<null>("reveal_themes_folder"),
  showAllProjects: () => invoke<Settings>("show_all_projects"),
  clearFocus: () => invoke<Settings>("clear_focus"),
  setAgentFilter: (filter: AgentFilter) => invoke<Settings>("set_agent_filter", { filter }),
  dataInfo: () => invoke<DataInfo>("data_info"),
  appVersion: () => getVersion(),
  installedFonts: () => invoke<string[]>("installed_fonts"),
  exportData: (directory: string) => invoke<string>("export_data", { directory }),
  openLink: (target: string) => invoke<void>("open_link", { target }),
  herdrStatus: () => invoke<HerdrStatus>("herdr_status"),
  findChatTerminal: () => invoke<Terminal | null>("find_chat_terminal"),
  listTerminals: () => invoke<Terminal[]>("list_terminals"),
  openChatTerminal: (agent: AgentKey) => invoke<Terminal>("open_chat_terminal", { agent }),
  findHelper: () => invoke<Terminal | null>("find_helper"),
  helperCheck: () => invoke<HelperCheck>("helper_check"),
  helperStatus: () => invoke<HelperStatus>("helper_status"),
  openHelper: () => invoke<Terminal>("open_helper"),
  stopHelper: (terminal: string) => invoke<void>("stop_helper", { terminal }),
  attachTerminal: (view: View, terminal: string, size: Size, onOutput: (bytes: Uint8Array) => void, onSize: (size: Size) => void) => {
    const output = new Channel<ArrayBuffer | number[] | Size>((message) => {
      if (message instanceof ArrayBuffer) onOutput(new Uint8Array(message));
      else if (Array.isArray(message)) onOutput(Uint8Array.from(message));
      else onSize(message);
    });
    return invoke<AttachedSize>("attach_terminal", { view, terminal, cols: size.cols, rows: size.rows, output });
  },
  resizeTerminal: (view: View, size: Size) => invoke<void>("resize_terminal", { view, cols: size.cols, rows: size.rows }),
  terminalInput: (view: View, data: string) => invoke<void>("terminal_input", { view, data }),
  detachTerminal: (view: View) => invoke<void>("detach_terminal", { view }),
  sendToTerminal: (terminal: string, text: string) => invoke<void>("send_to_terminal", { terminal, text }),
  shellTabs: () => invoke<ShellTab[]>("shell_tabs"),
  openShell: (folder: string) => invoke<ShellTab>("open_shell", { folder }),
  attachShellTab: (terminal: string) => invoke<ShellTab>("attach_shell_tab", { terminal }),
  closeShellTab: (terminal: string) => invoke<void>("close_shell_tab", { terminal }),
  attachableTerminals: () => invoke<Terminal[]>("attachable_terminals"),
  launcherFolders: () => invoke<LauncherFolders>("launcher_folders"),
  setMetricsDemand: (demand: MetricsDemand) => invoke<void>("set_metrics_demand", { demand }),
  memorySample: () => invoke<MemorySample>("memory_sample"),
  rememberColumnFolder: (column: number, folder: string) => invoke<void>("remember_column_folder", { column, folder }),
};

export const events = {
  board: (handler: (view: BoardView) => void): Promise<UnlistenFn> =>
    listen<BoardView>("board://updated", (e) => handler(e.payload)),
  herdr: (handler: (status: HerdrStatus) => void): Promise<UnlistenFn> =>
    listen<HerdrStatus>("herdr://status", (e) => handler(e.payload)),
  terminals: (handler: () => void): Promise<UnlistenFn> => listen("herdr://terminals", () => handler()),
  workers: (handler: (workers: Worker[]) => void): Promise<UnlistenFn> =>
    listen<Worker[]>("workers://updated", (e) => handler(e.payload)),
  updates: (handler: (updates: CardUpdates) => void): Promise<UnlistenFn> =>
    listen<CardUpdates>("updates://updated", (e) => handler(e.payload)),
  settings: (handler: (settings: Settings) => void): Promise<UnlistenFn> =>
    listen<Settings>("settings://updated", (e) => handler(e.payload)),
  themes: (handler: () => void): Promise<UnlistenFn> => listen("themes://updated", () => handler()),
  memory: (handler: (sample: MemorySample) => void): Promise<UnlistenFn> =>
    listen<MemorySample>("metrics://memory", (e) => handler(e.payload)),
  helper: (handler: (helper: HelperStatus) => void): Promise<UnlistenFn> =>
    listen<HelperStatus>("helper://updated", (e) => handler(e.payload)),
  terminalEnded: (handler: (ended: EndedView) => void): Promise<UnlistenFn> =>
    listen<EndedView>("terminal://ended", (e) => handler(e.payload)),
  // wry reports macOS drop positions in points, which are CSS pixels here.
  fileDrop: (handler: (paths: string[], at: { x: number; y: number }) => void): Promise<UnlistenFn> =>
    getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") handler(e.payload.paths, { x: e.payload.position.x, y: e.payload.position.y });
    }),
};

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
