import DEFAULTS from "./shortcutDefaults.json";
import RESET_THEME from "./resetThemeShortcut.json";

export const SHORTCUT_ACTIONS = ["toggleChat", "toggleTheme", "openSettings"] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type Shortcuts = Record<ShortcutAction, string>;
export const NO_SHORTCUT = "";

export const ACTION_NAMES: Record<ShortcutAction, string> = {
  toggleChat: "Show or hide the chat",
  toggleTheme: "Switch light and dark",
  openSettings: "Open Settings",
};

const ACTION_DOINGS: Record<ShortcutAction, string> = {
  toggleChat: "shows or hides the chat",
  toggleTheme: "switches light and dark",
  openSettings: "opens Settings",
};

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"] as const;
type Modifier = (typeof MODIFIERS)[number];
const FLAGS = { Ctrl: "ctrlKey", Alt: "altKey", Shift: "shiftKey", Meta: "metaKey" } as const;
const COMMAND_MODIFIERS: Modifier[] = ["Ctrl", "Alt", "Meta"];
const MAC_GLYPHS: Record<Modifier, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
const LINUX_NAMES: Record<Modifier, string> = { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Super" };
const MODIFIER_KEYS = new Set(["Control", "Alt", "AltGraph", "Shift", "Meta", "OS", "Hyper", "Super", "CapsLock", "Fn"]);
const CLEAR_KEYS = new Set(["Backspace", "Delete"]);

const KEY_NAMES: Record<string, string | [mac: string, linux: string]> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: "Space",
  Enter: ["↩", "Enter"],
  Tab: ["⇥", "Tab"],
  Backspace: ["⌫", "Backspace"],
  Delete: ["⌦", "Delete"],
  Escape: ["⎋", "Esc"],
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: ["⇞", "PageUp"],
  PageDown: ["⇟", "PageDown"],
  Home: ["↖", "Home"],
  End: ["↘", "End"],
};

export type KeyPress = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

export interface Combo {
  modifiers: Modifier[];
  code: string;
}

export const defaultShortcuts = (mac: boolean): Shortcuts => ({ ...DEFAULTS[mac ? "macos" : "linux"] });

const heldModifiers = (e: KeyPress): Modifier[] => MODIFIERS.filter((m) => e[FLAGS[m]]);

const isModifierKey = (e: KeyPress) => MODIFIER_KEYS.has(e.key) || /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(e.code);

export function comboOf(e: KeyPress): string | null {
  if (!e.code || isModifierKey(e)) return null;
  return [...heldModifiers(e), e.code].join("+");
}

export function parseCombo(combo: string): Combo | null {
  const tokens = combo.split("+");
  const code = tokens.pop();
  if (!code || MODIFIERS.includes(code as Modifier)) return null;
  const modifiers = MODIFIERS.filter((m) => tokens.includes(m));
  if (modifiers.length !== tokens.length) return null;
  return { modifiers, code };
}

function keyName(code: string, mac: boolean): string {
  const named = KEY_NAMES[code];
  if (named !== undefined) return typeof named === "string" ? named : named[mac ? 0 : 1];
  return code.replace(/^(Key|Digit)/, "").replace(/^Numpad/, "Num ");
}

export function comboKeys(combo: string, mac: boolean): string[] {
  const parsed = parseCombo(combo);
  if (!parsed) return [];
  const names = mac ? MAC_GLYPHS : LINUX_NAMES;
  return [...parsed.modifiers.map((m) => names[m]), keyName(parsed.code, mac)];
}

export function heldKeys(e: KeyPress, mac: boolean): string[] {
  const names = mac ? MAC_GLYPHS : LINUX_NAMES;
  return heldModifiers(e).map((m) => names[m]);
}

export function comboLabel(combo: string, mac: boolean): string {
  return comboKeys(combo, mac).join(mac ? "" : "+");
}

interface Taken {
  combo: string;
  doing: string;
}

export function fixedShortcuts(mac: boolean): Taken[] {
  return [
    { combo: mac ? "Meta+KeyJ" : "Ctrl+KeyJ", doing: "opens Bosun" },
    { combo: mac ? "Meta+KeyT" : "Ctrl+Shift+KeyT", doing: "opens the terminal launcher" },
    { combo: "Ctrl+Tab", doing: "moves to the next chat tab" },
    { combo: "Ctrl+Shift+Tab", doing: "moves to the previous chat tab" },
    { combo: RESET_THEME[mac ? "macos" : "linux"], doing: "goes back to the Nautical theme" },
  ];
}

const MAC_MENU: Taken[] = [
  { combo: "Meta+KeyQ", doing: "quits Fathom" },
  { combo: "Meta+KeyH", doing: "hides Fathom" },
  { combo: "Alt+Meta+KeyH", doing: "hides the other apps" },
  { combo: "Meta+KeyW", doing: "closes the window" },
  { combo: "Meta+KeyM", doing: "minimizes the window" },
  { combo: "Ctrl+Meta+KeyF", doing: "turns full screen on and off" },
  { combo: "Meta+KeyZ", doing: "undoes" },
  { combo: "Shift+Meta+KeyZ", doing: "redoes" },
  { combo: "Meta+KeyX", doing: "cuts" },
  { combo: "Meta+KeyC", doing: "copies" },
  { combo: "Meta+KeyV", doing: "pastes" },
  { combo: "Meta+KeyA", doing: "selects all" },
];

export type Refusal = { kind: "noModifier" } | { kind: "taken"; doing: string };

export function refusalOf(combo: string, action: ShortcutAction, shortcuts: Shortcuts, mac: boolean): Refusal | null {
  const parsed = parseCombo(combo);
  if (!parsed || !parsed.modifiers.some((m) => COMMAND_MODIFIERS.includes(m))) return { kind: "noModifier" };
  const other = SHORTCUT_ACTIONS.find((a) => a !== action && shortcuts[a] === combo);
  if (other) return { kind: "taken", doing: ACTION_DOINGS[other] };
  const fixed = [...fixedShortcuts(mac), ...(mac ? MAC_MENU : [])].find((t) => t.combo === combo);
  return fixed ? { kind: "taken", doing: fixed.doing } : null;
}

export function refusalText(refusal: Refusal, combo: string, mac: boolean): string {
  if (refusal.kind === "noModifier") return mac ? "A shortcut needs ⌘, ⌥ or ⌃." : "A shortcut needs Ctrl, Alt or Super.";
  return `"${comboLabel(combo, mac)}" already ${refusal.doing}.`;
}

export type RecordStep =
  | { kind: "cancel" }
  | { kind: "clear" }
  | { kind: "held"; keys: string[] }
  | { kind: "refused"; combo: string; refusal: Refusal }
  | { kind: "set"; combo: string };

export function recordStep(e: KeyPress, action: ShortcutAction, shortcuts: Shortcuts, mac: boolean): RecordStep {
  const bare = heldModifiers(e).length === 0;
  if (bare && e.key === "Escape") return { kind: "cancel" };
  if (bare && CLEAR_KEYS.has(e.key)) return { kind: "clear" };
  const combo = comboOf(e);
  if (!combo) return { kind: "held", keys: heldKeys(e, mac) };
  const refusal = refusalOf(combo, action, shortcuts, mac);
  return refusal ? { kind: "refused", combo, refusal } : { kind: "set", combo };
}

export function actionOf(e: KeyPress, shortcuts: Shortcuts): ShortcutAction | null {
  const combo = comboOf(e);
  if (!combo) return null;
  return SHORTCUT_ACTIONS.find((a) => shortcuts[a] === combo) ?? null;
}

type ShortcutEvent = KeyPress & Pick<KeyboardEvent, "repeat" | "preventDefault" | "stopPropagation">;

export function shortcutHandler(shortcuts: Shortcuts, run: (action: ShortcutAction) => void) {
  return (e: ShortcutEvent) => {
    const action = actionOf(e, shortcuts);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) run(action);
  };
}

type KeyTarget = Pick<Window, "addEventListener" | "removeEventListener">;

export function listenForShortcuts(target: KeyTarget, shortcuts: Shortcuts, run: (action: ShortcutAction) => void) {
  const handler = shortcutHandler(shortcuts, run);
  target.addEventListener("keydown", handler, true);
  return () => target.removeEventListener("keydown", handler, true);
}

export interface Recording {
  action: ShortcutAction;
  held: string[];
  refused: { combo: string; refusal: Refusal } | null;
}

export const startRecording = (action: ShortcutAction): Recording => ({ action, held: [], refused: null });

export function afterStep(shortcuts: Shortcuts, recording: Recording, step: RecordStep): { shortcuts: Shortcuts; recording: Recording | null } {
  switch (step.kind) {
    case "cancel":
      return { shortcuts, recording: null };
    case "clear":
      return { shortcuts: clearShortcut(shortcuts, recording.action), recording: null };
    case "held":
      return { shortcuts, recording: { ...recording, held: step.keys } };
    case "refused":
      return { shortcuts, recording: { ...recording, held: [], refused: { combo: step.combo, refusal: step.refusal } } };
    case "set":
      return { shortcuts: { ...shortcuts, [recording.action]: step.combo }, recording: null };
  }
}

export const clearShortcut = (shortcuts: Shortcuts, action: ShortcutAction): Shortcuts => ({ ...shortcuts, [action]: NO_SHORTCUT });

export const resetShortcut = (shortcuts: Shortcuts, action: ShortcutAction, mac: boolean): Shortcuts => ({
  ...shortcuts,
  [action]: defaultShortcuts(mac)[action],
});

export const recordingHint = (mac: boolean): string =>
  `Press the new shortcut. Esc cancels, ${mac ? "Delete" : "Backspace"} clears.`;
