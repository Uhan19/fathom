import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
  project: string;
  name: string;
  position: number;
  width: number;
  collapsed: boolean;
}

export interface RowName {
  row: RowKey;
  name: string;
}

export interface BoardView {
  columns: Column[];
  rowNames: RowName[];
  cards: Card[];
  takenAtMs: number | null;
  home: string;
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

export interface ChatSize extends Size {
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
  updateColumn: (project: string, change: { width?: number; collapsed?: boolean }) =>
    invoke<void>("update_column", { project, width: change.width ?? null, collapsed: change.collapsed ?? null }),
  setRowName: (row: RowKey, name: string) => invoke<void>("set_row_name", { row, name }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  dataInfo: () => invoke<DataInfo>("data_info"),
  exportData: (directory: string) => invoke<string>("export_data", { directory }),
  openLink: (target: string) => invoke<void>("open_link", { target }),
  herdrStatus: () => invoke<HerdrStatus>("herdr_status"),
  findChatTerminal: () => invoke<Terminal | null>("find_chat_terminal"),
  listTerminals: () => invoke<Terminal[]>("list_terminals"),
  attachChat: (terminal: string, size: Size, onOutput: (bytes: Uint8Array) => void, onSize: (size: Size) => void) => {
    const output = new Channel<ArrayBuffer | number[] | Size>((message) => {
      if (message instanceof ArrayBuffer) onOutput(new Uint8Array(message));
      else if (Array.isArray(message)) onOutput(Uint8Array.from(message));
      else onSize(message);
    });
    return invoke<ChatSize>("attach_chat", { terminal, cols: size.cols, rows: size.rows, output });
  },
  resizeChat: (size: Size) => invoke<void>("resize_chat", { cols: size.cols, rows: size.rows }),
  chatInput: (data: string) => invoke<void>("chat_input", { data }),
  detachChat: () => invoke<void>("detach_chat"),
  sendToTerminal: (terminal: string, text: string) => invoke<void>("send_to_terminal", { terminal, text }),
};

export const events = {
  board: (handler: (view: BoardView) => void): Promise<UnlistenFn> =>
    listen<BoardView>("board://updated", (e) => handler(e.payload)),
  herdr: (handler: (status: HerdrStatus) => void): Promise<UnlistenFn> =>
    listen<HerdrStatus>("herdr://status", (e) => handler(e.payload)),
  terminals: (handler: () => void): Promise<UnlistenFn> => listen("herdr://terminals", () => handler()),
  chatEnded: (handler: (terminal: string) => void): Promise<UnlistenFn> =>
    listen<string>("chat://ended", (e) => handler(e.payload)),
};

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
