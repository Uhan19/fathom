import { describe, expect, it } from "vitest";
import { textPainted } from "./scan";

const TRANSPARENT = "rgba(0, 0, 0, 0)";
const INK = "rgb(17, 19, 21)";
const GRADIENT = "linear-gradient(90deg, rgb(11, 61, 145), rgb(106, 27, 154))";

const computed = (props: Record<string, string>) => {
  const all: Record<string, string> = {
    color: INK,
    "-webkit-text-fill-color": INK,
    "-webkit-text-stroke-width": "0px",
    "-webkit-text-stroke-color": INK,
    "background-clip": "border-box",
    "-webkit-background-clip": "border-box",
    "background-image": "none",
    "background-color": TRANSPARENT,
    ...props,
  };
  return { getPropertyValue: (name: string) => all[name] ?? "" };
};
const unfilled = (props: Record<string, string> = {}) => computed({ "-webkit-text-fill-color": TRANSPARENT, ...props });
const clipped = (props: Record<string, string>) => computed({ "background-clip": "text", "-webkit-background-clip": "text", ...props });

describe("whether text is painted", () => {
  it("counts text with a visible fill", () => {
    expect(textPainted(computed({}), [])).toBe(true);
  });

  it("counts a transparent fill outlined by a visible stroke at least half a pixel wide", () => {
    expect(textPainted(unfilled({ "-webkit-text-stroke-width": "1px" }), [])).toBe(true);
    expect(textPainted(unfilled({ "-webkit-text-stroke-width": "0.5px" }), [])).toBe(true);
  });

  it("treats a transparent fill with a transparent or hairline stroke as hidden", () => {
    expect(textPainted(unfilled({ "-webkit-text-stroke-width": "1px", "-webkit-text-stroke-color": TRANSPARENT }), [])).toBe(false);
    expect(textPainted(unfilled({ "-webkit-text-stroke-width": "0.01px" }), [])).toBe(false);
    expect(textPainted(unfilled(), [])).toBe(false);
  });

  it("counts a transparent fill clipped to a painted background on the text or a parent", () => {
    expect(textPainted(unfilled({ "background-clip": "text", "background-image": GRADIENT }), [])).toBe(true);
    expect(textPainted(unfilled(), [clipped({ "background-color": "rgb(200, 30, 40)" })])).toBe(true);
  });

  it("treats a transparent fill clipped to a background that paints nothing as hidden", () => {
    expect(textPainted(unfilled({ "background-clip": "text" }), [])).toBe(false);
    expect(textPainted(unfilled(), [clipped({})])).toBe(false);
    expect(textPainted(unfilled({ "background-image": GRADIENT }), [])).toBe(false);
  });
});
