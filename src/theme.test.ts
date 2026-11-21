import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, otherTheme } from "./theme";
import { TERMINAL_THEMES } from "./terminalOptions";

describe("theme", () => {
  it("uses the light theme until the stored theme loads", () => {
    expect(DEFAULT_THEME).toBe("light");
  });

  it("switches between the two themes", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme(otherTheme("light"))).toBe("light");
  });

  it("gives each theme a terminal palette whose text differs from its background", () => {
    for (const palette of Object.values(TERMINAL_THEMES)) {
      expect(palette.foreground).not.toBe(palette.background);
    }
    expect(TERMINAL_THEMES.dark.background).not.toBe(TERMINAL_THEMES.light.background);
  });
});
