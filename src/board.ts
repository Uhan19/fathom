import {
  ROW_ORDER,
  type Card,
  type CardPlace,
  type Column,
  type MoveRequest,
  type MoveStatus,
  type Overlay,
  type Placement,
  type RowKey,
} from "./api";

export const ROW_LABEL_WIDTH = 150;
export const COLLAPSED_WIDTH = 44;
export const COLUMN_GAP = 10;
export const ROW_PADDING = 16;
export const MIN_COLUMN_WIDTH = 180;
export const MAX_COLUMN_WIDTH = 640;
export const ADD_COLUMN_WIDTH = MIN_COLUMN_WIDTH;

export type Cells = Map<number, Map<RowKey, Card[]>>;

export interface Geometry {
  rowLabel: number;
  collapsed: number;
  lane: number;
}

export const DEFAULT_GEOMETRY: Geometry = { rowLabel: ROW_LABEL_WIDTH, collapsed: COLLAPSED_WIDTH, lane: 260 };

const UNSETTLED: MoveStatus[] = ["sending", "asked", "failed"];
const SHOWN: MoveStatus[] = [...UNSETTLED, "answered"];

export function shownRequest(cardId: string, requests: MoveRequest[]): MoveRequest | null {
  const mine = requests.filter((r) => r.cardId === cardId && SHOWN.includes(r.status));
  return mine[mine.length - 1] ?? null;
}

export function shownRow(card: Card, request: MoveRequest | null): RowKey {
  return request && UNSETTLED.includes(request.status) ? request.toRow : card.row;
}

export function groupCards(cards: Card[], columns: Column[], overlay: Overlay = { places: [], requests: [] }): Cells {
  const cells: Cells = new Map();
  const homes = new Map<string, number>();
  for (const column of columns) {
    cells.set(column.id, new Map(ROW_ORDER.map((row) => [row, [] as Card[]])));
    if (column.project !== null) homes.set(column.project, column.id);
  }
  const places = new Map(overlay.places.map((p) => [p.cardId, p]));
  for (const card of cards) {
    const row = shownRow(card, shownRequest(card.id, overlay.requests));
    const placed = places.get(card.id)?.column;
    const column = placed != null && cells.has(placed) ? placed : homes.get(card.project);
    if (column !== undefined) cells.get(column)?.get(row)?.push(row === card.row ? card : { ...card, row });
  }
  for (const rows of cells.values()) {
    rows.get("landed")?.sort((a, b) => b.closed.localeCompare(a.closed));
    for (const [row, here] of rows) rows.set(row, orderCell(here, row, places));
  }
  return cells;
}

function orderCell(cards: Card[], row: RowKey, places: Map<string, CardPlace>): Card[] {
  const position = (card: Card) => {
    const place = places.get(card.id);
    return place && place.row === row ? place.position : -1;
  };
  return cards
    .map((card, index) => ({ card, index, position: position(card) }))
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map((entry) => entry.card);
}

export function placeLocally(overlay: Overlay, placement: Placement, now: number): Overlay {
  const { cardId, order, toRow } = placement;
  const kept = overlay.places.filter((p) => !order.includes(p.cardId));
  const previous = new Map(overlay.places.map((p) => [p.cardId, p.column]));
  const placed = order.map((id, position) => ({
    cardId: id,
    column: id === cardId ? placement.column : (previous.get(id) ?? null),
    row: toRow,
    position,
  }));
  if (placement.fromRow === toRow) return { ...overlay, places: [...kept, ...placed] };
  const request: MoveRequest = {
    requestId: `pending-${cardId}-${now}`,
    cardId,
    title: placement.title,
    fromRow: placement.fromRow,
    toRow,
    createdMs: now,
    status: "sending",
    noteId: null,
    answer: null,
    error: null,
  };
  return {
    places: [...kept, ...placed],
    requests: [...overlay.requests.filter((r) => r.cardId !== cardId), request],
  };
}

export function insertAt(ids: string[], id: string, index: number): string[] {
  const rest = ids.filter((other) => other !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function insertAmongShown(all: string[], shown: string[], id: string, index: number): string[] {
  const rest = all.filter((other) => other !== id);
  const visible = shown.filter((other) => other !== id);
  const at = index < visible.length ? rest.indexOf(visible[Math.max(0, index)]) : rest.length;
  return insertAt(rest, id, at);
}

export function rowCount(cells: Cells, row: RowKey): number {
  let n = 0;
  for (const rows of cells.values()) n += rows.get(row)?.length ?? 0;
  return n;
}

export function rowCounts(cards: Card[]): Record<RowKey, number> {
  const counts = Object.fromEntries(ROW_ORDER.map((row) => [row, 0])) as Record<RowKey, number>;
  for (const card of cards) counts[card.row] += 1;
  return counts;
}

export function columnTemplate(columns: Column[], geometry: Geometry = DEFAULT_GEOMETRY): string {
  const tracks = columns.map((c) => `${c.collapsed ? geometry.collapsed : c.width}px`);
  return [`${geometry.rowLabel}px`, ...tracks].join(" ");
}

export function headTemplate(columns: Column[], geometry: Geometry = DEFAULT_GEOMETRY): string {
  return `${columnTemplate(columns, geometry)} ${ADD_COLUMN_WIDTH}px`;
}

export function laneTemplate(collapsedRows: RowKey[], geometry: Geometry = DEFAULT_GEOMETRY): string {
  const lanes = ROW_ORDER.map((row) => `${collapsedRows.includes(row) ? geometry.collapsed : geometry.lane}px`);
  return [`${geometry.rowLabel}px`, ...lanes].join(" ");
}

export function isUnnamed(column: Pick<Column, "name">): boolean {
  return column.name.trim() === "";
}

export function renamedColumn(column: Pick<Column, "project" | "name">, input: string): string | null {
  const name = input.trim() || column.project;
  return name === null || name === column.name ? null : name;
}

export function boardMinWidth(columns: Column[], geometry: Geometry = DEFAULT_GEOMETRY): number {
  return columns.reduce(
    (sum, c) => sum + (c.collapsed ? geometry.collapsed : c.width) + COLUMN_GAP,
    geometry.rowLabel + ADD_COLUMN_WIDTH + COLUMN_GAP + 2 * ROW_PADDING,
  );
}

export function oneColumnWidth(columns: Column[], geometry: Geometry = DEFAULT_GEOMETRY): number {
  const firstOpen = columns.findIndex((c) => !c.collapsed);
  const shown = firstOpen < 0 ? columns : columns.slice(0, firstOpen + 1);
  const width = shown.reduce((sum, c) => sum + COLUMN_GAP + (c.collapsed ? geometry.collapsed : c.width), geometry.rowLabel);
  return width + 2 * ROW_PADDING;
}

export function oneLaneWidth(geometry: Geometry = DEFAULT_GEOMETRY): number {
  return geometry.rowLabel + geometry.lane;
}

export function cellCount(cells: Cells, column: number): number {
  return ROW_ORDER.reduce((n, row) => n + (cells.get(column)?.get(row)?.length ?? 0), 0);
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

export function cardNote(card: Card): string | null {
  if (card.row === "seabed" && card.blockedBy.length > 0) return `Waits for ${card.blockedBy.join(", ")}`;
  if (card.row === "deep" && card.holdUntil) return `Until ${card.holdUntil}`;
  return null;
}

export function outcomeTag(card: Pick<Card, "row" | "kind">): string | null {
  return card.row === "landed" && card.kind === "scout" ? "Reported" : null;
}

export function holdHeading(card: Card): string | null {
  switch (card.holdKind) {
    case "":
      return null;
    case "captain":
      return card.holdUntil ? `Waiting on you, until ${card.holdUntil}` : "Question for you";
    case "parked":
      return "Parked";
    default:
      return card.holdUntil ? `On hold (${card.holdKind}) until ${card.holdUntil}` : `On hold (${card.holdKind})`;
  }
}

export function cardMessage(card: Pick<Card, "id" | "title">, text: string): string {
  return `${card.title} (${card.id}): ${text.trim()}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
