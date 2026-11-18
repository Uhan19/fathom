import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { BoardView, Card, CardPlace, MoveRequest, Overlay, Placement, Settings } from "../api";
import { FIXTURE_CARDS, FIXTURE_COLUMNS, FIXTURE_REQUESTS, FIXTURE_SCREEN, FIXTURE_TERMINALS, FIXTURE_WORKERS, fixtureDetail, workerScreen } from "./fixture";

const params = new URLSearchParams(location.search);
const noLabel = params.has("nolabel");
const failing = params.has("error");
const empty = params.has("empty");
const otherClient = params.get("other")?.match(/^(\d+)x(\d+)$/);
const sendFails = params.has("sendfail");
const KITTY_PUSH = params.has("kitty") ? "\x1b[>1u" : "";

let settings: Settings = {
  home: "/home/demo/firstmate",
  terminalLabel: "firstmate.role=primary",
  hcSession: "",
  hcSocket: "",
  chatFont: "sf-mono",
  chatFontSize: 13,
  boardFont: "default",
  boardFontSize: 14,
  chatAddedFonts: [],
  boardAddedFonts: [],
};
const INSTALLED_FONTS = ["American Typewriter", "Andale Mono", "Avenir Next", "Courier New", "Georgia", "Helvetica Neue", "Menlo", "PT Mono", "Times New Roman", "Trebuchet MS"];
let columns = FIXTURE_COLUMNS.map((c) => ({ ...c }));
const rowNames = new Map<string, string>();
const cards: Card[] = empty ? [] : FIXTURE_CARDS;
let places: CardPlace[] = [];
let requests: MoveRequest[] = empty ? [] : FIXTURE_REQUESTS.map((r) => ({ ...r }));
const OPEN = ["sending", "asked", "failed", "answered"];
const overlay = (): Overlay => ({ places, requests: requests.filter((r) => OPEN.includes(r.status)) });

const sendRequest = (request: MoveRequest) => {
  request.status = sendFails ? "failed" : "asked";
  request.noteId = sendFails ? null : `${Date.now()}-preview`;
  request.error = sendFails ? "fm-inbox: no inbox at /home/demo/firstmate/state/inbox" : null;
  console.info("move request", request.requestId, request.status);
};

const placeCard = (p: Placement) => {
  const previous = new Map(places.map((place) => [place.cardId, place.project]));
  places = [
    ...places.filter((place) => !p.order.includes(place.cardId)),
    ...p.order.map((id, position) => ({ cardId: id, project: id === p.cardId ? p.project : (previous.get(id) ?? null), row: p.toRow, position })),
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
  sendRequest(request);
  if (cards.find((c) => c.id === p.cardId)?.row === p.toRow) request.status = "landed";
};

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
  ...overlay(),
});

type Output = { onmessage: (message: number[] | { cols: number; rows: number }) => void };
const outputs = new Map<unknown, Output>();
const bytes = (text: string) => [...new TextEncoder().encode(text)];

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
      case "place_card":
        placeCard(args.placement as Placement);
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
        return empty ? [] : FIXTURE_WORKERS;
      case "get_settings":
        return settings;
      case "save_settings":
        settings = args.settings as Settings;
        return settings;
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
        outputs.get(args.view)?.onmessage(bytes((args.data as string).replace(/\r/g, "\r\n")));
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
        return noLabel ? null : FIXTURE_TERMINALS[0];
      case "list_terminals":
        return FIXTURE_TERMINALS;
      case "attach_terminal": {
        const output = args.output as Output;
        outputs.set(args.view, output);
        const screen = args.view === "worker" ? workerScreen(args.terminal as string) : KITTY_PUSH + FIXTURE_SCREEN;
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
      default:
        throw new Error(`preview has no mock for ${cmd}`);
    }
  },
  { shouldMockEvents: true },
);

Object.assign(window, { previewEmit: emit });

await import("../main");
