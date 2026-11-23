import { describe, expect, it } from "vitest";
import type { Card, Column } from "./api";
import { cellCount, groupCards } from "./board";
import { deletePlan, moveTargets, NEW_COLUMN, nextDraft, startDraft, type DeleteDraft, type DeleteEvent } from "./columnDelete";

const [HARBOR, REEF, LATER] = [1, 2, 3];

const column = (id: number, project: string | null, name = project ?? "Later"): Column => ({
  id,
  project,
  name,
  position: id,
  width: 240,
  collapsed: false,
});

const card = (id: string, project: string): Card => ({
  id,
  title: id,
  state: "open",
  kind: "task",
  project,
  row: "deep",
  holdKind: "",
  holdUntil: "",
  holdReason: "",
  blockedBy: [],
  links: [],
  closed: "",
  number: null,
});

const columns = [column(HARBOR, "harbor"), column(REEF, "reef"), column(LATER, null)];
const after = (draft: DeleteDraft, ...events: DeleteEvent[]) => events.reduce(nextDraft, draft);

describe("deleting a column that holds cards", () => {
  const targets = moveTargets(columns, REEF);

  it("offers every other column and starts on the first one", () => {
    expect(targets.map((c) => c.id)).toEqual([HARBOR, LATER]);
    expect(deletePlan(2, targets, startDraft(targets))).toEqual({
      moving: true,
      choice: HARBOR,
      moveTo: { kind: "column", id: HARBOR },
      ready: true,
    });
  });

  it("moves the cards to the existing column picked", () => {
    const draft = after(startDraft(targets), { type: "pick", choice: LATER });
    expect(deletePlan(2, targets, draft).moveTo).toEqual({ kind: "column", id: LATER });
  });

  it("moves the cards to a new column once it has a trimmed name", () => {
    const picked = after(startDraft(targets), { type: "pick", choice: NEW_COLUMN });
    expect(deletePlan(2, targets, picked)).toEqual({ moving: true, choice: NEW_COLUMN, ready: false });
    expect(deletePlan(2, targets, after(picked, { type: "name", name: "   " })).ready).toBe(false);
    expect(deletePlan(2, targets, after(picked, { type: "name", name: "  This week " })).moveTo).toEqual({
      kind: "newColumn",
      name: "This week",
    });
  });

  it("offers only a new column when no other column is left", () => {
    expect(deletePlan(1, [], startDraft([]))).toEqual({ moving: true, choice: NEW_COLUMN, ready: false });
  });

  it("falls back to the first column when the picked one goes away", () => {
    const draft = after(startDraft(targets), { type: "pick", choice: LATER });
    expect(deletePlan(2, [column(HARBOR, "harbor")], draft).moveTo).toEqual({ kind: "column", id: HARBOR });
  });

  it("waits while the move runs", () => {
    expect(deletePlan(2, targets, after(startDraft(targets), { type: "submit" })).ready).toBe(false);
  });

  it("keeps the choice and shows the error when the move fails", () => {
    const tried = after(startDraft(targets), { type: "pick", choice: NEW_COLUMN }, { type: "name", name: "This week" }, { type: "submit" });
    const failed = after(tried, { type: "fail", error: "disk is full" });
    expect(failed).toEqual({ picked: NEW_COLUMN, name: "This week", busy: false, error: "disk is full" });
    expect(deletePlan(2, targets, failed)).toEqual({ moving: true, choice: NEW_COLUMN, moveTo: { kind: "newColumn", name: "This week" }, ready: true });
    expect(after(failed, { type: "submit" }).error).toBeNull();
  });
});

describe("deleting an empty column", () => {
  it("asks only for confirmation", () => {
    const targets = moveTargets(columns, LATER);
    const held = cellCount(groupCards([card("a", "harbor")], columns), LATER);
    expect(held).toBe(0);
    expect(deletePlan(held, targets, startDraft(targets))).toEqual({ moving: false, choice: HARBOR, ready: true });
  });
});

describe("a card arriving after the dialog opened", () => {
  const targets = moveTargets(columns, REEF);
  const draft = startDraft(targets);

  it("turns a plain confirmation into a move", () => {
    expect(deletePlan(cellCount(groupCards([], columns), REEF), targets, draft).moving).toBe(false);
    const held = cellCount(groupCards([card("late", "reef")], columns), REEF);
    expect(deletePlan(held, targets, draft)).toEqual({ moving: true, choice: HARBOR, moveTo: { kind: "column", id: HARBOR }, ready: true });
  });

  it("keeps the picked target while the count grows", () => {
    const picked = after(draft, { type: "pick", choice: LATER });
    const before = cellCount(groupCards([card("a", "reef")], columns), REEF);
    const later = cellCount(groupCards([card("a", "reef"), card("late", "reef")], columns), REEF);
    expect([before, later]).toEqual([1, 2]);
    expect(deletePlan(later, targets, picked).moveTo).toEqual({ kind: "column", id: LATER });
  });
});
