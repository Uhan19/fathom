import type { Look } from "./look";

export const LOOK_EVENT = "fathom:look";
const LINK_ID = "fathom-theme-styles";
const FONTS_ID = "fathom-theme-fonts";
const FONT_TOKENS = { body: "--body-font", heading: "--heading", mono: "--mono" } as const;
const SIZE_TOKENS = {
  rowLabelWidth: "--row-label-width",
  collapsedWidth: "--collapsed-width",
  laneWidth: "--lane-width",
} as const;

export function rootAttributes(look: Look): Record<string, string> {
  return {
    themeId: look.id,
    chatSide: look.layout.chatSide,
    board: look.layout.board,
    header: look.layout.header,
    detail: look.layout.detail,
  };
}

export function rootTokens(look: Look): Record<string, string> {
  return Object.fromEntries(Object.entries(SIZE_TOKENS).map(([key, token]) => [token, `${look.layout[key as keyof typeof SIZE_TOKENS]}px`]));
}

export function themeFonts(look: Look): Record<string, string> {
  return Object.fromEntries(
    Object.entries(FONT_TOKENS).flatMap(([key, token]) => {
      const font = look.fonts[key as keyof typeof FONT_TOKENS];
      return font ? [[token, font]] : [];
    }),
  );
}

export async function applyLook(look: Look, doc: Document = document): Promise<void> {
  if (await swapStyles(doc, look.styles, () => markRoot(doc, look))) doc.defaultView?.dispatchEvent(new Event(LOOK_EVENT));
}

function markRoot(doc: Document, look: Look) {
  const root = doc.documentElement;
  Object.assign(root.dataset, rootAttributes(look));
  Object.entries(rootTokens(look)).forEach(([token, value]) => root.style.setProperty(token, value));
  const fonts = fontRule(doc).style;
  fonts.cssText = "";
  Object.entries(themeFonts(look)).forEach(([token, value]) => fonts.setProperty(token, value, "important"));
}

function fontRule(doc: Document): CSSStyleRule {
  let style = doc.getElementById(FONTS_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = FONTS_ID;
    style.textContent = ":root {}";
    doc.head.append(style);
  }
  return style.sheet!.cssRules[0] as CSSStyleRule;
}

const THEME_LINKS = "link[data-theme-link]";
const loads = new WeakMap<HTMLLinkElement, Promise<void>>();
let wanted: string | null = null;

function linkTo(doc: Document, href: string): HTMLLinkElement {
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.themeLink = "";
  loads.set(
    link,
    new Promise<void>((resolve) => {
      link.onload = () => resolve();
      link.onerror = () => resolve();
    }),
  );
  doc.head.append(link);
  return link;
}

async function swapStyles(doc: Document, href: string | null, mark: () => void): Promise<boolean> {
  wanted = href;
  const links = () => [...doc.querySelectorAll<HTMLLinkElement>(THEME_LINKS)];
  const link = href ? (links().find((l) => l.getAttribute("href") === href) ?? linkTo(doc, href)) : null;
  if (link) await loads.get(link);
  if (wanted !== href) return false;
  mark();
  links().filter((l) => l !== link).forEach((l) => l.remove());
  if (link) link.id = LINK_ID;
  return true;
}
