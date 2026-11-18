import { describe, expect, it } from "vitest";
import type { RowKey } from "./api";
import { END, pickTarget, sameTarget, type CellBox, type RowBox } from "./dropTarget";

const cell = (project: string, left: number, cardMiddles: number[] = [], collapsed = false): CellBox => ({
  project,
  left,
  right: left + (collapsed ? 44 : 240),
  collapsed,
  cardMiddles,
});

const row = (name: RowKey, top: number, bottom: number, cells: CellBox[]): RowBox => ({ row: name, top, bottom, cells });

const BOARD: RowBox[] = [
  row("surface", 121, 277, [cell("atlas", 176, [168, 231]), cell("harbor", 426, [168]), cell("keel", 676)]),
  row("shallows", 277, 456, [cell("atlas", 176, [332]), cell("harbor", 426, [], true), cell("keel", 480)]),
  row("deep", 456, 624, [cell("atlas", 176), cell("harbor", 426), cell("keel", 676, [500, 560])]),
];

describe("pickTarget", () => {
  it("targets an empty cell anywhere inside its row, not only near the top", () => {
    expect(pickTarget(BOARD, 790, 150)).toEqual({ project: "keel", row: "surface", index: 0 });
    expect(pickTarget(BOARD, 790, 270)).toEqual({ project: "keel", row: "surface", index: 0 });
  });

  it("targets the space below a column's cards, placing the card last", () => {
    expect(pickTarget(BOARD, 540, 260)).toEqual({ project: "harbor", row: "surface", index: 1 });
    expect(pickTarget(BOARD, 300, 440)).toEqual({ project: "atlas", row: "shallows", index: 1 });
  });

  it("places by card middles inside a column", () => {
    expect(pickTarget(BOARD, 300, 140)).toEqual({ project: "atlas", row: "surface", index: 0 });
    expect(pickTarget(BOARD, 300, 200)).toEqual({ project: "atlas", row: "surface", index: 1 });
    expect(pickTarget(BOARD, 800, 530)).toEqual({ project: "keel", row: "deep", index: 1 });
  });

  it("splits the gap between two columns at its middle", () => {
    expect(pickTarget(BOARD, 418, 200)?.project).toBe("atlas");
    expect(pickTarget(BOARD, 424, 200)?.project).toBe("harbor");
  });

  it("splits the border between two rows exactly", () => {
    expect(pickTarget(BOARD, 300, 276)?.row).toBe("surface");
    expect(pickTarget(BOARD, 300, 278)?.row).toBe("shallows");
  });

  it("treats the row label and the space past the last column as the nearest column", () => {
    expect(pickTarget(BOARD, 40, 300)).toEqual({ project: "atlas", row: "shallows", index: 0 });
    expect(pickTarget(BOARD, 1400, 600)).toEqual({ project: "keel", row: "deep", index: 2 });
  });

  it("clamps above the first row and below the last row", () => {
    expect(pickTarget(BOARD, 300, 90)).toEqual({ project: "atlas", row: "surface", index: 0 });
    expect(pickTarget(BOARD, 300, 880)).toEqual({ project: "atlas", row: "deep", index: 0 });
  });

  it("drops onto a collapsed column at the end", () => {
    expect(pickTarget(BOARD, 445, 300)).toEqual({ project: "harbor", row: "shallows", index: END });
  });

  it("uses each row's own cell positions", () => {
    expect(pickTarget(BOARD, 475, 300)?.project).toBe("harbor");
    expect(pickTarget(BOARD, 476, 300)?.project).toBe("keel");
  });

  it("has no target without rows or cells", () => {
    expect(pickTarget([], 300, 300)).toBeNull();
    expect(pickTarget([row("surface", 0, 100, [])], 300, 50)).toBeNull();
  });
});

describe("sameTarget", () => {
  it("compares by place, not identity", () => {
    expect(sameTarget({ project: "a", row: "deep", index: 1 }, { project: "a", row: "deep", index: 1 })).toBe(true);
    expect(sameTarget({ project: "a", row: "deep", index: 1 }, { project: "a", row: "deep", index: 2 })).toBe(false);
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget(null, { project: "a", row: "deep", index: 1 })).toBe(false);
  });
});
