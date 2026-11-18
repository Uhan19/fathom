import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/headless";
import {
  clipboardWrite,
  forwardClipboardWrites,
  shiftEnterSequence,
  SHIFT_ENTER_KITTY,
  SHIFT_ENTER_LEGACY,
  trackKittyKeyboard,
} from "./terminalInput";

function feed(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function setup() {
  const term = new Terminal({ allowProposedApi: true });
  const kitty = trackKittyKeyboard(term);
  return { term, kitty, shiftEnter: () => shiftEnterSequence(kitty.flags()) };
}

describe("Shift+Enter", () => {
  it("uses the xterm form until a program asks for kitty keys", async () => {
    const { term, shiftEnter } = setup();
    expect(shiftEnter()).toBe(SHIFT_ENTER_LEGACY);
    await feed(term, "\x1b[>1u");
    expect(shiftEnter()).toBe(SHIFT_ENTER_KITTY);
    await feed(term, "\x1b[<u");
    expect(shiftEnter()).toBe(SHIFT_ENTER_LEGACY);
  });

  it("follows the flags herdr-core restores in an attach repaint", async () => {
    const { term, kitty, shiftEnter } = setup();
    await feed(term, "\x1b[=0;1u\x1b[?1049l\x1b[?1047l\x1b[?47l\x1b[=31;1u");
    expect(kitty.flags()).toBe(31);
    expect(shiftEnter()).toBe(SHIFT_ENTER_KITTY);
    await feed(term, "\x1b[=0;1u");
    expect(shiftEnter()).toBe(SHIFT_ENTER_LEGACY);
  });

  it("applies the add and remove modes and pops several entries at once", async () => {
    const { term, kitty } = setup();
    await feed(term, "\x1b[=1u\x1b[=4;2u");
    expect(kitty.flags()).toBe(5);
    await feed(term, "\x1b[=1;3u");
    expect(kitty.flags()).toBe(4);
    await feed(term, "\x1b[>1u\x1b[>3u\x1b[<2u");
    expect(kitty.flags()).toBe(4);
  });

  it("keeps separate flags for the main and alternate screens", async () => {
    const { term, kitty } = setup();
    await feed(term, "\x1b[>1u\x1b[?1049h");
    expect(kitty.flags()).toBe(0);
    await feed(term, "\x1b[>3u");
    expect(kitty.flags()).toBe(3);
    await feed(term, "\x1b[?1049l");
    expect(kitty.flags()).toBe(1);
  });

  it("forgets the flags on a full reset", async () => {
    const { term, kitty } = setup();
    await feed(term, "\x1b[>1u\x1bc");
    expect(kitty.flags()).toBe(0);
  });
});

describe("clipboard writes from the program", () => {
  it("decodes UTF-8 text and ignores queries", () => {
    expect(clipboardWrite(`c;${base64("héllo ✓")}`)).toBe("héllo ✓");
    expect(clipboardWrite("c;?")).toBeNull();
    expect(clipboardWrite("c;")).toBeNull();
    expect(clipboardWrite("c;%%%")).toBeNull();
  });

  it("forwards OSC 52 from the output stream", async () => {
    const { term } = setup();
    const copied: string[] = [];
    forwardClipboardWrites(term, (text) => copied.push(text));
    await feed(term, `\x1b]52;c;${base64("line one\nline two")}\x07\x1b]52;c;?\x07`);
    expect(copied).toEqual(["line one\nline two"]);
  });
});
