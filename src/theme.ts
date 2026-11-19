export type Theme = "light" | "dark";

export const DEFAULT_THEME: Theme = "light";

export function otherTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}

export function themeToggleLabel(theme: Theme): string {
  return theme === "light" ? "Dark mode" : "Light mode";
}
