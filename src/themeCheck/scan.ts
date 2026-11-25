import { contrast, over, parseColor, type Rgba } from "./contrast";
import { ground, luminances, ratioOf, spread, type Pixels } from "./pixels";

type FrameWindow = Window & typeof globalThis;

export type ViewName = "board" | "detail" | "settings" | "helper" | "dashboard" | "empty";
export type ControlState = "ok" | "hidden" | "tiny" | "faint" | "offscreen" | "covered" | "unlabelled";

export interface ControlScan {
  key: string;
  control: string;
  state: ControlState;
  name: string;
  text: string;
  cover?: string;
  ink?: number;
}

export interface TextScan {
  key: string;
  part: string;
  ratio?: number;
  unreadable?: string;
  ink?: number;
}

export interface ViewScan {
  view: ViewName;
  controls: ControlScan[];
  texts: TextScan[];
  missingIds: string[];
}

export interface Probe {
  controls: Map<string, Element>;
  texts: Map<string, PaintedText>;
}

export interface PaintedText {
  el: Element;
  text: number;
  background: number;
  underlaid: boolean;
  byGlyphs: boolean;
}

export const CONTROLS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="switch"], [role="radio"], [role="tab"], [role="separator"], [role="slider"], [role="checkbox"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
const INSTANCE_ATTRIBUTES = ["data-key", "data-id", "data-column", "data-row"];
const SKIPPED = '[data-part="terminal-host"], [aria-hidden="true"], [data-check-outline]';
const MIN_SIZE = 4;
const MIN_OPACITY = 0.3;
const MIN_FONT_PX = 4;
const MIN_STROKE_PX = 0.5;
const OVERLAY_SHIFT = 1.25;
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const FIELDS = "select, input, textarea";

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

export function instanceOf(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    for (const name of INSTANCE_ATTRIBUTES) {
      const value = node.getAttribute(name);
      if (value !== null) parts.unshift(`${name.slice(5)}=${value}`);
    }
  }
  return parts.join(",");
}

export function controlKey(control: string, instance: string): string {
  return instance ? `${control}@${instance}` : control;
}

function accessibleName(el: Element): string {
  const labelled = el.getAttribute("aria-labelledby");
  const byId = labelled ? clean(el.ownerDocument.getElementById(labelled)?.textContent) : "";
  const label = "labels" in el ? clean((el as HTMLInputElement).labels?.[0]?.textContent) : "";
  return (
    clean(el.getAttribute("aria-label")) ||
    byId ||
    label ||
    clean(el.textContent) ||
    clean(el.getAttribute("title")) ||
    clean(el.getAttribute("placeholder")) ||
    clean(el.getAttribute("alt"))
  );
}

type Computed = Pick<CSSStyleDeclaration, "getPropertyValue">;

const fillOf = (style: Computed) => style.getPropertyValue("-webkit-text-fill-color") || style.getPropertyValue("color");
const seen = (color: string) => (parseColor(color)?.a ?? 1) > 0;

function strokesText(style: Computed): boolean {
  return parseFloat(style.getPropertyValue("-webkit-text-stroke-width")) >= MIN_STROKE_PX && seen(style.getPropertyValue("-webkit-text-stroke-color"));
}

function clipsPaintToText(style: Computed): boolean {
  const clipped = [style.getPropertyValue("background-clip"), style.getPropertyValue("-webkit-background-clip")].includes("text");
  const painted = style.getPropertyValue("background-image") !== "none" || (parseColor(style.getPropertyValue("background-color"))?.a ?? 0) > 0;
  return clipped && painted;
}

export function textPainted(own: Computed, around: Iterable<Computed>): boolean {
  if (parseColor(fillOf(own))?.a !== 0 || strokesText(own) || clipsPaintToText(own)) return true;
  for (const style of around) if (clipsPaintToText(style)) return true;
  return false;
}

function* stylesUp(el: Element, win: FrameWindow): Generator<CSSStyleDeclaration> {
  for (let node: Element | null = el; node; node = node.parentElement) yield win.getComputedStyle(node);
}

function readable(style: CSSStyleDeclaration, owner: Element, win: FrameWindow): boolean {
  if (parseFloat(style.fontSize) < MIN_FONT_PX || style.visibility !== "visible") return false;
  return textPainted(style, stylesUp(owner, win));
}

function pseudoText(el: Element, win: FrameWindow, pseudo: "::before" | "::after"): string {
  const style = win.getComputedStyle(el, pseudo);
  const quoted = style.content.match(/^"(.*)"$/);
  return quoted && readable(style, el, win) ? quoted[1] : "";
}

const overlaps = (a: DOMRect, b: DOMRect) => a.width > 0 && a.height > 0 && a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

function shownText(node: Text, bounds: DOMRect, win: FrameWindow): boolean {
  const parent = node.parentElement;
  if (!parent || !readable(win.getComputedStyle(parent), parent, win)) return false;
  const range = win.document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].some((rect) => overlaps(rect, bounds));
}

export function renderedText(el: Element, win: FrameWindow): string {
  if (el.matches(FIELDS)) return "";
  const bounds = el.getBoundingClientRect();
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      if (shownText(node as Text, bounds, win)) parts.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof win.Element)) return;
    parts.push(pseudoText(node, win, "::before"));
    node.childNodes.forEach(walk);
    parts.push(pseudoText(node, win, "::after"));
  };
  walk(el);
  return clean(parts.join(" "));
}

function effectiveOpacity(el: Element, win: FrameWindow): number {
  let opacity = 1;
  for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(win.getComputedStyle(node).opacity);
  return opacity;
}

function topAt(el: Element, bounds: DOMRect, win: FrameWindow): Element | null {
  const box = el.getClientRects()[0] ?? bounds;
  const x = Math.min(Math.max(box.left + box.width / 2, 1), win.innerWidth - 2);
  const y = Math.min(Math.max(box.top + box.height / 2, 1), win.innerHeight - 2);
  return win.document.elementFromPoint(x, y);
}

function reaches(el: Element, top: Element | null): boolean {
  return !!top && (top === el || el.contains(top) || (top.tagName === "LABEL" && top.contains(el)));
}

export function describeElement(el: Element | null): string {
  if (!el) return "nothing";
  const part = el.closest("[data-part]")?.getAttribute("data-part");
  return part ? `[data-part="${part}"]` : el.tagName.toLowerCase();
}

function stateOf(el: Element, win: FrameWindow, name: string): ControlState {
  const style = win.getComputedStyle(el);
  if (!(el as HTMLElement).getClientRects().length || style.visibility !== "visible") return "hidden";
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const box = el.getBoundingClientRect();
  if (box.width < MIN_SIZE || box.height < MIN_SIZE) return "tiny";
  if (effectiveOpacity(el, win) < MIN_OPACITY) return "faint";
  if (box.right <= 0 || box.bottom <= 0 || box.left >= win.innerWidth || box.top >= win.innerHeight) return "offscreen";
  if (!name) return "unlabelled";
  if (reaches(el, topAt(el, box, win))) return "ok";
  el.scrollIntoView({ block: "center", inline: "center" });
  return reaches(el, topAt(el, el.getBoundingClientRect(), win)) ? "ok" : "covered";
}

function scrollPositions(doc: Document): [Element, number, number][] {
  return [...doc.querySelectorAll("*")].filter((n) => n.scrollTop || n.scrollLeft).map((n) => [n, n.scrollTop, n.scrollLeft]);
}

export function scanControls(scope: Element, win: FrameWindow, probe?: Probe): { controls: ControlScan[]; missingIds: string[] } {
  const doc = win.document;
  const scrolled = scrollPositions(doc);
  const seen = new Map<string, number>();
  const controls: ControlScan[] = [];
  const missingIds: string[] = [];
  for (const el of scope.querySelectorAll(CONTROLS)) {
    if (el.closest(SKIPPED)) continue;
    const control = el.getAttribute("data-control");
    const name = accessibleName(el);
    if (!control) {
      missingIds.push(`${el.tagName.toLowerCase()} "${name.slice(0, 40)}"`);
      continue;
    }
    const base = controlKey(control, instanceOf(el));
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const key = count === 1 ? base : `${base}#${count}`;
    const state = stateOf(el, win, name);
    const cover = state === "covered" ? describeElement(topAt(el, el.getBoundingClientRect(), win)) : undefined;
    controls.push({ key, control, state, name, text: renderedText(el, win), ...(cover ? { cover } : {}) });
    probe?.controls.set(key, el);
  }
  for (const [node, top, left] of scrolled) {
    node.scrollTop = top;
    node.scrollLeft = left;
  }
  doc.querySelectorAll('[data-part="board-scroll"]').forEach((n) => {
    if (!scrolled.some(([m]) => m === n)) n.scrollTo(0, 0);
  });
  return { controls, missingIds };
}

function paintedBelow(el: Element, win: FrameWindow): Element[] | null {
  const box = el.getClientRects()[0];
  if (!box) return null;
  const x = box.left + Math.min(box.width / 2, 6);
  const y = box.top + box.height / 2;
  if (x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight) return null;
  const stack = win.document.elementsFromPoint(x, y);
  const at = stack.indexOf(el);
  return at < 0 ? null : stack.slice(at);
}

function backgroundOf(el: Element, win: FrameWindow): { color: Rgba; underlaid: boolean } {
  const layers: Rgba[] = [];
  let underlaid = false;
  const below = paintedBelow(el, win);
  const chain: Element[] = below ?? [];
  if (!below) for (let node: Element | null = el; node; node = node.parentElement) chain.push(node);
  for (const node of chain) {
    const style = win.getComputedStyle(node);
    if (style.backgroundImage !== "none") underlaid = true;
    const color = parseColor(style.backgroundColor);
    if (!color) underlaid = true;
    if (color && color.a > 0) {
      layers.push(color);
      if (color.a >= 1) break;
    }
  }
  return { color: layers.reduceRight((below, layer) => over(layer, below), WHITE), underlaid };
}

function luminanceOf({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ownText(el: Element): string {
  return clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
}

export function scanTexts(scope: Element, win: FrameWindow, probe?: Probe): TextScan[] {
  const lowest = new Map<string, TextScan>();
  for (const el of [scope, ...scope.querySelectorAll("*")]) {
    const text = ownText(el);
    if (!text || el.closest(SKIPPED) || el.closest("option, select, script, style, title")) continue;
    const style = win.getComputedStyle(el);
    if (style.visibility !== "visible" || !(el as HTMLElement).getClientRects().length) continue;
    if (el.closest(":disabled, [aria-disabled='true']")) continue;
    const part = el.closest("[data-part]")?.getAttribute("data-part") ?? el.tagName.toLowerCase();
    const key = `${part}|${text.slice(0, 40)}`;
    const fill = fillOf(style);
    const filled = parseColor(fill);
    if (!filled) {
      lowest.set(key, { key, part, ratio: 0, unreadable: fill });
      continue;
    }
    const byGlyphs = filled.a === 0 && textPainted(style, stylesUp(el, win));
    const { color: background, underlaid } = backgroundOf(el, win);
    const faded = { ...filled, a: filled.a * effectiveOpacity(el, win) };
    const ratio = byGlyphs ? undefined : Math.round(contrast(faded, background) * 100) / 100;
    const solid = over(background, WHITE);
    const known = lowest.get(key);
    if (!known || (ratio !== undefined && (known.ratio === undefined || ratio < known.ratio))) {
      lowest.set(key, { key, part, ratio });
      probe?.texts.set(key, { el, text: luminanceOf(over(faded, solid)), background: luminanceOf(solid), underlaid, byGlyphs });
    }
  }
  return [...lowest.values()];
}

export function scanView(view: ViewName, scope: Element, win: FrameWindow, probe?: Probe): ViewScan {
  const { controls, missingIds } = scanControls(scope, win, probe);
  return { view, controls, texts: scanTexts(scope, win, probe), missingIds };
}

const within = (box: DOMRect, win: FrameWindow) => box.width >= MIN_SIZE && box.height >= MIN_SIZE && box.left >= 0 && box.top >= 0 && box.right <= win.innerWidth && box.bottom <= win.innerHeight;

function onTop(el: Element, box: DOMRect, win: FrameWindow): boolean {
  const corners = [
    [box.left + 1, box.top + 1],
    [box.right - 1, box.bottom - 1],
    [box.left + box.width / 2, box.top + box.height / 2],
  ];
  return corners.every(([x, y]) => {
    const top = win.document.elementFromPoint(x, y);
    return !!top && (top === el || el.contains(top) || top.contains(el));
  });
}

const transparent = (color: string) => parseColor(color)?.a === 0;

function showsSomething(el: Element, win: FrameWindow): boolean {
  if (clean(el.textContent) || el.querySelector("svg, img")) return true;
  const style = win.getComputedStyle(el);
  const bordered = ["Top", "Right", "Bottom", "Left"].some(
    (side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && !transparent(style.getPropertyValue(`border-${side.toLowerCase()}-color`)),
  );
  return bordered || !transparent(style.backgroundColor) || style.backgroundImage !== "none";
}

export function paintedContrast(found: Pick<PaintedText, "text" | "background" | "underlaid">, painted: number): number {
  if (found.underlaid) return ratioOf(found.text, painted);
  const { text, background } = found;
  const darker = painted < background;
  const cover = darker ? 1 - painted / Math.max(background, 1e-6) : (painted - background) / Math.max(1 - background, 1e-6);
  const seen = darker ? text * (1 - cover) : text + cover * (1 - text);
  return ratioOf(seen, painted);
}

function glyphBox(el: Element, win: FrameWindow): DOMRect | null {
  const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && clean(n.textContent));
  if (!texts.length) return null;
  const range = win.document.createRange();
  range.setStartBefore(texts[0]);
  range.setEndAfter(texts[texts.length - 1]);
  return range.getBoundingClientRect();
}

const inkIn = (pixels: Pixels, box: DOMRect) => Math.round(spread(luminances(pixels, box)) * 100) / 100;

export function measurePaint(scan: ViewScan, probe: Probe, pixels: Pixels, win: FrameWindow): ViewScan {
  const controls = scan.controls.map((c) => {
    const el = probe.controls.get(c.key);
    const box = el?.getBoundingClientRect();
    const measurable = el && box && c.state === "ok" && within(box, win) && onTop(el, box, win) && showsSomething(el, win);
    return measurable ? { ...c, ink: inkIn(pixels, box) } : c;
  });
  const texts = scan.texts.map((t) => {
    const found = probe.texts.get(t.key);
    const box = found?.el.getBoundingClientRect();
    if (!found || !box || !within(box, win) || !onTop(found.el, box, win)) return t;
    const glyphs = glyphBox(found.el, win);
    const ink = glyphs && within(glyphs, win) ? inkIn(pixels, glyphs) : undefined;
    const inked = ink === undefined ? t : { ...t, ink };
    if (found.byGlyphs) return ink === undefined ? inked : { ...inked, ratio: ink };
    const painted = ground(luminances(pixels, box));
    if (ratioOf(painted, found.background) < OVERLAY_SHIFT) return inked;
    return { ...inked, ratio: Math.round(paintedContrast(found, painted) * 100) / 100 };
  });
  return { ...scan, controls, texts };
}
