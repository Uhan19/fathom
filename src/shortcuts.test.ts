import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isToggleShortcut } from "./bosun";
import { ShortcutRow } from "./components/ShortcutsSection";
import { captureKeys, installKeyCapture } from "./keyCapture";
import {
  actionOf,
  afterStep,
  clearShortcut,
  comboLabel,
  comboOf,
  defaultShortcuts,
  fixedShortcuts,
  listenForShortcuts,
  recordStep,
  refusalOf,
  refusalText,
  resetShortcut,
  startRecording,
  type KeyPress,
  type ShortcutAction,
  type Shortcuts,
} from "./shortcuts";
import { isLauncherShortcut, listenForTabKeys, tabStep } from "./terminalTabs";

const MAC = true;
const LINUX = false;

const key = (code: string, over: Partial<KeyPress> = {}): KeyPress => ({
  key: code.replace(/^Key/, "").toLowerCase(),
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...over,
});

const modifierOnly = (keyName: string, code: string, over: Partial<KeyPress>): KeyPress => ({ ...key(code, over), key: keyName });

describe("matching", () => {
  it("matches the macOS defaults by physical key, even when Option changes the character", () => {
    const shortcuts = defaultShortcuts(MAC);
    expect(actionOf(key("KeyB", { metaKey: true }), shortcuts)).toBe("toggleChat");
    expect(actionOf(key("KeyL", { metaKey: true, shiftKey: true, key: "L" }), shortcuts)).toBe("toggleTheme");
    expect(actionOf(key("Comma", { metaKey: true, key: "," }), shortcuts)).toBe("openSettings");
    const custom = { ...shortcuts, toggleChat: "Alt+Meta+KeyB" };
    expect(actionOf(key("KeyB", { metaKey: true, altKey: true, key: "∫" }), custom)).toBe("toggleChat");
  });

  it("matches the Linux defaults and not the plain Ctrl+letter a terminal program needs", () => {
    const shortcuts = defaultShortcuts(LINUX);
    expect(actionOf(key("KeyB", { ctrlKey: true, shiftKey: true }), shortcuts)).toBe("toggleChat");
    expect(actionOf(key("KeyL", { ctrlKey: true, shiftKey: true }), shortcuts)).toBe("toggleTheme");
    expect(actionOf(key("Comma", { ctrlKey: true }), shortcuts)).toBe("openSettings");
    expect(actionOf(key("KeyB", { ctrlKey: true }), shortcuts)).toBeNull();
    expect(actionOf(key("KeyL", { ctrlKey: true }), shortcuts)).toBeNull();
  });

  it("needs the exact modifiers and never matches a cleared shortcut", () => {
    const shortcuts = defaultShortcuts(MAC);
    expect(actionOf(key("KeyB", { metaKey: true, shiftKey: true }), shortcuts)).toBeNull();
    expect(actionOf(key("KeyB"), shortcuts)).toBeNull();
    expect(actionOf(key("KeyB", { metaKey: true }), clearShortcut(shortcuts, "toggleChat"))).toBeNull();
    expect(comboOf(modifierOnly("Meta", "MetaLeft", { metaKey: true }))).toBeNull();
  });

  it("shows keys the platform's way", () => {
    expect(comboLabel("Shift+Meta+KeyL", MAC)).toBe("⇧⌘L");
    expect(comboLabel("Ctrl+Alt+Shift+Meta+Comma", MAC)).toBe("⌃⌥⇧⌘,");
    expect(comboLabel("Ctrl+Shift+KeyL", LINUX)).toBe("Ctrl+Shift+L");
    expect(comboLabel("Ctrl+Meta+Digit1", LINUX)).toBe("Ctrl+Super+1");
    expect(comboLabel("Alt+ArrowUp", LINUX)).toBe("Alt+↑");
    expect(comboLabel("Ctrl+Enter", MAC)).toBe("⌃↩");
    expect(comboLabel("", MAC)).toBe("");
  });
});

describe("refusals", () => {
  const shortcuts = defaultShortcuts(MAC);

  it("refuses a key with no modifier, or with only Shift", () => {
    expect(refusalOf("KeyK", "toggleChat", shortcuts, MAC)).toEqual({ kind: "noModifier" });
    expect(refusalOf("Shift+KeyK", "toggleChat", shortcuts, MAC)).toEqual({ kind: "noModifier" });
    expect(refusalText({ kind: "noModifier" }, "KeyK", MAC)).toBe("A shortcut needs ⌘, ⌥ or ⌃.");
    expect(refusalText({ kind: "noModifier" }, "KeyK", LINUX)).toBe("A shortcut needs Ctrl, Alt or Super.");
  });

  it("refuses another action's shortcut but not the action's own", () => {
    const refusal = refusalOf("Meta+Comma", "toggleChat", shortcuts, MAC);
    expect(refusal).toEqual({ kind: "taken", doing: "opens Settings" });
    expect(refusalText(refusal!, "Meta+Comma", MAC)).toBe("\"⌘,\" already opens Settings.");
    expect(refusalOf("Meta+Comma", "openSettings", shortcuts, MAC)).toBeNull();
  });

  it("refuses Bosun's, the launcher's and the tab-cycling shortcuts on both platforms", () => {
    for (const mac of [MAC, LINUX]) {
      for (const fixed of fixedShortcuts(mac)) {
        expect(refusalOf(fixed.combo, "toggleTheme", defaultShortcuts(mac), mac)).toEqual({ kind: "taken", doing: fixed.doing });
      }
    }
    expect(refusalText({ kind: "taken", doing: "opens Bosun" }, "Ctrl+KeyJ", LINUX)).toBe("\"Ctrl+J\" already opens Bosun.");
  });

  it("refuses the macOS menu's keys only on macOS", () => {
    expect(refusalOf("Meta+KeyC", "toggleChat", shortcuts, MAC)).toEqual({ kind: "taken", doing: "copies" });
    expect(refusalOf("Meta+KeyQ", "toggleChat", shortcuts, MAC)).toEqual({ kind: "taken", doing: "quits Fathom" });
    expect(refusalOf("Meta+KeyC", "toggleChat", defaultShortcuts(LINUX), LINUX)).toBeNull();
  });

  it("keeps the fixed list in step with the keys those shortcuts really answer to", () => {
    for (const mac of [MAC, LINUX]) {
      const [bosun, launcher, next, previous] = fixedShortcuts(mac).map((f) => pressFor(f.combo));
      expect(isToggleShortcut(bosun, mac)).toBe(true);
      expect(isLauncherShortcut(launcher, mac)).toBe(true);
      expect(tabStep(next)).toBe(1);
      expect(tabStep(previous)).toBe(-1);
    }
  });

  it("gives each platform distinct defaults that clash with nothing", () => {
    for (const mac of [MAC, LINUX]) {
      const defaults = defaultShortcuts(mac);
      for (const action of Object.keys(defaults) as ShortcutAction[]) {
        expect(refusalOf(defaults[action], action, defaults, mac)).toBeNull();
      }
    }
    expect(defaultShortcuts(MAC).openSettings).toBe("Meta+Comma");
  });
});

function pressFor(combo: string): KeyPress {
  const parts = combo.split("+");
  const code = parts.pop()!;
  return key(code, {
    key: code === "Tab" ? "Tab" : code.replace(/^Key/, "").toLowerCase(),
    ctrlKey: parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
    metaKey: parts.includes("Meta"),
  });
}

describe("recording", () => {
  const shortcuts = defaultShortcuts(MAC);
  const record = (action: ShortcutAction, presses: KeyPress[], from: Shortcuts = shortcuts) => {
    let state = { shortcuts: from, recording: startRecording(action) as ReturnType<typeof startRecording> | null };
    for (const press of presses) {
      if (!state.recording) break;
      state = afterStep(state.shortcuts, state.recording, recordStep(press, action, state.shortcuts, MAC));
    }
    return state;
  };

  it("captures the combination pressed, showing modifiers while they are held", () => {
    const held = record("toggleChat", [modifierOnly("Meta", "MetaLeft", { metaKey: true }), modifierOnly("Alt", "AltLeft", { metaKey: true, altKey: true })]);
    expect(held.recording?.held).toEqual(["⌥", "⌘"]);
    const done = record("toggleChat", [modifierOnly("Meta", "MetaLeft", { metaKey: true }), key("KeyK", { metaKey: true })]);
    expect(done.recording).toBeNull();
    expect(done.shortcuts.toggleChat).toBe("Meta+KeyK");
  });

  it("cancels on Escape and keeps the shortcut", () => {
    const done = record("toggleChat", [key("Escape", { key: "Escape" })]);
    expect(done.recording).toBeNull();
    expect(done.shortcuts).toEqual(shortcuts);
  });

  it("clears on Backspace or Delete", () => {
    for (const k of ["Backspace", "Delete"]) {
      const done = record("toggleTheme", [key(k, { key: k })]);
      expect(done.recording).toBeNull();
      expect(done.shortcuts.toggleTheme).toBe("");
    }
  });

  it("records Escape or Backspace when a modifier is held", () => {
    expect(record("toggleTheme", [key("Escape", { key: "Escape", altKey: true })]).shortcuts.toggleTheme).toBe("Alt+Escape");
    expect(record("toggleTheme", [key("Backspace", { key: "Backspace", metaKey: true })]).shortcuts.toggleTheme).toBe("Meta+Backspace");
  });

  it("stays recording after a refusal and takes the next good combination", () => {
    const refused = record("toggleChat", [key("KeyJ", { metaKey: true })]);
    expect(refused.recording?.refused).toEqual({ combo: "Meta+KeyJ", refusal: { kind: "taken", doing: "opens Bosun" } });
    expect(refused.shortcuts).toEqual(shortcuts);
    const bare = record("toggleChat", [key("KeyK")]);
    expect(bare.recording?.refused?.refusal).toEqual({ kind: "noModifier" });
    const then = record("toggleChat", [key("KeyJ", { metaKey: true }), key("KeyK", { metaKey: true })]);
    expect(then.recording).toBeNull();
    expect(then.shortcuts.toggleChat).toBe("Meta+KeyK");
  });

  it("resets a changed or cleared shortcut to the platform default", () => {
    const changed = { ...clearShortcut(shortcuts, "toggleTheme"), toggleChat: "Meta+KeyK" };
    expect(resetShortcut(resetShortcut(changed, "toggleTheme", MAC), "toggleChat", MAC)).toEqual(shortcuts);
    expect(resetShortcut(defaultShortcuts(LINUX), "toggleChat", LINUX)).toEqual(defaultShortcuts(LINUX));
  });
});

describe("the shortcut row", () => {
  const row = (over: Partial<Parameters<typeof ShortcutRow>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ShortcutRow, {
        action: "toggleChat",
        combo: "Meta+KeyB",
        defaultCombo: "Meta+KeyB",
        recording: null,
        mac: MAC,
        onRecord: () => undefined,
        onStop: () => undefined,
        onClear: () => undefined,
        onReset: () => undefined,
        ...over,
      }),
    );

  it("shows the keys, hides Reset at the default and offers it once changed", () => {
    expect(row()).toContain("<kbd>⌘</kbd><kbd>B</kbd>");
    expect(row()).toContain('class="mini unused"');
    expect(row({ combo: "" })).toContain("None");
    expect(row({ combo: "" })).toContain('class="mini"');
  });

  it("prompts while recording and names the clash when refused", () => {
    expect(row({ recording: startRecording("toggleChat") })).toContain("Press keys…");
    expect(row({ recording: startRecording("toggleChat") })).toContain("Esc cancels, Delete clears.");
    const refused = row({ recording: { action: "toggleChat", held: [], refused: { combo: "Meta+KeyJ", refusal: { kind: "taken", doing: "opens Bosun" } } } });
    expect(refused).toContain("shortcut-key recording refused");
    expect(refused).toContain("&quot;⌘J&quot; already opens Bosun.");
  });
});

class FakeEvent extends Event {
  constructor(type: string, press: KeyPress & { repeat?: boolean }) {
    super(type, { cancelable: true });
    Object.assign(this, { repeat: false, ...press });
  }
}

describe("app-wide keys", () => {
  let win: EventTarget;
  let terminal: string[];
  let fired: string[];
  let uninstall: () => void;
  const release: (() => void)[] = [];

  const press = (k: KeyPress & { repeat?: boolean }, type = "keydown") => {
    const e = new FakeEvent(type, k);
    win.dispatchEvent(e);
    if (!e.cancelBubble) terminal.push(`${type}:${k.code}`);
    return e;
  };

  beforeEach(() => {
    win = new EventTarget();
    terminal = [];
    fired = [];
    uninstall = installKeyCapture(win as Window);
    const bosun = (e: Event) => {
      if (!isToggleShortcut(e as KeyboardEvent, MAC)) return;
      e.stopPropagation();
      fired.push("bosun");
    };
    win.addEventListener("keydown", bosun, true);
    release.push(() => win.removeEventListener("keydown", bosun, true));
    release.push(listenForTabKeys(win as Window, MAC, { openLauncher: () => fired.push("launcher"), cycle: () => fired.push("cycle") }));
    release.push(listenForShortcuts(win as Window, defaultShortcuts(MAC), (action) => fired.push(action)));
  });

  afterEach(() => {
    release.splice(0).forEach((r) => r());
    uninstall();
  });

  it("fires before a focused terminal sees the keys, and only once while held", () => {
    const e = press(key("KeyB", { metaKey: true }));
    expect(fired).toEqual(["toggleChat"]);
    expect(e.defaultPrevented).toBe(true);
    press({ ...key("KeyB", { metaKey: true }), repeat: true });
    expect(fired).toEqual(["toggleChat"]);
    press(key("Comma", { metaKey: true }));
    press(key("KeyL", { metaKey: true, shiftKey: true }));
    expect(fired).toEqual(["toggleChat", "openSettings", "toggleTheme"]);
    press(key("KeyB", { ctrlKey: true }));
    expect(terminal).toEqual(["keydown:KeyB"]);
  });

  it("stops every app shortcut and the terminal while a shortcut is being recorded", () => {
    const captured: string[] = [];
    const stop = captureKeys((e) => captured.push(`${e.type}:${e.code}`));
    for (const k of [key("KeyJ", { metaKey: true }), key("KeyT", { metaKey: true }), key("Tab", { key: "Tab", ctrlKey: true }), key("KeyB", { metaKey: true }), key("Escape", { key: "Escape" })]) {
      expect(press(k).defaultPrevented).toBe(true);
    }
    press(key("KeyX"), "keyup");
    expect(fired).toEqual([]);
    expect(terminal).toEqual([]);
    expect(captured).toEqual(["keydown:KeyJ", "keydown:KeyT", "keydown:Tab", "keydown:KeyB", "keydown:Escape", "keyup:KeyX"]);

    stop();
    press(key("KeyJ", { metaKey: true }));
    expect(fired).toEqual(["bosun"]);
  });
});
