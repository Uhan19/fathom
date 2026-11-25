import { ROW_ORDER, type Card, type Column, type Overlay, type SourceKind } from "./api";
import { groupCards } from "./board";
import { taskRef } from "./taskRef";

export interface Ticket {
  card: Card;
  ref: string;
}

export function boardTickets(cards: Card[], columns: Column[], overlay: Overlay, source: SourceKind): Ticket[] {
  const cells = groupCards(cards, columns, overlay);
  const tickets: Ticket[] = [];
  for (const column of columns) {
    const rows = cells.get(column.id);
    for (const row of ROW_ORDER) {
      for (const card of rows?.get(row) ?? []) tickets.push({ card, ref: taskRef(card, source) });
    }
  }
  return tickets;
}

export function matchTickets(tickets: Ticket[], query: string): Ticket[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const byRef = tickets.filter((t) => t.ref.toLowerCase().includes(needle));
  const refMatched = new Set(byRef);
  const byTitle = tickets.filter((t) => !refMatched.has(t) && t.card.title.toLowerCase().includes(needle));
  return [...byRef, ...byTitle];
}

export type SearchStep = { type: "move"; active: number } | { type: "pick"; index: number } | { type: "close" } | null;

export function searchKey(key: string, active: number, count: number): SearchStep {
  switch (key) {
    case "ArrowDown":
      return count > 0 ? { type: "move", active: (active + 1) % count } : null;
    case "ArrowUp":
      return count > 0 ? { type: "move", active: (active - 1 + count) % count } : null;
    case "Enter":
      return count > 0 ? { type: "pick", index: Math.min(Math.max(active, 0), count - 1) } : null;
    case "Escape":
      return { type: "close" };
    default:
      return null;
  }
}

const LIST_GAP = 6;
const LIST_EDGE = 12;
const LIST_MIN_WIDTH = 440;
const LIST_MAX_HEIGHT = 420;
const LIST_ROOM_BELOW = 200;

export interface ListPlace {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export function listPlace(field: Pick<DOMRect, "left" | "top" | "bottom" | "width">, viewport: { width: number; height: number }): ListPlace {
  const below = viewport.height - field.bottom - LIST_GAP - LIST_EDGE;
  const above = field.top - LIST_GAP - LIST_EDGE;
  const up = below < LIST_ROOM_BELOW && above > below;
  const left = Math.max(LIST_EDGE, Math.min(field.left, viewport.width - LIST_MIN_WIDTH - LIST_EDGE));
  const width = Math.min(Math.max(field.width, LIST_MIN_WIDTH), viewport.width - left - LIST_EDGE);
  const maxHeight = Math.min(LIST_MAX_HEIGHT, up ? above : below);
  return up ? { left, width, maxHeight, bottom: viewport.height - field.top + LIST_GAP } : { left, width, maxHeight, top: field.bottom + LIST_GAP };
}
