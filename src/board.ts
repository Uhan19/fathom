import { ROW_ORDER, type Card, type Column, type Link, type RowKey } from "./api";

export const ROW_LABEL_WIDTH = 150;
export const COLLAPSED_WIDTH = 44;
export const COLUMN_GAP = 10;
export const MIN_COLUMN_WIDTH = 180;
export const MAX_COLUMN_WIDTH = 640;

export type Cells = Map<string, Map<RowKey, Card[]>>;

export function groupCards(cards: Card[], columns: Column[]): Cells {
  const cells: Cells = new Map();
  for (const column of columns) {
    cells.set(column.project, new Map(ROW_ORDER.map((row) => [row, [] as Card[]])));
  }
  for (const card of cards) {
    cells.get(card.project)?.get(card.row)?.push(card);
  }
  for (const rows of cells.values()) {
    rows.get("landed")?.sort((a, b) => b.closed.localeCompare(a.closed));
  }
  return cells;
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
