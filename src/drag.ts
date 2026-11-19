import type { PointerEvent as ReactPointerEvent } from "react";

export const START_DISTANCE = 5;
const EDGE = 56;
const MAX_SCROLL_STEP = 18;

type Axis = "x" | "y";

const along = (e: { clientX: number; clientY: number }, axis: Axis) => (axis === "x" ? e.clientX : e.clientY);

export interface Range {
  min: number;
  max: number;
}

const clamp = (value: number, range: Range) => Math.max(range.min, Math.min(range.max, value));

export function resizer(size: number, room: number, range: Range): (growth: number) => number {
  const limit = { min: range.min, max: Math.max(range.min, Math.min(range.max, room)) };
  const start = clamp(size, limit);
  return (growth) => clamp(start + growth, limit);
}

const DRAG_ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

export function startDrag(
  event: ReactPointerEvent,
  onMove: (delta: number) => void,
  onEnd?: (delta: number) => void,
  axis: Axis = "x",
): void {
  event.preventDefault();
  const pointer = event.pointerId;
  const start = along(event, axis);
  const cursor = axis === "x" ? "dragging" : "dragging-y";
  let last = 0;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    last = along(e, axis) - start;
    onMove(last);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    window.removeEventListener("pointermove", move);
    DRAG_ENDS.forEach((type) => window.removeEventListener(type, end));
    document.body.classList.remove(cursor);
    onEnd?.(last);
  };
  (event.currentTarget as Element).setPointerCapture(pointer);
  document.body.classList.add(cursor);
  window.addEventListener("pointermove", move);
  DRAG_ENDS.forEach((type) => window.addEventListener(type, end));
}

export function scrollStep(board: HTMLElement | null, p: { x: number; y: number }): { x: number; y: number } | null {
  const box = board?.getBoundingClientRect();
  if (!box) return null;
  const along = (pos: number, low: number, high: number) => {
    if (pos < low + EDGE) return -MAX_SCROLL_STEP * Math.min(1, (low + EDGE - pos) / EDGE);
    if (pos > high - EDGE) return MAX_SCROLL_STEP * Math.min(1, (pos - (high - EDGE)) / EDGE);
    return 0;
  };
  const step = { x: Math.round(along(p.x, box.left, box.right)), y: Math.round(along(p.y, box.top, box.bottom)) };
  return step.x || step.y ? step : null;
}
