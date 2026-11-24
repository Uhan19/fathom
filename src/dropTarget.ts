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
  top?: number;
  bottom?: number;
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
  const found = nearestCell(rows, x, y);
  if (!found) return null;
  const { row, cell } = found;
  const index = cell.collapsed ? END : cell.cardMiddles.filter((middle) => middle < y).length;
  return { column: cell.column, row: row.row, index };
}

export function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  return a === b || (!!a && !!b && a.column === b.column && a.row === b.row && a.index === b.index);
}

const distance = (at: number, low: number, high: number) => (at < low ? low - at : at > high ? at - high : 0);

function nearestCell(rows: RowBox[], x: number, y: number): { row: RowBox; cell: CellBox } | null {
  let best: { row: RowBox; cell: CellBox } | null = null;
  let bestDy = Infinity;
  let bestDx = Infinity;
  for (const row of rows) {
    for (const cell of row.cells) {
      const dy = distance(y, cell.top ?? row.top, cell.bottom ?? row.bottom);
      const dx = distance(x, cell.left, cell.right);
      if (dy < bestDy || (dy === bestDy && dx < bestDx)) {
        best = { row, cell };
        bestDy = dy;
        bestDx = dx;
      }
    }
  }
  return best;
}
