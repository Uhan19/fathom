import type { Card, SourceKind } from "./api";

const LISTED_NUMBERS = 4;

export function taskName(card: Card, source: SourceKind): string | null {
  return source === "firstmate" ? card.id : null;
}

export function taskRef(card: Card, source: SourceKind): string {
  const name = taskName(card, source);
  if (card.number === null) return name ?? card.id;
  return name ? `#${card.number} ${name}` : `#${card.number}`;
}

export function isFocused(card: Card, focus: number[]): boolean {
  return card.number !== null && focus.includes(card.number);
}

export function focusText(focus: number[]): string {
  const refs = focus.map((n) => `#${n}`);
  if (refs.length === 1) return `Showing only task ${refs[0]}.`;
  if (refs.length > LISTED_NUMBERS) return `Showing only tasks ${refs.slice(0, LISTED_NUMBERS - 1).join(", ")} and ${refs.length - LISTED_NUMBERS + 1} more.`;
  return `Showing only tasks ${refs.slice(0, -1).join(", ")} and ${refs[refs.length - 1]}.`;
}

export function focusMissText(projectsFiltered: boolean): string {
  return projectsFiltered ? "None of the focused tasks is in the shown projects." : "None of the focused tasks is on the board.";
}
