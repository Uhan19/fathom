type KeyTarget = Pick<Window, "addEventListener" | "removeEventListener">;
type Capture = (e: KeyboardEvent) => void;

const KEY_EVENTS = ["keydown", "keypress", "keyup"] as const;

let capture: Capture | null = null;

export function installKeyCapture(target: KeyTarget): () => void {
  const guard = (e: Event) => {
    if (!capture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== "keypress") capture(e as KeyboardEvent);
  };
  KEY_EVENTS.forEach((type) => target.addEventListener(type, guard, true));
  return () => KEY_EVENTS.forEach((type) => target.removeEventListener(type, guard, true));
}

export function captureKeys(handler: Capture): () => void {
  capture = handler;
  return () => {
    if (capture === handler) capture = null;
  };
}
