import type { PointerEvent as ReactPointerEvent } from "react";

export const START_DISTANCE = 5;
const EDGE = 56;
const MAX_SCROLL_STEP = 18;

type Axis = "x" | "y";

const along = (e: { clientX: number; clientY: number }, axis: Axis) => (axis === "x" ? e.clientX : e.clientY);

export function startDrag(
  event: ReactPointerEvent,
  onMove: (delta: number) => void,
  onEnd?: (delta: number) => void,
  axis: Axis = "x",
): void {
  event.preventDefault();
  const start = along(event, axis);
  let last = 0;
  const move = (e: PointerEvent) => {
    last = along(e, axis) - start;
    onMove(last);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove(axis === "x" ? "dragging" : "dragging-y");
    onEnd?.(last);
  };
  document.body.classList.add(axis === "x" ? "dragging" : "dragging-y");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
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
