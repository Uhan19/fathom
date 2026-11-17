import { describe, expect, it } from "vitest";
import { fitFontSize, MAX_FONT_SIZE, MIN_FONT_SIZE } from "./terminalFit";

describe("fitFontSize", () => {
  it("fits the terminal's columns into the panel in half-pixel steps", () => {
    expect(fitFontSize(750, 100, 0.6)).toBe(12.5);
    expect(fitFontSize(760, 100, 0.6)).toBe(12.5);
  });

  it("never grows past the reading size or shrinks below readable text", () => {
    expect(fitFontSize(4000, 80, 0.6)).toBe(MAX_FONT_SIZE);
    expect(fitFontSize(576, 200, 0.6)).toBe(MIN_FONT_SIZE);
  });
});
