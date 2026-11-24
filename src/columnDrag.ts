import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Column } from "./api";
import { gapX, landingIndex, pickGap, type HeadBox } from "./columnOrder";
import { scrollStep, START_DISTANCE, type Axis } from "./drag";

const STAYS_PUT = "input, .col-handle";

export interface ColumnDrag {
  column: Column;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  index: number | null;
  slot: number | null;
}

export function useColumnDrag(scroller: RefObject<HTMLElement | null>, onDrop: (column: Column, index: number) => void, axis: Axis = "x") {
  const [drag, setDrag] = useState<ColumnDrag | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const begin = (event: ReactPointerEvent<HTMLElement>, column: Column) => {
    if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest(STAYS_PUT)) return;
    const head = scroller.current?.querySelector<HTMLElement>(`.column-head[data-column="${column.id}"]`);
    const rect = (head ?? event.currentTarget).getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    let pointer = start;
    let current: ColumnDrag | null = null;
    let frame = 0;

    const update = () => {
      if (!current) return;
      const landing = scroller.current ? measure(scroller.current, column.id, pointer, axis) : null;
      const index = landing?.index ?? null;
      const slot = landing?.slot ?? null;
      if (current.x === pointer.x && current.y === pointer.y && current.index === index && current.slot === slot) return;
      current = { ...current, x: pointer.x, y: pointer.y, index, slot };
      setDrag(current);
    };

    const everyFrame = () => {
      const along = axis === "x" ? { x: pointer.x, y: rect.top + rect.height / 2 } : { x: rect.left + rect.width / 2, y: pointer.y };
      const step = scrollStep(scroller.current, along);
      if (step && (axis === "x" ? step.x : step.y)) scroller.current?.scrollBy(axis === "x" ? step.x : 0, axis === "y" ? step.y : 0);
      update();
      frame = requestAnimationFrame(everyFrame);
    };

    const move = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!current) {
        if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < START_DISTANCE) return;
        current = {
          column,
          x: pointer.x,
          y: pointer.y,
          offsetX: start.x - rect.left,
          offsetY: Math.min(start.y - rect.top, rect.height),
          width: rect.width,
          index: null,
          slot: null,
        };
        window.getSelection()?.removeAllRanges();
        document.body.classList.add("moving-column");
        frame = requestAnimationFrame(everyFrame);
      }
      update();
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape, true);
      cancelAnimationFrame(frame);
      if (!current) return;
      document.body.classList.remove("moving-column");
      swallowNextClick();
      const index = commit ? current.index : null;
      current = null;
      setDrag(null);
      if (index !== null) dropRef.current(column, index);
    };
    const drop = () => finish(true);
    const cancel = () => finish(false);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !current) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape, true);
  };

  return { drag, begin };
}

export function headBoxes(boxes: { id: number; box: Pick<DOMRect, "left" | "right" | "top" | "bottom"> }[], axis: Axis): HeadBox[] {
  return boxes.map(({ id, box }) => (axis === "x" ? { id, left: box.left, right: box.right } : { id, left: box.top, right: box.bottom }));
}

function measure(scroller: HTMLElement, id: number, pointer: { x: number; y: number }, axis: Axis): { index: number | null; slot: number | null } {
  const boxes = [...scroller.querySelectorAll<HTMLElement>(".column-head[data-column]")].map((el) => ({ id: Number(el.dataset.column), box: el.getBoundingClientRect() }));
  const heads = headBoxes(boxes, axis);
  const gap = pickGap(heads, axis === "x" ? pointer.x : pointer.y);
  const index = landingIndex(
    heads.map((h) => h.id),
    id,
    gap,
  );
  const board = scroller.querySelector<HTMLElement>(".board")?.getBoundingClientRect();
  const at = gapX(heads, gap);
  return { index, slot: index === null || at === null || !board ? null : at - (axis === "x" ? board.left : board.top) };
}

function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("click", swallow, true);
  setTimeout(() => window.removeEventListener("click", swallow, true), 0);
}
