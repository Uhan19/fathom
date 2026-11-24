import { describe, expect, it } from "vitest";
import type { RowKey } from "./api";
import { END, pickTarget, sameTarget, type CellBox, type RowBox } from "./dropTarget";

const [ATLAS, HARBOR, KEEL] = [1, 2, 3];

const cell = (column: number, left: number, cardMiddles: number[] = [], collapsed = false): CellBox => ({
  column,
  left,
  right: left + (collapsed ? 44 : 240),
  collapsed,
  cardMiddles,
});

const row = (name: RowKey, top: number, bottom: number, cells: CellBox[]): RowBox => ({ row: name, top, bottom, cells });

const BOARD: RowBox[] = [
  row("surface", 121, 277, [cell(ATLAS, 176, [168, 231]), cell(HARBOR, 426, [168]), cell(KEEL, 676)]),
  row("shallows", 277, 456, [cell(ATLAS, 176, [332]), cell(HARBOR, 426, [], true), cell(KEEL, 480)]),
  row("deep", 456, 624, [cell(ATLAS, 176), cell(HARBOR, 426), cell(KEEL, 676, [500, 560])]),
];

describe("pickTarget", () => {
  it("targets an empty cell anywhere inside its row, not only near the top", () => {
    expect(pickTarget(BOARD, 790, 150)).toEqual({ column: KEEL, row: "surface", index: 0 });
    expect(pickTarget(BOARD, 790, 270)).toEqual({ column: KEEL, row: "surface", index: 0 });
  });

  it("targets the space below a column's cards, placing the card last", () => {
    expect(pickTarget(BOARD, 540, 260)).toEqual({ column: HARBOR, row: "surface", index: 1 });
    expect(pickTarget(BOARD, 300, 440)).toEqual({ column: ATLAS, row: "shallows", index: 1 });
  });

  it("places by card middles inside a column", () => {
    expect(pickTarget(BOARD, 300, 140)).toEqual({ column: ATLAS, row: "surface", index: 0 });
    expect(pickTarget(BOARD, 300, 200)).toEqual({ column: ATLAS, row: "surface", index: 1 });
    expect(pickTarget(BOARD, 800, 530)).toEqual({ column: KEEL, row: "deep", index: 1 });
  });

  it("splits the gap between two columns at its middle", () => {
    expect(pickTarget(BOARD, 418, 200)?.column).toBe(ATLAS);
    expect(pickTarget(BOARD, 424, 200)?.column).toBe(HARBOR);
  });

  it("splits the border between two rows exactly", () => {
    expect(pickTarget(BOARD, 300, 276)?.row).toBe("surface");
    expect(pickTarget(BOARD, 300, 278)?.row).toBe("shallows");
  });

  it("treats the row label and the space past the last column as the nearest column", () => {
    expect(pickTarget(BOARD, 40, 300)).toEqual({ column: ATLAS, row: "shallows", index: 0 });
    expect(pickTarget(BOARD, 1400, 600)).toEqual({ column: KEEL, row: "deep", index: 2 });
  });

  it("clamps above the first row and below the last row", () => {
    expect(pickTarget(BOARD, 300, 90)).toEqual({ column: ATLAS, row: "surface", index: 0 });
    expect(pickTarget(BOARD, 300, 880)).toEqual({ column: ATLAS, row: "deep", index: 0 });
  });

  it("drops onto a collapsed column at the end", () => {
    expect(pickTarget(BOARD, 445, 300)).toEqual({ column: HARBOR, row: "shallows", index: END });
  });

  it("uses each row's own cell positions", () => {
    expect(pickTarget(BOARD, 475, 300)?.column).toBe(HARBOR);
    expect(pickTarget(BOARD, 476, 300)?.column).toBe(KEEL);
  });

  it("has no target without rows or cells", () => {
    expect(pickTarget([], 300, 300)).toBeNull();
    expect(pickTarget([row("surface", 0, 100, [])], 300, 50)).toBeNull();
  });
});

describe("pickTarget in lanes", () => {
  const lane = (column: number, top: number, left: number, cardMiddles: number[] = []): CellBox => ({
    column,
    left,
    right: left + 260,
    top,
    bottom: top + 120,
    collapsed: false,
    cardMiddles,
  });
  const LANES: RowBox[] = [
    row("surface", 0, 800, [lane(ATLAS, 60, 160), lane(HARBOR, 190, 160)]),
    row("shallows", 0, 800, [lane(ATLAS, 60, 430), lane(HARBOR, 190, 430, [240])]),
    row("deep", 0, 800, [lane(ATLAS, 60, 700), lane(HARBOR, 190, 700)]),
  ];

  it("picks the stage by x and the project by y when every lane spans the board", () => {
    expect(pickTarget(LANES, 820, 250)).toEqual({ column: HARBOR, row: "deep", index: 0 });
    expect(pickTarget(LANES, 300, 100)).toEqual({ column: ATLAS, row: "surface", index: 0 });
    expect(pickTarget(LANES, 500, 260)).toEqual({ column: HARBOR, row: "shallows", index: 1 });
  });

  it("splits the gap between two lanes and two projects by distance", () => {
    expect(pickTarget(LANES, 424, 100)?.row).toBe("surface");
    expect(pickTarget(LANES, 426, 100)?.row).toBe("shallows");
    expect(pickTarget(LANES, 300, 182)?.column).toBe(ATLAS);
    expect(pickTarget(LANES, 300, 188)?.column).toBe(HARBOR);
  });
});

describe("sameTarget", () => {
  it("compares by place, not identity", () => {
    expect(sameTarget({ column: 1, row: "deep", index: 1 }, { column: 1, row: "deep", index: 1 })).toBe(true);
    expect(sameTarget({ column: 1, row: "deep", index: 1 }, { column: 1, row: "deep", index: 2 })).toBe(false);
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget(null, { column: 1, row: "deep", index: 1 })).toBe(false);
  });
});
