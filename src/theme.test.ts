import { describe, expect, it } from "vitest";
import { INITIAL_THEME, otherTheme, themeToggleLabel } from "./theme";
import { TERMINAL_THEMES } from "./terminalOptions";

describe("theme", () => {
  it("opens in light mode", () => {
    expect(INITIAL_THEME).toBe("light");
  });

  it("labels the toggle with the theme it switches to", () => {
    expect(themeToggleLabel("light")).toBe("Dark mode");
    expect(themeToggleLabel(otherTheme("light"))).toBe("Light mode");
    expect(otherTheme(otherTheme("light"))).toBe("light");
  });

  it("gives each theme a terminal palette whose text differs from its background", () => {
    for (const palette of Object.values(TERMINAL_THEMES)) {
      expect(palette.foreground).not.toBe(palette.background);
    }
    expect(TERMINAL_THEMES.dark.background).not.toBe(TERMINAL_THEMES.light.background);
  });
});
