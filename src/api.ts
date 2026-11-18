import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

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
}

export interface Detail {
  card: Card;
  body: string;
  created: string;
  priority: string;
  deps: string[];
}

export interface Column {
  id: number;
  project: string | null;
  name: string;
  position: number;
  width: number;
  collapsed: boolean;
}

export interface RowName {
  row: RowKey;
  name: string;
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

export interface BoardView extends Overlay {
  columns: Column[];
  rowNames: RowName[];
  cards: Card[];
  takenAtMs: number | null;
  home: string;
  source: SourceKind;
  fromCache: boolean;
  error: string | null;
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

export type View = "chat" | "worker";

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
  updateColumn: (id: number, change: { width?: number; collapsed?: boolean }) =>
    invoke<void>("update_column", { id, width: change.width ?? null, collapsed: change.collapsed ?? null }),
  setColumnName: (id: number, name: string) => invoke<void>("set_column_name", { id, name }),
  moveColumn: (id: number, index: number) => invoke<Column[]>("move_column", { id, index }),
  addColumn: (name: string) => invoke<Column[]>("add_column", { name }),
  deleteColumn: (id: number, moveTo?: MoveTo) => invoke<Layout>("delete_column", { id, moveTo: moveTo ?? null }),
  setRowName: (row: RowKey, name: string) => invoke<void>("set_row_name", { row, name }),
  placeCard: (placement: Placement, chatTerminal: string | null) =>
    invoke<Overlay>("place_card", { placement, chatTerminal }),
  resendRequest: (requestId: string) => invoke<Overlay>("resend_request", { requestId }),
  dismissRequest: (requestId: string) => invoke<Overlay>("dismiss_request", { requestId }),
  workers: () => invoke<Worker[]>("workers"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  dataInfo: () => invoke<DataInfo>("data_info"),
  installedFonts: () => invoke<string[]>("installed_fonts"),
  exportData: (directory: string) => invoke<string>("export_data", { directory }),
  openLink: (target: string) => invoke<void>("open_link", { target }),
  herdrStatus: () => invoke<HerdrStatus>("herdr_status"),
  findChatTerminal: () => invoke<Terminal | null>("find_chat_terminal"),
  listTerminals: () => invoke<Terminal[]>("list_terminals"),
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
};

export const events = {
  board: (handler: (view: BoardView) => void): Promise<UnlistenFn> =>
    listen<BoardView>("board://updated", (e) => handler(e.payload)),
  herdr: (handler: (status: HerdrStatus) => void): Promise<UnlistenFn> =>
    listen<HerdrStatus>("herdr://status", (e) => handler(e.payload)),
  terminals: (handler: () => void): Promise<UnlistenFn> => listen("herdr://terminals", () => handler()),
  workers: (handler: (workers: Worker[]) => void): Promise<UnlistenFn> =>
    listen<Worker[]>("workers://updated", (e) => handler(e.payload)),
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
