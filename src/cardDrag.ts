import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Card, RowKey } from "./api";
import { pickTarget, sameTarget, type DropTarget, type RowBox } from "./dropTarget";
import { scrollStep, START_DISTANCE } from "./drag";


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
      const board = scroller.current;
      const target = board && insideBoard(board, pointer) ? pickTarget(measureRows(board, card.id), pointer.x, pointer.y) : null;
      if (current.x === pointer.x && current.y === pointer.y && sameTarget(current.target, target)) return;
      current = { ...current, x: pointer.x, y: pointer.y, target };
      setDrag(current);
    };

    const everyFrame = () => {
      const step = scrollStep(scroller.current, pointer);
      if (step) scroller.current?.scrollBy(step.x, step.y);
      update();
      frame = requestAnimationFrame(everyFrame);
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

function measureRows(board: HTMLElement, draggedId: string): RowBox[] {
  return [...board.querySelectorAll<HTMLElement>(".row[data-row]")].map((rowEl) => {
    const band = rowEl.getBoundingClientRect();
    return {
      row: rowEl.dataset.row as RowKey,
      top: band.top,
      bottom: band.bottom,
      cells: [...rowEl.querySelectorAll<HTMLElement>(".cell[data-column]")].map((cell) => {
        const box = cell.getBoundingClientRect();
        return {
          column: Number(cell.dataset.column),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          collapsed: cell.dataset.collapsed === "true",
          cardMiddles: [...cell.querySelectorAll<HTMLElement>(".card[data-id]")]
            .filter((el) => el.dataset.id !== draggedId)
            .map((el) => {
              const card = el.getBoundingClientRect();
              return card.top + card.height / 2;
            }),
        };
      }),
    };
  });
}

function insideBoard(board: HTMLElement, p: { x: number; y: number }): boolean {
  const box = board.getBoundingClientRect();
  return p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
}
