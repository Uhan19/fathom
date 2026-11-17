import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Card, RowKey } from "./api";

const START_DISTANCE = 5;
const EDGE = 56;
const MAX_SCROLL_STEP = 18;
const END = Number.MAX_SAFE_INTEGER;

export interface DropTarget {
  project: string;
  row: RowKey;
  index: number;
}

export interface CardDrag {
  card: Card;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  target: DropTarget | null;
}

export function useCardDrag(scroller: RefObject<HTMLElement | null>, onDrop: (card: Card, target: DropTarget) => void) {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const justDragged = useRef(false);

  const begin = (event: ReactPointerEvent<HTMLElement>, card: Card) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    let pointer = start;
    let current: CardDrag | null = null;
    let frame = 0;

    const update = () => {
      if (!current) return;
      const target = targetAt(pointer.x, pointer.y, card.id) ?? (insideBoard(scroller.current, pointer) ? current.target : null);
      current = { ...current, x: pointer.x, y: pointer.y, target };
      setDrag(current);
    };

    const scrollEdges = () => {
      const step = scrollStep(scroller.current, pointer);
      if (step && scroller.current) {
        scroller.current.scrollBy(step.x, step.y);
        update();
      }
      frame = requestAnimationFrame(scrollEdges);
    };

    const move = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!current) {
        if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < START_DISTANCE) return;
        current = {
          card,
          x: pointer.x,
          y: pointer.y,
          offsetX: start.x - rect.left,
          offsetY: start.y - rect.top,
          width: rect.width,
          height: rect.height,
          target: null,
        };
        document.body.classList.add("moving-card");
        frame = requestAnimationFrame(scrollEdges);
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
      document.body.classList.remove("moving-card");
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      const target = commit ? current.target : null;
      current = null;
      setDrag(null);
      if (target) dropRef.current(card, target);
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

  return { drag, begin, justDragged };
}

function targetAt(x: number, y: number, draggedId: string): DropTarget | null {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>(".cell[data-project]");
  const { project, row } = cell?.dataset ?? {};
  if (!cell || !project || !row) return null;
  if (cell.dataset.collapsed === "true") return { project, row: row as RowKey, index: END };
  const above = [...cell.querySelectorAll<HTMLElement>(".card[data-id]")].filter((el) => {
    if (el.dataset.id === draggedId) return false;
    const box = el.getBoundingClientRect();
    return box.top + box.height / 2 < y;
  });
  return { project, row: row as RowKey, index: above.length };
}

function insideBoard(board: HTMLElement | null, p: { x: number; y: number }): boolean {
  const box = board?.getBoundingClientRect();
  return !!box && p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
}

function scrollStep(board: HTMLElement | null, p: { x: number; y: number }): { x: number; y: number } | null {
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
