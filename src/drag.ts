import type { PointerEvent as ReactPointerEvent } from "react";

export function startDrag(
  event: ReactPointerEvent,
  onMove: (dx: number) => void,
  onEnd?: (dx: number) => void,
): void {
  event.preventDefault();
  const startX = event.clientX;
  let last = 0;
  const move = (e: PointerEvent) => {
    last = e.clientX - startX;
    onMove(last);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("dragging");
    onEnd?.(last);
  };
  document.body.classList.add("dragging");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
