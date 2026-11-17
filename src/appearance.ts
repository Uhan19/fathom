import type { Settings } from "./api";

export interface FontChoice {
  key: string;
  name: string;
  stack: string;
  heading?: string;
  added?: boolean;
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

const CHAT_FALLBACK = "ui-monospace, monospace";
const BOARD_FALLBACK = "system-ui, sans-serif";
const ADDED_PREFIX = "family:";

export const CHAT_FONT_SIZES = range(10, 20);
export const BOARD_FONT_SIZES = range(11, 20);
export const BOARD_BASE_SIZE = 14;

export type Surface = "chat" | "board";

export interface Appearance {
  chatFont: string;
  chatFontSize: number;
  boardFont: string;
  boardFontSize: number;
  chatAddedFonts: string[];
  boardAddedFonts: string[];
}

export function appearanceOf(settings: Settings): Appearance {
  const { chatFont, chatFontSize, boardFont, boardFontSize, chatAddedFonts, boardAddedFonts } = settings;
  return { chatFont, chatFontSize, boardFont, boardFontSize, chatAddedFonts, boardAddedFonts };
}

export function addedFontKey(family: string): string {
  return ADDED_PREFIX + family;
}

export function cssFamily(family: string): string {
  return `"${family.replace(/["\\]/g, "\\$&")}"`;
}

function addedChoice(family: string, fallback: string): FontChoice {
  return { key: addedFontKey(family), name: family, stack: `${cssFamily(family)}, ${fallback}`, added: true };
}

export function surfaceFonts(appearance: Appearance, surface: Surface): FontChoice[] {
  return surface === "chat"
    ? [...CHAT_FONTS, ...appearance.chatAddedFonts.map((f) => addedChoice(f, CHAT_FALLBACK))]
    : [...BOARD_FONTS, ...appearance.boardAddedFonts.map((f) => addedChoice(f, BOARD_FALLBACK))];
}

export function fontChoice(fonts: FontChoice[], key: string): FontChoice {
  return fonts.find((f) => f.key === key) ?? fonts[0];
}

export function chatFontStack(appearance: Appearance): string {
  return fontChoice(surfaceFonts(appearance, "chat"), appearance.chatFont).stack;
}

export function addFont(appearance: Appearance, surface: Surface, family: string): Appearance {
  const added = surface === "chat" ? appearance.chatAddedFonts : appearance.boardAddedFonts;
  const list = added.includes(family) ? added : [...added, family];
  return surface === "chat"
    ? { ...appearance, chatAddedFonts: list, chatFont: addedFontKey(family) }
    : { ...appearance, boardAddedFonts: list, boardFont: addedFontKey(family) };
}

export function removeFont(appearance: Appearance, surface: Surface, family: string): Appearance {
  const key = addedFontKey(family);
  return surface === "chat"
    ? {
        ...appearance,
        chatAddedFonts: appearance.chatAddedFonts.filter((f) => f !== family),
        chatFont: appearance.chatFont === key ? CHAT_FONTS[0].key : appearance.chatFont,
      }
    : {
        ...appearance,
        boardAddedFonts: appearance.boardAddedFonts.filter((f) => f !== family),
        boardFont: appearance.boardFont === key ? BOARD_FONTS[0].key : appearance.boardFont,
      };
}

export function boardStyle(appearance: Appearance): Record<string, string> {
  const font = fontChoice(surfaceFonts(appearance, "board"), appearance.boardFont);
  return {
    "--body-font": font.stack,
    "--heading": font.heading ?? font.stack,
    "--board-scale": String(appearance.boardFontSize / BOARD_BASE_SIZE),
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
