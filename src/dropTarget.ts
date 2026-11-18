import type { RowKey } from "./api";

export const END = Number.MAX_SAFE_INTEGER;

export interface DropTarget {
  column: number;
  row: RowKey;
  index: number;
}

export interface CellBox {
  column: number;
  left: number;
  right: number;
  collapsed: boolean;
  cardMiddles: number[];
}

export interface RowBox {
  row: RowKey;
  top: number;
  bottom: number;
  cells: CellBox[];
}

export function pickTarget(rows: RowBox[], x: number, y: number): DropTarget | null {
  const row = nearest(rows, y, (r) => [r.top, r.bottom]);
  const cell = row && nearest(row.cells, x, (c) => [c.left, c.right]);
  if (!row || !cell) return null;
  const index = cell.collapsed ? END : cell.cardMiddles.filter((middle) => middle < y).length;
  return { column: cell.column, row: row.row, index };
}

export function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  return a === b || (!!a && !!b && a.column === b.column && a.row === b.row && a.index === b.index);
}

function nearest<T>(items: T[], at: number, span: (item: T) => [number, number]): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const [low, high] = span(item);
    const distance = at < low ? low - at : at > high ? at - high : 0;
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}
