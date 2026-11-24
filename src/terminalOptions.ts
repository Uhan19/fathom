export const SCROLLBACK_LINES = 10_000;

export const TERMINAL_OPTIONS = {
  lineHeight: 1.15,
  scrollback: SCROLLBACK_LINES,
  cursorBlink: true,
  allowProposedApi: true,
  macOptionClickForcesSelection: true,
} as const;

export const TERMINAL_COLOR_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export type TerminalColorKey = (typeof TERMINAL_COLOR_KEYS)[number];

export function terminalToken(key: TerminalColorKey): string {
  return `--term-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function terminalPalette(readToken: (name: string) => string): Record<TerminalColorKey, string> {
  return Object.fromEntries(TERMINAL_COLOR_KEYS.map((key) => [key, readToken(terminalToken(key)).trim()])) as Record<TerminalColorKey, string>;
}
