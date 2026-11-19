import { describe, expect, it } from "vitest";
import {
  addFont,
  boardStyle,
  chatFontStack,
  cssFamily,
  fontChoice,
  platformOf,
  presetFonts,
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
    expect(fontChoice(presetFonts("chat", "macos"), "comic").key).toBe("sf-mono");
    expect(fontChoice(presetFonts("chat", "macos"), "menlo").name).toBe("Menlo");
  });

  it("tells macOS from Linux by the navigator platform", () => {
    expect(platformOf("MacIntel")).toBe("macos");
    expect(platformOf("Linux x86_64")).toBe("linux");
    expect(platformOf("Linux aarch64")).toBe("linux");
  });

  it("offers Linux presets with the bundled JetBrains Mono first", () => {
    const chat = presetFonts("chat", "linux");
    expect(chat.map((f) => f.name)).toEqual(["JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono"]);
    expect(chatFontStack({ ...base, chatFont: "sf-mono" }, "linux")).toBe('"JetBrains Mono", monospace, "Symbols Nerd Font Mono"');
    expect(presetFonts("board", "linux").map((f) => f.name)).toEqual(["Inter + Saira", "Inter", "System UI", "DejaVu Sans"]);
    expect(presetFonts("board", "linux")[0]).toEqual(presetFonts("board", "macos")[0]);
  });

  it("keeps the macOS presets", () => {
    expect(presetFonts("chat", "macos").map((f) => f.name)).toEqual(["SF Mono", "Menlo", "Monaco", "Courier New"]);
    expect(presetFonts("board", "macos").map((f) => f.name)).toEqual(["Inter + Saira", "Inter", "SF Pro (system)", "Avenir Next"]);
  });

  it("scales the board from a 14 px base and keeps headings on the chosen font", () => {
    const style = boardStyle({ ...base, chatFont: "menlo", boardFont: "avenir", boardFontSize: 21 }, "macos");
    expect(style["--board-scale"]).toBe("1.5");
    expect(style["--heading"]).toBe(style["--body-font"]);
  });

  it("keeps the Saira headings for the default board font", () => {
    const style = boardStyle(base);
    expect(style["--board-scale"]).toBe("1");
    expect(style["--heading"]).toBe(presetFonts("board", "macos")[0].heading);
  });

  it("adds an installed font to one surface, selects it, and adds it only once", () => {
    const once = addFont(base, "chat", "Fira Code");
    const twice = addFont(once, "chat", "Fira Code");
    expect(twice.chatAddedFonts).toEqual(["Fira Code"]);
    expect(twice.boardAddedFonts).toEqual([]);
    expect(chatFontStack(twice)).toBe('"Fira Code", ui-monospace, monospace, "Symbols Nerd Font Mono"');
    expect(surfaceFonts(twice, "chat").filter((f) => f.added).map((f) => f.name)).toEqual(["Fira Code"]);
  });

  it("uses an added board font for headings too", () => {
    const style = boardStyle(addFont(base, "board", "Georgia"));
    expect(style["--body-font"]).toBe('"Georgia", system-ui, sans-serif');
    expect(style["--heading"]).toBe(style["--body-font"]);
  });

  it("falls back to the default font when the chosen added font is removed", () => {
    const removed = removeFont(addFont(base, "board", "Georgia"), "board", "Georgia", "macos");
    expect(removed.boardAddedFonts).toEqual([]);
    expect(removed.boardFont).toBe("default");
    expect(removeFont(addFont(base, "chat", "Iosevka"), "chat", "Iosevka", "macos").chatFont).toBe("sf-mono");
    expect(removeFont(addFont(base, "chat", "Iosevka"), "chat", "Iosevka", "linux").chatFont).toBe("jetbrains-mono");
    const kept = removeFont(addFont({ ...addFont(base, "chat", "Iosevka"), chatFont: "menlo" }, "chat", "PT Mono"), "chat", "Iosevka", "macos");
    expect(kept.chatFont).toBe("family:PT Mono");
  });

  it("quotes family names safely for CSS", () => {
    expect(cssFamily('Odd "Name"\\')).toBe('"Odd \\"Name\\"\\\\"');
  });
});
