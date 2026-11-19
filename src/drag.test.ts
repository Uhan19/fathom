import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { resizer, startDrag } from "./drag";
import { CHAT_WIDTH, DETAIL_WIDTH } from "./windowSettings";

const LAPTOP_BOARD = 364;

describe("resizer", () => {
  it("follows the pointer one to one inside the range", () => {
    const width = resizer(600, 600 + LAPTOP_BOARD, CHAT_WIDTH);
    expect([1, 5, 50, -1, -50].map(width)).toEqual([601, 605, 650, 599, 550]);
  });

  it("stops where the board runs out instead of at the setting's largest width", () => {
    expect(resizer(600, 600 + LAPTOP_BOARD, CHAT_WIDTH)(800)).toBe(600 + LAPTOP_BOARD);
    expect(resizer(460, 460 + LAPTOP_BOARD, DETAIL_WIDTH)(800)).toBe(460 + LAPTOP_BOARD);
  });

  it("shrinks from the first pixel after a drag that ended past the limit", () => {
    const released = resizer(600, 600 + LAPTOP_BOARD, CHAT_WIDTH)(800);
    const next = resizer(released, released, CHAT_WIDTH);
    expect(next(-1)).toBe(released - 1);
  });

  it("starts from the shown width when the stored width is wider than the window shows", () => {
    const shown = 964;
    const width = resizer(CHAT_WIDTH.max, shown, CHAT_WIDTH);
    expect(width(0)).toBe(shown);
    expect(width(-1)).toBe(shown - 1);
  });

  it("moves in whole pixels when the pointer reports fractions, so the saved width is the shown width", () => {
    const width = resizer(600, 600 + LAPTOP_BOARD, CHAT_WIDTH);
    expect([123.37, -77.63, 0.2].map(width)).toEqual([723, 522, 600]);
  });

  it("stops on the last whole pixel the layout has room for", () => {
    expect(resizer(600, 600 + LAPTOP_BOARD + 0.6, CHAT_WIDTH)(800)).toBe(600 + LAPTOP_BOARD);
  });

  it("never goes below the smallest width, even when the layout has no room", () => {
    expect(resizer(DETAIL_WIDTH.min, 100, DETAIL_WIDTH)(-50)).toBe(DETAIL_WIDTH.min);
    expect(resizer(DETAIL_WIDTH.min, 100, DETAIL_WIDTH)(50)).toBe(DETAIL_WIDTH.min);
  });
});

const POINTER = 1;

const pointer = (type: string, clientX: number, pointerId = POINTER) => Object.assign(new Event(type), { clientX, clientY: 0, pointerId });

describe("startDrag", () => {
  const cursor = new Set<string>();
  const handle = { setPointerCapture: vi.fn() };

  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { body: { classList: { add: (c: string) => cursor.add(c), remove: (c: string) => cursor.delete(c) } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cursor.clear();
    handle.setPointerCapture.mockClear();
  });

  const begin = (onMove: (dx: number) => void, onEnd: (dx: number) => void) =>
    startDrag({ clientX: 100, clientY: 0, pointerId: POINTER, currentTarget: handle, preventDefault() {} } as unknown as ReactPointerEvent, onMove, onEnd);

  it("captures the pointer so terminals under it cannot take the moves or the release", () => {
    begin(() => undefined, () => undefined);
    expect(handle.setPointerCapture).toHaveBeenCalledWith(POINTER);
  });

  it("reports moves and ends once on release", () => {
    const moves: number[] = [];
    const ends: number[] = [];
    begin((dx) => moves.push(dx), (dx) => ends.push(dx));
    window.dispatchEvent(pointer("pointermove", 90));
    window.dispatchEvent(pointer("pointerup", 90));
    window.dispatchEvent(pointer("lostpointercapture", 90));
    window.dispatchEvent(pointer("pointermove", 50));
    expect(moves).toEqual([-10]);
    expect(ends).toEqual([-10]);
    expect(cursor.size).toBe(0);
  });

  it("ends when the browser cancels the pointer or takes the capture away", () => {
    for (const type of ["pointercancel", "lostpointercapture"]) {
      const ends: number[] = [];
      begin(() => undefined, (dx) => ends.push(dx));
      window.dispatchEvent(pointer("pointermove", 130));
      window.dispatchEvent(pointer(type, 130));
      expect(ends).toEqual([30]);
      expect(cursor.size).toBe(0);
    }
  });

  it("ignores other pointers", () => {
    const moves: number[] = [];
    const ends: number[] = [];
    begin((dx) => moves.push(dx), (dx) => ends.push(dx));
    window.dispatchEvent(pointer("pointermove", 0, 7));
    window.dispatchEvent(pointer("pointerup", 0, 7));
    expect(moves).toEqual([]);
    expect(ends).toEqual([]);
  });
});
