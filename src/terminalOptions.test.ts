import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/headless";
import { TERMINAL_OPTIONS } from "./terminalOptions";

const COLS = 70;
const ROWS = 20;
const PROMPT = ["⠋ Working…", "╭────╮", "│ >  │", "╰────╯"];
const ERASE_PROMPT = "\x1b[2K\x1b[1A".repeat(PROMPT.length - 1) + "\x1b[2K\r";

function feed(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function inlineConversation(messages: number, from = 1): string {
  let stream = PROMPT.join("\r\n");
  for (let n = from; n < from + messages; n++) {
    stream += ERASE_PROMPT + `● Message ${n}\r\n\r\n` + PROMPT.join("\r\n");
  }
  return stream;
}

function visible(term: Terminal): string[] {
  const buffer = term.buffer.active;
  return Array.from({ length: term.rows }, (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? "");
}

function setup() {
  return new Terminal({ ...TERMINAL_OPTIONS, cols: COLS, rows: ROWS });
}

describe("terminal scrollback", () => {
  it("keeps conversation that scrolled off the top of an inline program", async () => {
    const term = setup();
    await feed(term, inlineConversation(100));
    const buffer = term.buffer.active;
    expect(buffer.baseY).toBeGreaterThan(0);
    term.scrollToTop();
    expect(visible(term)).toContain("● Message 1");
    term.scrollToBottom();
    expect(visible(term)).toContain("● Message 100");
  });

  it("holds the view still when output arrives while scrolled back", async () => {
    const term = setup();
    await feed(term, inlineConversation(100));
    term.scrollLines(-30);
    const before = visible(term);
    await feed(term, inlineConversation(5, 101));
    expect(visible(term)).toEqual(before);
    term.scrollToBottom();
    expect(visible(term)).toContain("● Message 105");
  });

  it("returns to the live bottom when the user types", async () => {
    const term = setup();
    await feed(term, inlineConversation(100));
    term.scrollLines(-30);
    term.input("x");
    const buffer = term.buffer.active;
    expect(buffer.viewportY).toBe(buffer.baseY);
  });
});
