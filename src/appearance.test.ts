import { describe, expect, it } from "vitest";
import { BOARD_FONTS, boardStyle, CHAT_FONTS, fontChoice } from "./appearance";

describe("appearance", () => {
  it("falls back to the first font for an unknown key", () => {
    expect(fontChoice(CHAT_FONTS, "comic").key).toBe("sf-mono");
    expect(fontChoice(CHAT_FONTS, "menlo").name).toBe("Menlo");
  });

  it("scales the board from a 14 px base and keeps headings on the chosen font", () => {
    const style = boardStyle({ chatFont: "menlo", chatFontSize: 13, boardFont: "avenir", boardFontSize: 21 });
    expect(style["--board-scale"]).toBe("1.5");
    expect(style["--heading"]).toBe(style["--body-font"]);
  });

  it("keeps the Space Grotesk headings for the default board font", () => {
    const style = boardStyle({ chatFont: "sf-mono", chatFontSize: 13, boardFont: "default", boardFontSize: 14 });
    expect(style["--board-scale"]).toBe("1");
    expect(style["--heading"]).toBe(BOARD_FONTS[0].heading);
  });
});
