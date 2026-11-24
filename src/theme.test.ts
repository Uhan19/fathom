import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, otherTheme } from "./theme";
import { TERMINAL_COLOR_KEYS, terminalPalette, terminalToken } from "./terminalOptions";

const STYLES = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function themeTokens(selector: string): Map<string, string> {
  const start = STYLES.indexOf(`${selector} {`);
  const block = STYLES.slice(start, STYLES.indexOf("}", start));
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const PALETTES = {
  light: terminalPalette((name) => themeTokens(':root,\n:root[data-theme="light"]').get(name) ?? ""),
  dark: terminalPalette((name) => themeTokens(':root[data-theme="dark"]').get(name) ?? ""),
};

describe("theme", () => {
  it("uses the light theme until the stored theme loads", () => {
    expect(DEFAULT_THEME).toBe("light");
  });

  it("switches between the two themes", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme(otherTheme("light"))).toBe("light");
  });

  it("defines every terminal color as a token in both themes", () => {
    for (const palette of Object.values(PALETTES)) {
      for (const key of TERMINAL_COLOR_KEYS) expect(palette[key], terminalToken(key)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("gives each theme a terminal palette whose text differs from its background", () => {
    for (const palette of Object.values(PALETTES)) {
      expect(palette.foreground).not.toBe(palette.background);
    }
    expect(PALETTES.dark.background).not.toBe(PALETTES.light.background);
  });

  it("names terminal tokens after xterm's palette keys", () => {
    expect(terminalToken("background")).toBe("--term-background");
    expect(terminalToken("brightWhite")).toBe("--term-bright-white");
  });
});
