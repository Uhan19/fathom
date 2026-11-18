export const SCROLLBACK_LINES = 10_000;

export const TERMINAL_OPTIONS = {
  lineHeight: 1.15,
  scrollback: SCROLLBACK_LINES,
  cursorBlink: true,
  allowProposedApi: true,
  macOptionClickForcesSelection: true,
} as const;
