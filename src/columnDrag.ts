import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Column } from "./api";
import { gapX, landingIndex, pickGap, type HeadBox } from "./columnOrder";
import { scrollStep, START_DISTANCE } from "./drag";

const STAYS_PUT = "input, .col-handle";

export interface ColumnDrag {
  column: Column;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  index: number | null;
  slotX: number | null;
}

export function useColumnDrag(scroller: RefObject<HTMLElement | null>, onDrop: (column: Column, index: number) => void) {
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
      const landing = scroller.current ? measure(scroller.current, column.id, pointer.x) : null;
      const index = landing?.index ?? null;
      const slotX = landing?.slotX ?? null;
      if (current.x === pointer.x && current.y === pointer.y && current.index === index && current.slotX === slotX) return;
      current = { ...current, x: pointer.x, y: pointer.y, index, slotX };
      setDrag(current);
    };

    const everyFrame = () => {
      const step = scrollStep(scroller.current, { x: pointer.x, y: rect.top + rect.height / 2 });
      if (step?.x) scroller.current?.scrollBy(step.x, 0);
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
          slotX: null,
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

function measure(scroller: HTMLElement, id: number, x: number): { index: number | null; slotX: number | null } {
  const heads: HeadBox[] = [...scroller.querySelectorAll<HTMLElement>(".column-head[data-column]")].map((el) => {
    const box = el.getBoundingClientRect();
    return { id: Number(el.dataset.column), left: box.left, right: box.right };
  });
  const gap = pickGap(heads, x);
  const index = landingIndex(
    heads.map((h) => h.id),
    id,
    gap,
  );
  const board = scroller.querySelector<HTMLElement>(".board");
  const at = gapX(heads, gap);
  return { index, slotX: index === null || at === null || !board ? null : at - board.getBoundingClientRect().left };
}

function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("click", swallow, true);
  setTimeout(() => window.removeEventListener("click", swallow, true), 0);
}
