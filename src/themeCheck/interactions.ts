export interface Outcome {
  check: string;
  control: string;
  problem: string | null;
}

export type FrameWindow = Window & typeof globalThis;

export interface Frame {
  win: FrameWindow;
  doc: Document;
}

const STEPS = 12;
const SETTLE_MS = 400;
const EDGE_HOLD_LIMIT = 600;
const RESIZE_BY = 120;
const RESIZE_SLACK = 30;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = (win: Window) => new Promise((resolve) => win.requestAnimationFrame(() => resolve(null)));
const q = <T extends Element = HTMLElement>(doc: Document, selector: string) => doc.querySelector<T>(selector);
const center = (box: DOMRect) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
const pass = (check: string, control: string): Outcome => ({ check, control, problem: null });
const fail = (check: string, control: string, problem: string): Outcome => ({ check, control, problem });

function pointer(win: FrameWindow, type: string, x: number, y: number, buttons: number): PointerEvent {
  return new win.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, button: 0, buttons, clientX: x, clientY: y, pointerType: "mouse" });
}

export function tolerateSyntheticPointers(win: FrameWindow) {
  const proto = win.Element.prototype;
  const capture = proto.setPointerCapture;
  proto.setPointerCapture = function (this: Element, id: number) {
    try {
      capture.call(this, id);
    } catch {
      return;
    }
  };
}

async function drag(frame: Frame, handle: Element, path: () => { x: number; y: number }[]) {
  const { win } = frame;
  const start = center(handle.getBoundingClientRect());
  handle.dispatchEvent(pointer(win, "pointerdown", start.x, start.y, 1));
  let last = start;
  for (const point of path()) {
    win.dispatchEvent(pointer(win, "pointermove", point.x, point.y, 1));
    last = point;
    await nextFrame(win);
  }
  win.dispatchEvent(pointer(win, "pointerup", last.x, last.y, 0));
  await wait(SETTLE_MS);
}

const line = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  Array.from({ length: STEPS }, (_, i) => ({ x: from.x + ((to.x - from.x) * (i + 1)) / STEPS, y: from.y + ((to.y - from.y) * (i + 1)) / STEPS }));

function cellOf(doc: Document, cardId: string): string | null {
  const cell = q(doc, `[data-part="card"][data-id="${cardId}"]`)?.closest("[data-part='cell']");
  return cell ? `${cell.getAttribute("data-row")}/${cell.getAttribute("data-column")}` : null;
}

interface Move {
  card: string;
  target: Element;
  targetKey: string;
}

function pickMove(doc: Document): Move | null {
  const source = q(doc, '[data-part="row"][data-kind="surface"] [data-part="card"][data-id]');
  const from = source?.closest("[data-part='cell']")?.getAttribute("data-column");
  const target = [...doc.querySelectorAll('[data-part="row"][data-kind="deep"] [data-part="cell"][data-column]')].find(
    (cell) => cell.getAttribute("data-column") !== from && cell.getAttribute("data-collapsed") !== "true",
  );
  if (!source || !target) return null;
  return { card: source.getAttribute("data-id") ?? "", target, targetKey: `deep/${target.getAttribute("data-column")}` };
}

function landed(doc: Document, move: Move): string | null {
  const now = cellOf(doc, move.card);
  if (now !== move.targetKey) return `the card landed in ${now ?? "no cell"}, not in ${move.targetKey}`;
  const mark = q(doc, `[data-part="card"][data-id="${move.card}"] [data-part="mark"][data-kind="asked"]`);
  return mark ? null : 'the moved card does not show its "asked" mark';
}

export async function dragCard(frame: Frame): Promise<Outcome> {
  const { doc } = frame;
  const move = pickMove(doc);
  if (!move) return fail("drag a card to another stage", "card-open", "no card to drag in the fixture");
  const card = q(doc, `[data-part="card"][data-id="${move.card}"]`)!;
  move.target.scrollIntoView({ block: "center", inline: "center" });
  card.scrollIntoView({ block: "center", inline: "center" });
  await nextFrame(frame.win);
  const box = card.getBoundingClientRect();
  const from = { x: box.left + box.width / 2, y: box.top + 12 };
  await drag(frame, card, () => {
    const t = move.target.getBoundingClientRect();
    return line(from, { x: t.left + t.width / 2, y: t.top + Math.min(30, t.height / 2) });
  });
  const problem = landed(doc, move);
  return problem ? fail("drag a card to another stage", "card-open", problem) : pass("drag a card to another stage", "card-open");
}

export async function edgeDragCard(frame: Frame): Promise<Outcome> {
  const { win, doc } = frame;
  const check = "drag a card to a stage out of view, scrolling at the edge";
  const move = pickMove(doc);
  const scroller = q(doc, '[data-part="board-scroll"]');
  if (!move || !scroller) return fail(check, "card-open", "no card to drag in the fixture");
  const card = q(doc, `[data-part="card"][data-id="${move.card}"]`)!;
  scroller.scrollTo(0, 0);
  card.scrollIntoView({ block: "nearest", inline: "nearest" });
  await nextFrame(win);
  const view = () => scroller.getBoundingClientRect();
  const inView = () => {
    const t = move.target.getBoundingClientRect();
    const v = view();
    return t.left >= v.left && t.left + 60 <= v.right - 64 && t.top >= v.top && t.top + 40 <= v.bottom - 64;
  };
  const box = card.getBoundingClientRect();
  let at = { x: box.left + box.width / 2, y: box.top + 12 };
  card.dispatchEvent(pointer(win, "pointerdown", at.x, at.y, 1));
  const glide = async (to: { x: number; y: number }, steps = 6) => {
    const from = at;
    for (let i = 1; i <= steps; i++) {
      at = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      win.dispatchEvent(pointer(win, "pointermove", at.x, at.y, 1));
      await nextFrame(win);
    }
  };
  let held = 0;
  while (!inView() && held < EDGE_HOLD_LIMIT) {
    const t = move.target.getBoundingClientRect();
    const v = view();
    const x = t.left + 60 > v.right ? v.right - 8 : t.left < v.left ? v.left + 8 : at.x;
    const y = t.top + 40 > v.bottom ? v.bottom - 8 : t.top < v.top ? v.top + 8 : at.y;
    if (Math.abs(x - at.x) + Math.abs(y - at.y) > 2) await glide({ x, y });
    win.dispatchEvent(pointer(win, "pointermove", at.x, at.y, 1));
    await nextFrame(win);
    held += 1;
  }
  const aim = () => {
    const t = move.target.getBoundingClientRect();
    return { x: Math.min(t.left + t.width / 2, view().right - 70), y: t.top + Math.min(30, t.height / 2) };
  };
  await glide(aim());
  for (let i = 0; i < 3; i++) {
    await wait(60);
    await glide(aim(), 2);
  }
  win.dispatchEvent(pointer(win, "pointerup", at.x, at.y, 0));
  await wait(SETTLE_MS);
  if (held >= EDGE_HOLD_LIMIT) return fail(check, "card-open", "holding the card at the board's edge never scrolled the target stage into view");
  const problem = landed(doc, move);
  return problem ? fail(check, "card-open", problem) : pass(check, "card-open");
}

const headOrder = (doc: Document) => [...doc.querySelectorAll('[data-part="column-head"][data-column]')].map((h) => h.getAttribute("data-column") ?? "");

export async function reorderProjects(frame: Frame, lanes: boolean): Promise<Outcome[]> {
  const { doc } = frame;
  const outcomes: Outcome[] = [];
  const along = (box: DOMRect, past: number) => (lanes ? { x: box.left + box.width / 2, y: box.bottom + past } : { x: box.right + past, y: box.top + box.height / 2 });
  for (const [check, direction] of [
    ["move a project later by its header", 1],
    ["move a project earlier by its header", -1],
  ] as const) {
    const before = headOrder(doc);
    if (before.length < 3) return [fail(check, "column-rename", "the fixture has fewer than three projects")];
    const moving = direction === 1 ? before[0] : before[2];
    const past = direction === 1 ? before[1] : before[0];
    const head = q(doc, `[data-part="column-head"][data-column="${moving}"]`)!;
    const label = head.querySelector('[data-part="column-heads-label"], [data-part="column-total"]') ?? head;
    head.scrollIntoView({ block: "nearest", inline: "nearest" });
    await nextFrame(frame.win);
    const from = center(label.getBoundingClientRect());
    await drag(frame, label, () => {
      const target = q(doc, `[data-part="column-head"][data-column="${past}"]`)!.getBoundingClientRect();
      const to = direction === 1 ? along(target, -4) : lanes ? { x: target.left + target.width / 2, y: target.top + 4 } : { x: target.left + 4, y: target.top + target.height / 2 };
      return line(from, to);
    });
    const after = headOrder(doc);
    const wanted = direction === 1 ? [before[1], before[0], ...before.slice(2)] : [before[2], before[0], before[1], ...before.slice(3)];
    outcomes.push(
      after.join() === wanted.join()
        ? pass(check, "column-rename")
        : fail(check, "column-rename", `the projects ended in the order ${after.join(", ")}, not ${wanted.join(", ")}`),
    );
  }
  return outcomes;
}

async function resize(frame: Frame, control: string, measure: () => number, by: { x: number; y: number }, check: string, grows = 1): Promise<Outcome> {
  const handle = q(frame.doc, `[data-control="${control}"]`);
  if (!handle) return fail(check, control, "the resize handle is not on screen");
  const before = measure();
  const from = center(handle.getBoundingClientRect());
  await drag(frame, handle, () => line(from, { x: from.x + by.x, y: from.y + by.y }));
  const grown = (measure() - before) * grows;
  const toward = grows === 1 ? "away from" : "into";
  return grown >= RESIZE_BY - RESIZE_SLACK
    ? pass(check, control)
    : fail(check, control, `dragging the handle ${RESIZE_BY} pixels ${toward} the panel changed its size by ${Math.round(grown * grows)} pixels`);
}

export function resizeChat(frame: Frame, chatLeft: boolean): Promise<Outcome> {
  const chat = () => q(frame.doc, '[data-part="chat"]');
  return resize(frame, "resize-chat", () => chat()?.getBoundingClientRect().width ?? 0, { x: chatLeft ? RESIZE_BY : -RESIZE_BY, y: 0 }, "widen the chat by its handle");
}

export function resizeDetail(frame: Frame): Promise<Outcome> {
  const detail = () => q(frame.doc, '[data-part="detail"]');
  return resize(frame, "resize-card-panel", () => detail()?.getBoundingClientRect().width ?? 0, { x: RESIZE_BY, y: 0 }, "narrow the card panel by its handle", -1);
}

export function resizeHelper(frame: Frame): Promise<Outcome> {
  const drawer = () => q(frame.doc, '[data-part="bosun"]');
  return resize(frame, "resize-helper", () => drawer()?.getBoundingClientRect().height ?? 0, { x: 0, y: -RESIZE_BY }, "raise the helper drawer by its handle");
}

const detailShown = (doc: Document) => !!q(doc, '[data-part="detail"]');

async function escapeClosesDetail(frame: Frame, check: string): Promise<Outcome> {
  const { doc, win } = frame;
  (doc.activeElement ?? doc.body).dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  await wait(SETTLE_MS);
  return detailShown(doc) ? fail(check, "close-detail", "Escape does not close the detail") : pass(check, "close-detail");
}

export function sideDetailClosesOnEscape(frame: Frame): Promise<Outcome> {
  const focused = frame.doc.activeElement;
  if (focused instanceof frame.win.HTMLElement) focused.blur();
  return escapeClosesDetail(frame, "Escape closes the side-panel card detail");
}

export async function overlayIsModal(frame: Frame, open: () => Promise<void>): Promise<Outcome[]> {
  const { doc, win } = frame;
  const check = "the overlay card detail behaves as a dialog";
  const outcomes: Outcome[] = [];
  const behind = q(doc, '[data-part="board-column"]');
  outcomes.push(behind?.inert ? pass(check, "close-detail") : fail(check, "close-detail", "the board behind the open detail can still be reached"));
  const focused = doc.activeElement?.closest('[data-part="detail"]');
  outcomes.push(focused ? pass(check, "close-detail") : fail(check, "close-detail", "opening the detail does not move focus into it"));
  outcomes.push(await escapeClosesDetail(frame, check));
  await open();
  q(doc, '[data-control="close-detail-scrim"]')?.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(SETTLE_MS);
  outcomes.push(detailShown(doc) ? fail(check, "close-detail-scrim", "a click on the scrim does not close the detail") : pass(check, "close-detail-scrim"));
  return outcomes;
}

export async function toggleMode(frame: Frame, singleMode: boolean, shortcut: KeyboardEventInit): Promise<Outcome> {
  const { doc, win } = frame;
  const check = singleMode ? "a single-mode theme ignores the light and dark switch" : "switch between light and dark";
  const before = doc.documentElement.dataset.mode;
  const toggle = q(doc, '[data-control="toggle-dark-mode"]');
  if (singleMode) {
    if (toggle) return fail(check, "toggle-dark-mode", "the dark mode switch shows for a theme with one mode");
    win.dispatchEvent(new win.KeyboardEvent("keydown", { ...shortcut, bubbles: true, cancelable: true }));
    await wait(SETTLE_MS);
    return doc.documentElement.dataset.mode === before ? pass(check, "toggle-dark-mode") : fail(check, "toggle-dark-mode", "the shortcut changed the mode of a single-mode theme");
  }
  if (!toggle) return fail(check, "toggle-dark-mode", "the dark mode switch is missing");
  toggle.click();
  await wait(SETTLE_MS);
  const after = doc.documentElement.dataset.mode;
  toggle.click();
  await wait(SETTLE_MS);
  return after !== before ? pass(check, "toggle-dark-mode") : fail(check, "toggle-dark-mode", "clicking the switch does not change the mode");
}

export async function resetShortcutWorks(frame: Frame, shortcut: KeyboardEventInit): Promise<Outcome> {
  const { doc, win } = frame;
  const check = "the reset shortcut goes back to Nautical";
  win.dispatchEvent(new win.KeyboardEvent("keydown", { ...shortcut, bubbles: true, cancelable: true }));
  await wait(SETTLE_MS);
  const back = doc.documentElement.dataset.themeId === "nautical" && !doc.getElementById("fathom-theme-styles");
  return back ? pass(check, "reset-theme") : fail(check, "reset-theme", "the theme is still applied after the reset shortcut");
}
