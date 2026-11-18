import { describe, expect, it } from "vitest";
import { gapX, landingIndex, moveTo, pickGap, type HeadBox } from "./columnOrder";

const [ATLAS, HARBOR, KEEL, REEF] = [1, 2, 3, 4];
const IDS = [ATLAS, HARBOR, KEEL, REEF];

const HEADS: HeadBox[] = [
  { id: ATLAS, left: 100, right: 340 },
  { id: HARBOR, left: 350, right: 394 },
  { id: KEEL, left: 404, right: 644 },
  { id: REEF, left: 654, right: 894 },
];

describe("pickGap", () => {
  it("picks the gap on the near side of each column's middle", () => {
    expect(pickGap(HEADS, 219)).toBe(0);
    expect(pickGap(HEADS, 221)).toBe(1);
    expect(pickGap(HEADS, 371)).toBe(1);
    expect(pickGap(HEADS, 373)).toBe(2);
    expect(pickGap(HEADS, 700)).toBe(3);
  });

  it("clamps before the first column and past the last", () => {
    expect(pickGap(HEADS, 0)).toBe(0);
    expect(pickGap(HEADS, 2000)).toBe(4);
    expect(pickGap([], 300)).toBe(0);
  });
});

describe("landingIndex", () => {
  it("moves the first column last and the last column first", () => {
    expect(landingIndex(IDS, ATLAS, 4)).toBe(3);
    expect(landingIndex(IDS, REEF, 0)).toBe(0);
  });

  it("moves a middle column either way", () => {
    expect(landingIndex(IDS, HARBOR, 3)).toBe(2);
    expect(landingIndex(IDS, KEEL, 1)).toBe(1);
  });

  it("has no move for the gaps on either side of the column itself", () => {
    expect(landingIndex(IDS, HARBOR, 1)).toBeNull();
    expect(landingIndex(IDS, HARBOR, 2)).toBeNull();
    expect(landingIndex(IDS, 99, 0)).toBeNull();
  });
});

describe("gapX", () => {
  it("sits between two columns, or on the outer edge at either end", () => {
    expect(gapX(HEADS, 0)).toBe(100);
    expect(gapX(HEADS, 2)).toBe(399);
    expect(gapX(HEADS, 4)).toBe(894);
    expect(gapX([], 0)).toBeNull();
  });
});

describe("moveTo", () => {
  const columns = IDS.map((id) => ({ id }));
  const order = (index: number, id: number) => moveTo(columns, id, index).map((c) => c.id);

  it("puts the column at its new index and keeps the rest in order", () => {
    expect(order(3, ATLAS)).toEqual([HARBOR, KEEL, REEF, ATLAS]);
    expect(order(0, REEF)).toEqual([REEF, ATLAS, HARBOR, KEEL]);
    expect(order(2, HARBOR)).toEqual([ATLAS, KEEL, HARBOR, REEF]);
  });

  it("leaves the list alone for an unknown column", () => {
    expect(moveTo(columns, 99, 0)).toBe(columns);
  });
});
