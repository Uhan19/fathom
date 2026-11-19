import type { Column } from "./api";
import { moveTo } from "./columnOrder";

export function shownColumns(columns: Column[], filter: string[]): Column[] {
  if (filter.length === 0) return columns;
  return columns.filter((c) => c.project !== null && filter.includes(c.project));
}

export function filterText(filter: string[]): string {
  const names = filter.length <= 2 ? filter.join(" and ") : `${filter.slice(0, -1).join(", ")} and ${filter[filter.length - 1]}`;
  return `Showing only ${names}.`;
}

export function indexAmongAll(all: Column[], shown: Column[], id: number, shownIndex: number): number {
  const reordered = moveTo(shown, id, shownIndex);
  const shownIds = new Set(shown.map((c) => c.id));
  let next = 0;
  const merged = all.map((c) => (shownIds.has(c.id) ? reordered[next++] : c));
  return merged.findIndex((c) => c.id === id);
}
