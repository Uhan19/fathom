import { describe, expect, it } from "vitest";
import {
  addFont,
  BOARD_FONTS,
  boardStyle,
  CHAT_FONTS,
  chatFontStack,
  cssFamily,
  fontChoice,
  removeFont,
  surfaceFonts,
  type Appearance,
} from "./appearance";

const base: Appearance = {
  chatFont: "sf-mono",
  chatFontSize: 13,
  boardFont: "default",
  boardFontSize: 14,
  chatAddedFonts: [],
  boardAddedFonts: [],
};

describe("appearance", () => {
  it("falls back to the first font for an unknown key", () => {
    expect(fontChoice(CHAT_FONTS, "comic").key).toBe("sf-mono");
    expect(fontChoice(CHAT_FONTS, "menlo").name).toBe("Menlo");
  });

  it("scales the board from a 14 px base and keeps headings on the chosen font", () => {
    const style = boardStyle({ ...base, chatFont: "menlo", boardFont: "avenir", boardFontSize: 21 });
    expect(style["--board-scale"]).toBe("1.5");
    expect(style["--heading"]).toBe(style["--body-font"]);
  });

  it("keeps the Saira headings for the default board font", () => {
    const style = boardStyle(base);
    expect(style["--board-scale"]).toBe("1");
    expect(style["--heading"]).toBe(BOARD_FONTS[0].heading);
  });

  it("adds an installed font to one surface, selects it, and adds it only once", () => {
    const once = addFont(base, "chat", "Fira Code");
    const twice = addFont(once, "chat", "Fira Code");
    expect(twice.chatAddedFonts).toEqual(["Fira Code"]);
    expect(twice.boardAddedFonts).toEqual([]);
    expect(chatFontStack(twice)).toBe('"Fira Code", ui-monospace, monospace');
    expect(surfaceFonts(twice, "chat").filter((f) => f.added).map((f) => f.name)).toEqual(["Fira Code"]);
  });

  it("uses an added board font for headings too", () => {
    const style = boardStyle(addFont(base, "board", "Georgia"));
    expect(style["--body-font"]).toBe('"Georgia", system-ui, sans-serif');
    expect(style["--heading"]).toBe(style["--body-font"]);
  });

  it("falls back to the default font when the chosen added font is removed", () => {
    const removed = removeFont(addFont(base, "board", "Georgia"), "board", "Georgia");
    expect(removed.boardAddedFonts).toEqual([]);
    expect(removed.boardFont).toBe("default");
    const kept = removeFont(addFont({ ...addFont(base, "chat", "Iosevka"), chatFont: "menlo" }, "chat", "PT Mono"), "chat", "Iosevka");
    expect(kept.chatFont).toBe("family:PT Mono");
  });

  it("quotes family names safely for CSS", () => {
    expect(cssFamily('Odd "Name"\\')).toBe('"Odd \\"Name\\"\\\\"');
  });
});
