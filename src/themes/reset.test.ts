import { describe, expect, it, vi } from "vitest";
import { installThemeReset, resetShortcut } from "./reset";

function press(target: EventTarget, keys: Partial<KeyboardEvent>) {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...keys });
  target.dispatchEvent(event);
  return event;
}

describe("the reset-theme shortcut", () => {
  it("is Shift+Command+0 on macOS and Ctrl+Shift+0 on Linux", () => {
    expect(resetShortcut(true)).toBe("Shift+Meta+Digit0");
    expect(resetShortcut(false)).toBe("Ctrl+Shift+Digit0");
  });

  it("resets on its keys and stops every later listener", () => {
    const target = new EventTarget() as unknown as Window;
    const reset = vi.fn();
    const later = vi.fn();
    const remove = installThemeReset(target, true, reset);
    target.addEventListener("keydown", later, { capture: true });
    const event = press(target, { code: "Digit0", key: "0", shiftKey: true, metaKey: true });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
    press(target, { code: "Digit0", key: "0", metaKey: true });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
    remove();
    press(target, { code: "Digit0", key: "0", shiftKey: true, metaKey: true });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
