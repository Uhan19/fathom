import { useEffect, useRef, type RefObject } from "react";

const OVERLAY_PARTS = '[data-part="detail"], [data-part="detail-scrim"]';
const TERMINAL = '[data-part="terminal-host"]';
const OPEN_DIALOG = "dialog[open]";
const CLOSE = '[data-part="detail"] [data-control="close-detail"]';

export function blockedBehind(app: HTMLElement): HTMLElement[] {
  const main = app.querySelector<HTMLElement>('[data-part="main"]');
  const around = [...app.children, ...(main ? [...main.children] : [])] as HTMLElement[];
  return around.filter((el) => el !== main && !el.matches(OVERLAY_PARTS));
}

export function closesOnEscape(event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "target">, page: Pick<Document, "querySelector">): boolean {
  const target = event.target as Partial<Element> | null;
  return event.key === "Escape" && !event.defaultPrevented && !target?.closest?.(TERMINAL) && !page.querySelector(OPEN_DIALOG);
}

export function useOverlayDetail(appRef: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const app = appRef.current;
    if (!open || !app) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const blocked = blockedBehind(app);
    blocked.forEach((el) => (el.inert = true));
    app.querySelector<HTMLElement>(CLOSE)?.focus();
    const escape = (e: KeyboardEvent) => {
      if (!closesOnEscape(e, document)) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      blocked.forEach((el) => (el.inert = false));
      if (previous?.isConnected) previous.focus();
    };
  }, [appRef, open]);
}
