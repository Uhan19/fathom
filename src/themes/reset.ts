import RESET_SHORTCUTS from "../resetThemeShortcut.json";
import { comboOf } from "../shortcuts";

export const RESET_EVENT = "fathom:reset-theme";

export const resetShortcut = (mac: boolean): string => RESET_SHORTCUTS[mac ? "macos" : "linux"];

export function installThemeReset(target: Pick<Window, "addEventListener" | "removeEventListener">, mac: boolean, reset: () => void): () => void {
  const combo = resetShortcut(mac);
  const handler = (event: Event) => {
    if (comboOf(event as KeyboardEvent) !== combo) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    reset();
  };
  target.addEventListener("keydown", handler, { capture: true });
  return () => target.removeEventListener("keydown", handler, { capture: true });
}
