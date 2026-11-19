import { ROW_ORDER } from "./api";
import type { Cells } from "./board";

export interface CardUpdates {
  marks: Record<string, string>;
  seen: Record<string, string>;
}

export const NO_UPDATES: CardUpdates = { marks: {}, seen: {} };

export function isUnseen(updates: CardUpdates, cardId: string): boolean {
  const mark = updates.marks[cardId];
  return mark !== undefined && updates.seen[cardId] !== mark;
}

export function columnHasUnseen(cells: Cells, column: number, updates: CardUpdates): boolean {
  const rows = cells.get(column);
  return ROW_ORDER.some((row) => (rows?.get(row) ?? []).some((card) => isUnseen(updates, card.id)));
}

export function seenLocally(updates: CardUpdates, cardId: string): CardUpdates {
  if (!isUnseen(updates, cardId)) return updates;
  return { ...updates, seen: { ...updates.seen, [cardId]: updates.marks[cardId] } };
}

export function leftCard(previous: string | null, next: string | null): string | null {
  return previous !== null && previous !== next ? previous : null;
}
