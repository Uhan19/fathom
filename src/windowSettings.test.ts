import { describe, expect, it } from "vitest";
import type { Settings } from "./api";
import { defaultShortcuts } from "./shortcuts";
import { BOARD_MIN_WIDTH, CHAT_WIDTH, DETAIL_WIDTH, chatResizer, detailResizer, withLatestWindow } from "./windowSettings";

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
const BOARD_WITH_DETAIL = WINDOW - HANDLES - CHAT - DETAIL;

describe("chatResizer", () => {
  it("grows the chat the same way with card details open as without, until the board would get too narrow", () => {
    const withDetail = chatResizer({ chat: CHAT, detail: DETAIL }, BOARD_WITH_DETAIL);
    const without = chatResizer({ chat: CHAT, detail: null }, BOARD_WITH_DETAIL + DETAIL);
    expect([1, 10, 20].map((g) => withDetail(g).chat)).toEqual([1, 10, 20].map((g) => without(g).chat));
    expect(withDetail(20).detail).toBe(DETAIL);
  });

  it("takes room from card details once the board is at its narrowest, instead of squeezing the board away", () => {
    const width = chatResizer({ chat: CHAT, detail: DETAIL }, BOARD_WITH_DETAIL);
    const boardSpare = BOARD_WITH_DETAIL - BOARD_MIN_WIDTH;
    expect(width(boardSpare + 50)).toEqual({ chat: CHAT + boardSpare + 50, detail: DETAIL - 50 });
  });

  it("stops when the board and card details are both at their narrowest", () => {
    const width = chatResizer({ chat: CHAT, detail: DETAIL }, BOARD_WITH_DETAIL);
    const widest = width(5000);
    expect(widest.detail).toBe(DETAIL_WIDTH.min);
    expect(WINDOW - HANDLES - widest.chat - (widest.detail ?? 0)).toBe(BOARD_MIN_WIDTH);
  });

  it("shrinks the chat without growing card details back", () => {
    const width = chatResizer({ chat: CHAT, detail: DETAIL }, BOARD_WITH_DETAIL);
    expect(width(-100)).toEqual({ chat: CHAT - 100, detail: DETAIL });
    expect(width(-5000)).toEqual({ chat: CHAT_WIDTH.min, detail: DETAIL });
  });

  it("does not jump when grabbed while the board is already narrower than its minimum", () => {
    const width = chatResizer({ chat: CHAT, detail: DETAIL_WIDTH.min }, BOARD_MIN_WIDTH - 100);
    expect(width(0)).toEqual({ chat: CHAT, detail: DETAIL_WIDTH.min });
    expect(width(50)).toEqual({ chat: CHAT, detail: DETAIL_WIDTH.min });
    expect(width(-50).chat).toBe(CHAT - 50);
  });

  it("starts from the shown width when the panels overflow the window", () => {
    const hidden = 200;
    const width = chatResizer({ chat: CHAT, detail: null }, -hidden);
    expect(width(0).chat).toBe(CHAT - hidden);
  });
});

describe("detailResizer", () => {
  it("keeps the board at its narrowest instead of squeezing it away", () => {
    expect(detailResizer(DETAIL, BOARD_WITH_DETAIL)(5000)).toBe(DETAIL + BOARD_WITH_DETAIL - BOARD_MIN_WIDTH);
  });
});
