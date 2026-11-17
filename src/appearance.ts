import type { Settings } from "./api";

export interface FontChoice {
  key: string;
  name: string;
  stack: string;
  heading?: string;
}

export const CHAT_FONTS: FontChoice[] = [
  { key: "sf-mono", name: "SF Mono", stack: 'ui-monospace, "SF Mono", Menlo, monospace' },
  { key: "menlo", name: "Menlo", stack: "Menlo, monospace" },
  { key: "monaco", name: "Monaco", stack: "Monaco, monospace" },
  { key: "courier", name: "Courier New", stack: '"Courier New", Courier, monospace' },
];

const BODY_STACK = "Inter, system-ui, sans-serif";

export const BOARD_FONTS: FontChoice[] = [
  { key: "default", name: "Inter + Space Grotesk", stack: BODY_STACK, heading: '"Space Grotesk", Inter, system-ui, sans-serif' },
  { key: "inter", name: "Inter", stack: BODY_STACK },
  { key: "system", name: "SF Pro (system)", stack: "system-ui, -apple-system, sans-serif" },
  { key: "avenir", name: "Avenir Next", stack: '"Avenir Next", Avenir, system-ui, sans-serif' },
];

export const CHAT_FONT_SIZES = range(10, 20);
export const BOARD_FONT_SIZES = range(11, 20);
export const BOARD_BASE_SIZE = 14;

export interface Appearance {
  chatFont: string;
  chatFontSize: number;
  boardFont: string;
  boardFontSize: number;
}

export function appearanceOf(settings: Settings): Appearance {
  const { chatFont, chatFontSize, boardFont, boardFontSize } = settings;
  return { chatFont, chatFontSize, boardFont, boardFontSize };
}

export function fontChoice(fonts: FontChoice[], key: string): FontChoice {
  return fonts.find((f) => f.key === key) ?? fonts[0];
}

export function boardStyle(appearance: Appearance): Record<string, string> {
  const font = fontChoice(BOARD_FONTS, appearance.boardFont);
  return {
    "--body-font": font.stack,
    "--heading": font.heading ?? font.stack,
    "--board-scale": String(appearance.boardFontSize / BOARD_BASE_SIZE),
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
