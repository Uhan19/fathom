import type { Column, MoveTo } from "./api";

export const NEW_COLUMN = "new";

export type MoveChoice = number | typeof NEW_COLUMN;

export interface DeleteDraft {
  picked: MoveChoice;
  name: string;
  busy: boolean;
  error: string | null;
}

export type DeleteEvent =
  | { type: "pick"; choice: MoveChoice }
  | { type: "name"; name: string }
  | { type: "submit" }
  | { type: "fail"; error: string };

export interface DeletePlan {
  moving: boolean;
  choice: MoveChoice;
  moveTo?: MoveTo;
  ready: boolean;
}

export function moveTargets(columns: Column[], deleting: number): Column[] {
  return columns.filter((c) => c.id !== deleting);
}

export function startDraft(targets: Column[]): DeleteDraft {
  return { picked: defaultChoice(targets), name: "", busy: false, error: null };
}

export function nextDraft(draft: DeleteDraft, event: DeleteEvent): DeleteDraft {
  switch (event.type) {
    case "pick":
      return { ...draft, picked: event.choice };
    case "name":
      return { ...draft, name: event.name };
    case "submit":
      return { ...draft, busy: true, error: null };
    case "fail":
      return { ...draft, busy: false, error: event.error };
  }
}

export function deletePlan(held: number, targets: Column[], draft: DeleteDraft): DeletePlan {
  const stillThere = draft.picked === NEW_COLUMN || targets.some((c) => c.id === draft.picked);
  const choice = stillThere ? draft.picked : defaultChoice(targets);
  if (held === 0) return { moving: false, choice, ready: !draft.busy };
  const moveTo = moveToFor(choice, draft.name);
  return moveTo ? { moving: true, choice, moveTo, ready: !draft.busy } : { moving: true, choice, ready: false };
}

function defaultChoice(targets: Column[]): MoveChoice {
  return targets[0]?.id ?? NEW_COLUMN;
}

function moveToFor(choice: MoveChoice, name: string): MoveTo | null {
  if (choice !== NEW_COLUMN) return { kind: "column", id: choice };
  const trimmed = name.trim();
  return trimmed ? { kind: "newColumn", name: trimmed } : null;
}
