import { describe, expect, it } from "vitest";
import type { Settings } from "./api";
import { defaultShortcuts } from "./shortcuts";
import { CHAT_WIDTH, DETAIL_WIDTH, chatResizer, detailResizer, withLatestWindow } from "./windowSettings";

const settings = (over: Partial<Settings> = {}): Settings => ({
  home: "/home/demo/firstmate",
  terminalLabel: "",
  hcSession: "",
  hcSocket: "",
  chatFont: "JetBrains Mono",
  chatFontSize: 13,
  boardFont: "Inter",
  boardFontSize: 14,
  chatAddedFonts: [],
  boardAddedFonts: [],
  agentFolder: "",
  chatAgent: null,
  theme: "light",
  chatOpen: true,
  chatWidth: 600,
  detailWidth: 460,
  projectFilter: [],
  agentFilter: "all",
  focus: [],
  helperStarted: false,
  shortcuts: defaultShortcuts(true),
  linearWorkspace: "",
  ticketPrefixes: [],
  ...over,
});

describe("withLatestWindow", () => {
  it("keeps what Bosun wrote while the settings dialog was open", () => {
    const opened = settings();
    const draft = { ...opened, chatFontSize: 15 };
    const latest = settings({ theme: "dark", projectFilter: ["keel-cli"], agentFilter: "withActiveAgent", chatOpen: false, chatWidth: 720, detailWidth: 500, helperStarted: true });
    expect(withLatestWindow(draft, latest)).toEqual({ ...latest, chatFontSize: 15 });
  });

  it("keeps the dialog's own fields over the latest ones", () => {
    const latest = settings({ boardFont: "Saira", theme: "dark" });
    const draft = settings({ boardFont: "Inter", home: "/home/demo/other", shortcuts: { ...defaultShortcuts(true), toggleChat: "" } });
    const saved = withLatestWindow(draft, latest);
    expect(saved.boardFont).toBe("Inter");
    expect(saved.shortcuts.toggleChat).toBe("");
    expect(saved.home).toBe("/home/demo/other");
    expect(saved.theme).toBe("dark");
  });
});

const WINDOW = 1440;
const HANDLES = 16;
const CHAT = 600;
const DETAIL = 460;
const BOARD_MIN = 424;
const BOARD_WITH_DETAIL = WINDOW - HANDLES - CHAT - DETAIL;
const WIDE_WINDOW = 1920;
const BOARD_WIDE = WIDE_WINDOW - HANDLES - CHAT - DETAIL;
const board = (shown: number) => ({ shown, min: BOARD_MIN });

describe("chatResizer", () => {
  it("grows the chat the same way with card details open as without, until the board would get too narrow", () => {
    const withDetail = chatResizer({ chat: CHAT, detail: DETAIL }, board(BOARD_WIDE));
    const without = chatResizer({ chat: CHAT, detail: null }, board(BOARD_WIDE + DETAIL));
    expect([1, 10, 200].map((g) => withDetail(g).chat)).toEqual([1, 10, 200].map((g) => without(g).chat));
    expect(withDetail(200).detail).toBe(DETAIL);
  });

  it("takes room from card details once the board is down to one column, instead of squeezing the board away", () => {
    const width = chatResizer({ chat: CHAT, detail: DETAIL }, board(BOARD_WIDE));
    const boardSpare = BOARD_WIDE - BOARD_MIN;
    expect(width(boardSpare + 50)).toEqual({ chat: CHAT + boardSpare + 50, detail: DETAIL - 50 });
  });

  it("stops when the board is down to one column and card details are at their narrowest", () => {
    const width = chatResizer({ chat: CHAT, detail: DETAIL }, board(BOARD_WIDE));
    const widest = width(5000);
    expect(widest.detail).toBe(DETAIL_WIDTH.min);
    expect(WIDE_WINDOW - HANDLES - widest.chat - (widest.detail ?? 0)).toBe(BOARD_MIN);
  });

  it("still takes room from card details when the board is already narrower than one column", () => {
    const width = chatResizer({ chat: CHAT, detail: DETAIL }, board(BOARD_WITH_DETAIL));
    expect(BOARD_WITH_DETAIL).toBeLessThan(BOARD_MIN);
    expect(width(5000)).toEqual({ chat: CHAT + DETAIL - DETAIL_WIDTH.min, detail: DETAIL_WIDTH.min });
  });

  it("shrinks the chat without growing card details back", () => {
    const width = chatResizer({ chat: CHAT, detail: DETAIL }, board(BOARD_WIDE));
    expect(width(-100)).toEqual({ chat: CHAT - 100, detail: DETAIL });
    expect(width(-5000)).toEqual({ chat: CHAT_WIDTH.min, detail: DETAIL });
  });

  it("does not jump when grabbed while neither the board nor card details have room to give", () => {
    const width = chatResizer({ chat: CHAT, detail: DETAIL_WIDTH.min }, board(BOARD_MIN - 100));
    expect(width(0)).toEqual({ chat: CHAT, detail: DETAIL_WIDTH.min });
    expect(width(50)).toEqual({ chat: CHAT, detail: DETAIL_WIDTH.min });
    expect(width(-50).chat).toBe(CHAT - 50);
  });

  it("starts from the shown width when the panels overflow the window", () => {
    const hidden = 200;
    expect(chatResizer({ chat: CHAT, detail: null }, board(-hidden))(0).chat).toBe(CHAT - hidden);
  });
});

describe("detailResizer", () => {
  it("keeps one board column instead of squeezing the board away", () => {
    expect(detailResizer(DETAIL, board(BOARD_WIDE))(5000)).toBe(Math.min(DETAIL_WIDTH.max, DETAIL + BOARD_WIDE - BOARD_MIN));
  });
});
