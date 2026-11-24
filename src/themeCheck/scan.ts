import { contrast, MIN_CONTRAST, over, parseColor, type Rgba } from "./contrast";

type FrameWindow = Window & typeof globalThis;

export type ViewName = "board" | "detail" | "settings" | "helper" | "empty";
export type ControlState = "ok" | "hidden" | "tiny" | "faint" | "offscreen" | "covered" | "unlabelled";

export interface ControlScan {
  key: string;
  control: string;
  state: ControlState;
  name: string;
  text: string;
}

export interface TextScan {
  key: string;
  part: string;
  ratio: number;
}

export interface ViewScan {
  view: ViewName;
  controls: ControlScan[];
  lowContrast: TextScan[];
  missingIds: string[];
}

export const CONTROLS =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="switch"], [role="radio"], [role="tab"], [role="separator"], [role="slider"], [role="checkbox"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
const INSTANCE_ATTRIBUTES = ["data-key", "data-id", "data-column", "data-row"];
const SKIPPED = '[data-part="terminal-host"], [aria-hidden="true"], [data-check-outline]';
const MIN_SIZE = 4;
const MIN_OPACITY = 0.3;
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

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
    clean(el.getAttribute("title")) ||
    clean(el.textContent) ||
    clean(el.getAttribute("placeholder")) ||
    clean(el.getAttribute("alt"))
  );
}

function pseudoText(el: Element, win: FrameWindow, pseudo: "::before" | "::after"): string {
  const content = win.getComputedStyle(el, pseudo).content;
  const quoted = content.match(/^"(.*)"$/);
  return quoted ? quoted[1] : "";
}

const FIELDS = "select, input, textarea";

export function renderedText(el: Element, win: FrameWindow): string {
  if (el.matches(FIELDS)) return "";
  const inner = el instanceof win.HTMLElement ? el.innerText : (el.textContent ?? "");
  return clean(`${pseudoText(el, win, "::before")} ${inner} ${pseudoText(el, win, "::after")}`);
}

function effectiveOpacity(el: Element, win: FrameWindow): number {
  let opacity = 1;
  for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(win.getComputedStyle(node).opacity);
  return opacity;
}

function hits(el: Element, bounds: DOMRect, win: FrameWindow): boolean {
  const box = el.getClientRects()[0] ?? bounds;
  const x = Math.min(Math.max(box.left + box.width / 2, 1), win.innerWidth - 2);
  const y = Math.min(Math.max(box.top + box.height / 2, 1), win.innerHeight - 2);
  const top = win.document.elementFromPoint(x, y);
  return !!top && (top === el || el.contains(top) || (top.tagName === "LABEL" && top.contains(el)));
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
  return hits(el, box, win) ? "ok" : "covered";
}

function scrollPositions(doc: Document): [Element, number, number][] {
  return [...doc.querySelectorAll("*")].filter((n) => n.scrollTop || n.scrollLeft).map((n) => [n, n.scrollTop, n.scrollLeft]);
}

export function scanControls(scope: Element, win: FrameWindow): { controls: ControlScan[]; missingIds: string[] } {
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
    controls.push({ key, control, state: stateOf(el, win, name), name, text: renderedText(el, win) });
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

function backgroundOf(el: Element, win: FrameWindow): Rgba {
  const layers: Rgba[] = [];
  const below = paintedBelow(el, win);
  const chain: Element[] = below ?? [];
  if (!below) for (let node: Element | null = el; node; node = node.parentElement) chain.push(node);
  for (const node of chain) {
    const color = parseColor(win.getComputedStyle(node).backgroundColor);
    if (color && color.a > 0) {
      layers.push(color);
      if (color.a >= 1) break;
    }
  }
  return layers.reduceRight((below, layer) => over(layer, below), WHITE);
}

function ownText(el: Element): string {
  return clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
}

export function scanContrast(scope: Element, win: FrameWindow): TextScan[] {
  const out: TextScan[] = [];
  const candidates = [scope, ...scope.querySelectorAll("*")];
  for (const el of candidates) {
    const text = ownText(el);
    if (!text || el.closest(SKIPPED) || el.closest("option, select, script, style, title")) continue;
    const style = win.getComputedStyle(el);
    if (style.visibility !== "visible" || !(el as HTMLElement).getClientRects().length) continue;
    if (el.closest(":disabled, [aria-disabled='true']")) continue;
    const color = parseColor(style.color);
    if (!color) continue;
    const faded = { ...color, a: color.a * effectiveOpacity(el, win) };
    const ratio = contrast(faded, backgroundOf(el, win));
    if (ratio >= MIN_CONTRAST) continue;
    const part = el.closest("[data-part]")?.getAttribute("data-part") ?? el.tagName.toLowerCase();
    out.push({ key: `${part}|${text.slice(0, 40)}`, part, ratio: Math.round(ratio * 100) / 100 });
  }
  return out;
}

export function scanView(view: ViewName, scope: Element, win: FrameWindow): ViewScan {
  const { controls, missingIds } = scanControls(scope, win);
  return { view, controls, lowContrast: scanContrast(scope, win), missingIds };
}
