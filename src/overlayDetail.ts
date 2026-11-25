import { useEffect, useRef, type RefObject } from "react";

const TERMINAL = '[data-part="terminal-host"]';
const OPEN_DIALOG = "dialog[open]";
const CLOSE = '[data-part="detail"] [data-control="close-detail"]';

export function closesOnEscape(event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "target">, page: Pick<Document, "querySelector">): boolean {
  const target = event.target as Partial<Element> | null;
  return event.key === "Escape" && !event.defaultPrevented && !target?.closest?.(TERMINAL) && !page.querySelector(OPEN_DIALOG);
}

export function useDetailEscape(appRef: RefObject<HTMLElement | null>, open: boolean, overlay: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const app = appRef.current;
    if (!open || !app) return;
    const previous = overlay && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (overlay) app.querySelector<HTMLElement>(CLOSE)?.focus();
    const escape = (e: KeyboardEvent) => {
      if (!closesOnEscape(e, document)) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      if (previous?.isConnected) previous.focus();
    };
  }, [appRef, open, overlay]);
}
