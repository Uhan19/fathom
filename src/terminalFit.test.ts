import { describe, expect, it } from "vitest";
import { fitFontSize, MAX_FONT_SIZE, MIN_FONT_SIZE } from "./terminalFit";

describe("fitFontSize", () => {
  it("fits the terminal's columns into the panel in half-pixel steps", () => {
    expect(fitFontSize(600, 100, 0.6)).toBe(10);
    expect(fitFontSize(610, 100, 0.6)).toBe(10);
  });

  it("never grows past the reading size or shrinks past legibility", () => {
    expect(fitFontSize(4000, 80, 0.6)).toBe(MAX_FONT_SIZE);
    expect(fitFontSize(200, 200, 0.6)).toBe(MIN_FONT_SIZE);
  });
});
