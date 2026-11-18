import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { ROW_ORDER, type BoardView, type Card, type CardPlace, type Column, type Layout, type MoveRequest, type MoveTo, type Overlay, type Placement, type RowKey, type Settings } from "../api";
import { cellCount, groupCards, type Cells } from "../board";
import { moveTo } from "../columnOrder";
import { FIXTURE_CARDS, FIXTURE_COLUMNS, FIXTURE_LATE_CARD, FIXTURE_REQUESTS, FIXTURE_SCREEN, FIXTURE_TERMINALS, FIXTURE_WORKERS, fixtureDetail, workerScreen } from "./fixture";

const params = new URLSearchParams(location.search);
const noLabel = params.has("nolabel");
const failing = params.has("error");
const empty = params.has("empty");
const otherClient = params.get("other")?.match(/^(\d+)x(\d+)$/);
const sendFails = params.has("sendfail");
const lateCard = params.has("late");
const deleteFails = params.has("deletefail");
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
let columns: Column[] = FIXTURE_COLUMNS.map((c) => ({ ...c }));
let nextColumnId = columns.length + 1;
const rowNames = new Map<string, string>();
let cards: Card[] = empty ? [] : FIXTURE_CARDS;
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
  sendRequest(request);
  if (cards.find((c) => c.id === p.cardId)?.row === p.toRow) request.status = "landed";
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

mockWindows("main");

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

const previewFeed = (view: string, text: string) => outputs.get(view)?.onmessage(bytes(text));

Object.assign(window, { previewEmit: emit, previewFeed });

await import("../main");
