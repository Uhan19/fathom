type Params = (number | number[])[];

interface Disposable {
  dispose(): void;
}

export interface ParserHost {
  parser: {
    registerCsiHandler(id: { prefix?: string; final: string }, callback: (params: Params) => boolean): Disposable;
    registerEscHandler(id: { final: string }, handler: () => boolean): Disposable;
    registerOscHandler(ident: number, callback: (data: string) => boolean): Disposable;
  };
  buffer: { active: { type: "normal" | "alternate" } };
}

const KITTY_STACK_LIMIT = 8;
const KITTY_DISAMBIGUATE = 1;
const KITTY_ALL_KEYS = 8;
const KITTY_SET_MODES = { replace: 1, add: 2, remove: 3 } as const;
const CLIPBOARD_OSC = 52;
const CLIPBOARD_QUERY = "?";

export const SHIFT_ENTER_KITTY = "\x1b[13;2u";
export const SHIFT_ENTER_LEGACY = "\x1b[27;2;13~";

function param(params: Params, index: number, fallback: number): number {
  const value = params[index];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === 0 ? fallback : first;
}

export interface KittyKeyboard extends Disposable {
  flags(): number;
}

export function trackKittyKeyboard(term: ParserHost): KittyKeyboard {
  const stacks: Record<"normal" | "alternate", number[]> = { normal: [], alternate: [] };
  const stack = () => stacks[term.buffer.active.type];
  const top = () => {
    const s = stack();
    return s.length > 0 ? s[s.length - 1] : 0;
  };

  const handlers = [
    term.parser.registerCsiHandler({ prefix: ">", final: "u" }, (params) => {
      const s = stack();
      s.push(param(params, 0, 0));
      if (s.length > KITTY_STACK_LIMIT) s.shift();
      return true;
    }),
    term.parser.registerCsiHandler({ prefix: "<", final: "u" }, (params) => {
      const s = stack();
      s.splice(Math.max(0, s.length - param(params, 0, 1)));
      return true;
    }),
    term.parser.registerCsiHandler({ prefix: "=", final: "u" }, (params) => {
      const flags = param(params, 0, 0);
      const mode = param(params, 1, KITTY_SET_MODES.replace);
      const current = top();
      const next =
        mode === KITTY_SET_MODES.add ? current | flags : mode === KITTY_SET_MODES.remove ? current & ~flags : flags;
      const s = stack();
      if (s.length === 0) s.push(next);
      else s[s.length - 1] = next;
      return true;
    }),
    term.parser.registerEscHandler({ final: "c" }, () => {
      stacks.normal = [];
      stacks.alternate = [];
      return false;
    }),
  ];

  return {
    flags: top,
    dispose: () => handlers.forEach((h) => h.dispose()),
  };
}

export function shiftEnterSequence(kittyFlags: number): string {
  return kittyFlags & (KITTY_DISAMBIGUATE | KITTY_ALL_KEYS) ? SHIFT_ENTER_KITTY : SHIFT_ENTER_LEGACY;
}

export function isShiftEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing;
}

export function isPlainEscape(e: KeyboardEvent): boolean {
  return e.key === "Escape" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing;
}

export function clipboardWrite(data: string): string | null {
  const separator = data.indexOf(";");
  if (separator < 0) return null;
  const payload = data.slice(separator + 1);
  if (payload === "" || payload === CLIPBOARD_QUERY) return null;
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function forwardClipboardWrites(term: ParserHost, onCopy: (text: string) => void): Disposable {
  return term.parser.registerOscHandler(CLIPBOARD_OSC, (data) => {
    const text = clipboardWrite(data);
    if (text) onCopy(text);
    return true;
  });
}
