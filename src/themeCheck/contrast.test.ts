import { describe, expect, it } from "vitest";
import { contrast, over, parseColor } from "./contrast";

describe("contrast", () => {
  it("reads the colors getComputedStyle returns", () => {
    expect(parseColor("rgb(17, 19, 21)")).toEqual({ r: 17, g: 19, b: 21, a: 1 });
    expect(parseColor("rgba(255, 255, 255, 0.5)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseColor("rgb(0 0 0 / 25%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.25 });
    expect(parseColor("transparent")?.a).toBe(0);
    expect(parseColor("color(display-p3 1 0 0)")).toBeNull();
  });

  it("gives black on white 21 and white on white 1", () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrast({ r: 0, g: 0, b: 0, a: 1 }, white)).toBeCloseTo(21, 0);
    expect(contrast(white, white)).toBeCloseTo(1, 5);
  });

  it("blends a faded text into its background", () => {
    const page = { r: 255, g: 255, b: 255, a: 1 };
    const faint = { r: 0, g: 0, b: 0, a: 0.1 };
    expect(contrast(faint, page)).toBeLessThan(1.5);
    expect(over({ r: 0, g: 0, b: 0, a: 0.5 }, page).r).toBeCloseTo(127.5, 1);
  });
});
