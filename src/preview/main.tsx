import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { BoardView, Card, Settings } from "../api";
import { FIXTURE_CARDS, FIXTURE_COLUMNS, FIXTURE_SCREEN, FIXTURE_TERMINALS, fixtureDetail } from "./fixture";

const params = new URLSearchParams(location.search);
const noLabel = params.has("nolabel");
const failing = params.has("error");
const empty = params.has("empty");

let settings: Settings = {
  home: "/home/demo/firstmate",
  terminalLabel: "firstmate.role=primary",
  hcSession: "",
  hcSocket: "",
};
let columns = FIXTURE_COLUMNS.map((c) => ({ ...c }));
const rowNames = new Map<string, string>();
const cards: Card[] = empty ? [] : FIXTURE_CARDS;

const view = (fromCache: boolean): BoardView => ({
  columns: empty ? [] : columns,
  rowNames: ["surface", "shallows", "deep", "seabed", "landed"].map((row) => ({
    row: row as BoardView["rowNames"][number]["row"],
    name: rowNames.get(row) ?? row[0].toUpperCase() + row.slice(1),
  })),
  cards,
  takenAtMs: Date.now(),
  home: settings.home,
  fromCache,
  error: failing && !fromCache ? "fm-tasks-axi.sh exited with status 1: error: \"backlog not found\"" : null,
});

type Output = { onmessage: (bytes: number[]) => void };

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
      case "card_detail":
        return fixtureDetail(cards.find((c) => c.id === args.id) ?? FIXTURE_CARDS[0]);
      case "update_column":
        columns = columns.map((c) =>
          c.project === args.project
            ? { ...c, width: (args.width as number | null) ?? c.width, collapsed: (args.collapsed as boolean | null) ?? c.collapsed }
            : c,
        );
        return null;
      case "set_row_name":
        rowNames.set(args.row as string, args.name as string);
        return null;
      case "get_settings":
        return settings;
      case "save_settings":
        settings = args.settings as Settings;
        return settings;
      case "data_info":
        return { path: "/home/demo/Library/Application Support/app.fathom.board.dev/fathom.sqlite", bytes: 49152 };
      case "export_data":
        return `${args.directory}/fathom-export-1763400000000`;
      case "open_link":
      case "chat_input":
      case "detach_chat":
        return null;
      case "send_to_terminal":
        console.info("send_to_terminal", args.terminal, args.text);
        return null;
      case "herdr_status":
        return { connected: true, message: "" };
      case "find_chat_terminal":
        return noLabel ? null : FIXTURE_TERMINALS[0];
      case "list_terminals":
        return FIXTURE_TERMINALS;
      case "attach_chat": {
        const output = args.output as Output;
        setTimeout(() => output.onmessage([...new TextEncoder().encode(FIXTURE_SCREEN)]), 50);
        return { terminal: args.terminal, cols: 120, rows: 40 };
      }
      case "plugin:dialog|open":
        return "/home/demo/exports";
      default:
        throw new Error(`preview has no mock for ${cmd}`);
    }
  },
  { shouldMockEvents: true },
);

Object.assign(window, { previewEmit: emit });

await import("../main");
