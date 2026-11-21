export type Theme = "light" | "dark";

export const DEFAULT_THEME: Theme = "light";

export function otherTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}
