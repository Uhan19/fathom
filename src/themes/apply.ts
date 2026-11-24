import type { Look } from "./look";

export const LOOK_EVENT = "fathom:look";
const LINK_ID = "fathom-theme-styles";
const FONT_TOKENS = { body: "--body-font", heading: "--heading", mono: "--mono" } as const;
const SIZE_TOKENS = {
  rowLabelWidth: "--row-label-width",
  collapsedWidth: "--collapsed-width",
  laneWidth: "--lane-width",
} as const;

export function themedTokens(look: Look): string[] {
  return Object.entries(FONT_TOKENS).flatMap(([key, token]) => (look.fonts[key as keyof typeof FONT_TOKENS] ? [token] : []));
}

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
  const sizes = Object.entries(SIZE_TOKENS).map(([key, token]) => [token, `${look.layout[key as keyof typeof SIZE_TOKENS]}px`]);
  const fonts = Object.entries(FONT_TOKENS).flatMap(([key, token]) => {
    const font = look.fonts[key as keyof typeof FONT_TOKENS];
    return font ? [[token, font]] : [];
  });
  return Object.fromEntries([...sizes, ...fonts]);
}

export async function applyLook(look: Look, doc: Document = document): Promise<void> {
  if (await swapStyles(doc, look.styles, () => markRoot(doc.documentElement, look))) doc.defaultView?.dispatchEvent(new Event(LOOK_EVENT));
}

function markRoot(root: HTMLElement, look: Look) {
  Object.assign(root.dataset, rootAttributes(look));
  (root.dataset.themeFonts ?? "").split(" ").filter(Boolean).forEach((token) => root.style.removeProperty(token));
  root.dataset.themeFonts = themedTokens(look).join(" ");
  Object.entries(rootTokens(look)).forEach(([token, value]) => root.style.setProperty(token, value));
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
