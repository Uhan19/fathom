import {
  ROW_ORDER,
  type Card,
  type CardPlace,
  type Column,
  type Link,
  type MoveRequest,
  type MoveStatus,
  type Overlay,
  type Placement,
  type RowKey,
} from "./api";

export const ROW_LABEL_WIDTH = 150;
export const COLLAPSED_WIDTH = 44;
export const COLUMN_GAP = 10;
export const MIN_COLUMN_WIDTH = 180;
export const MAX_COLUMN_WIDTH = 640;

export type Cells = Map<string, Map<RowKey, Card[]>>;

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
  for (const column of columns) {
    cells.set(column.project, new Map(ROW_ORDER.map((row) => [row, [] as Card[]])));
  }
  const places = new Map(overlay.places.map((p) => [p.cardId, p]));
  for (const card of cards) {
    const row = shownRow(card, shownRequest(card.id, overlay.requests));
    const moved = places.get(card.id)?.project;
    const project = moved && cells.has(moved) ? moved : card.project;
    cells.get(project)?.get(row)?.push(row === card.row && project === card.project ? card : { ...card, row, project });
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
  const previous = new Map(overlay.places.map((p) => [p.cardId, p.project]));
  const placed = order.map((id, position) => ({
    cardId: id,
    project: id === cardId ? placement.project : (previous.get(id) ?? null),
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

export function rowCounts(cards: Card[]): Record<RowKey, number> {
  const counts = Object.fromEntries(ROW_ORDER.map((row) => [row, 0])) as Record<RowKey, number>;
  for (const card of cards) counts[card.row] += 1;
  return counts;
}

export function columnTemplate(columns: Column[]): string {
  const tracks = columns.map((c) => `${c.collapsed ? COLLAPSED_WIDTH : c.width}px`);
  return [`${ROW_LABEL_WIDTH}px`, ...tracks].join(" ");
}

export function boardMinWidth(columns: Column[]): number {
  return columns.reduce((sum, c) => sum + (c.collapsed ? COLLAPSED_WIDTH : c.width) + COLUMN_GAP, ROW_LABEL_WIDTH + 32);
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

export function cardNote(card: Card): string | null {
  if (card.row === "seabed" && card.blockedBy.length > 0) return `Waits for ${card.blockedBy.join(", ")}`;
  if (card.row === "deep" && card.holdUntil) return `Until ${card.holdUntil}`;
  return null;
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

export function linkLabel(link: Link): string {
  const pr = link.target.match(/\/pull\/(\d+)/);
  if (link.kind === "pr" && pr) return `PR #${pr[1]} on GitHub`;
  if (link.kind === "report") return `Report: ${link.target.split("/").pop() ?? link.target}`;
  return `${link.kind}: ${link.target}`;
}

export function cardMessage(card: Pick<Card, "id" | "title">, text: string): string {
  return `${card.title} (${card.id}): ${text.trim()}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
