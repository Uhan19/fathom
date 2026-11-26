import { describe, expect, it } from "vitest";
import type { Settings } from "./api";
import { defaultShortcuts } from "./shortcuts";
import { CHAT_WIDTH, DETAIL_WIDTH, USABLE_BOARD, boardRoomOf, chatResizer, detailResizer, fitPanels, keptAfterDetailDrag, keptWidth, withLatestWindow } from "./windowSettings";

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
  themeId: "nautical",
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
  memoryBadgeMb: 1024,
  view: "board",
  tokenMode: "raw",
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

const MINIMUM_WINDOW = 960;
const SIDE_WINDOW = 1280;
const HANDLE = 8;
const RAIL = 44;
const NAUTICAL_ONE_COLUMN = 150 + 10 + 280 + 32;
const MINIMUM_WINDOW_ROOM = MINIMUM_WINDOW - HANDLE - USABLE_BOARD;
const SIDE_WINDOW_ROOM = SIDE_WINDOW - 2 * HANDLE - USABLE_BOARD;

describe("fitPanels", () => {
  it("shows a stored 600px chat at 392px in the minimum window so the board keeps its room", () => {
    expect(fitPanels({ chat: 600, detail: null }, MINIMUM_WINDOW_ROOM).chat).toBe(392);
  });

  it("takes from the chat first, then the detail, when both panels are open", () => {
    expect(fitPanels({ chat: 600, detail: 460 }, 800)).toEqual({ chat: 340, detail: 460 });
    expect(fitPanels({ chat: 600, detail: 460 }, SIDE_WINDOW_ROOM)).toEqual({ chat: 300, detail: 404 });
  });

  it("never goes under the panel minimums", () => {
    expect(fitPanels({ chat: 600, detail: 460 }, 10)).toEqual({ chat: CHAT_WIDTH.min, detail: DETAIL_WIDTH.min });
  });

  it("brings the stored widths back when the window grows", () => {
    expect(fitPanels({ chat: 600, detail: 460 }, 5000)).toEqual({ chat: 600, detail: 460 });
    expect(fitPanels({ chat: 600, detail: 460 }, null)).toEqual({ chat: 600, detail: 460 });
  });

  it("keeps no room for a hidden chat", () => {
    expect(fitPanels({ chat: null, detail: 460 }, SIDE_WINDOW - RAIL - HANDLE - USABLE_BOARD)).toEqual({ chat: null, detail: 460 });
  });
});

describe("dragging a panel the window squeezed", () => {
  it("neither snaps a widening chat drag back nor lowers the stored width at the minimum window", () => {
    const widths = chatResizer({ chat: 392, detail: null }, boardRoomOf(MINIMUM_WINDOW - HANDLE - 392, NAUTICAL_ONE_COLUMN));
    const dropped = widths(80).chat;
    const saved = keptWidth(600, widths(0).chat, dropped);
    expect(fitPanels({ chat: saved, detail: null }, MINIMUM_WINDOW_ROOM).chat).toBe(dropped);
    expect(saved).toBe(600);
    expect(fitPanels({ chat: saved, detail: null }, 5000).chat).toBe(600);
  });

  it("saves a narrowing drag as the new width", () => {
    const widths = chatResizer({ chat: 392, detail: null }, boardRoomOf(MINIMUM_WINDOW - HANDLE - 392, NAUTICAL_ONE_COLUMN));
    const saved = keptWidth(600, widths(0).chat, widths(-50).chat);
    expect(saved).toBe(342);
    expect(fitPanels({ chat: saved, detail: null }, MINIMUM_WINDOW_ROOM).chat).toBe(342);
  });

  describe("with the card panel open", () => {
    const board = boardRoomOf(SIDE_WINDOW - 2 * HANDLE - 300 - 404, NAUTICAL_ONE_COLUMN);

    it("keeps both stored widths when the chat handle is clicked without moving", () => {
      const still = chatResizer({ chat: 300, detail: 404 }, board)(0);
      expect(keptWidth(600, 300, still.chat)).toBe(600);
      expect(keptWidth(460, 404, still.detail ?? 0)).toBe(460);
    });

    it("keeps a widened chat where it was dropped and brings its stored width back when the window grows", () => {
      const dropped = chatResizer({ chat: 300, detail: 404 }, board)(40);
      expect(dropped).toEqual({ chat: 340, detail: 364 });
      const saved = { chat: keptWidth(600, 300, dropped.chat), detail: keptWidth(460, 404, dropped.detail ?? 0) };
      expect(fitPanels(saved, SIDE_WINDOW_ROOM)).toEqual(dropped);
      expect(fitPanels(saved, 5000)).toEqual({ chat: 600, detail: 364 });
    });

    it("keeps both stored widths when the card panel handle cannot widen it", () => {
      const width = detailResizer(404, board);
      expect(width(60)).toBe(404);
      expect(keptAfterDetailDrag({ chat: 600, detail: 460 }, 300, width(0), width(60))).toEqual({ chat: 600, detail: 460 });
    });
  });

  describe("narrowing the card panel in the default 1440px window", () => {
    const DEFAULT_WINDOW = 1440;
    const room = DEFAULT_WINDOW - 2 * HANDLE - USABLE_BOARD;
    const boardOf = (shown: { chat: number | null; detail: number | null }) => DEFAULT_WINDOW - 2 * HANDLE - (shown.chat ?? 0) - (shown.detail ?? 0);

    it("leaves the board the room the drag gave it instead of handing it to the chat", () => {
      const shown = fitPanels({ chat: 600, detail: 460 }, room);
      expect(shown).toEqual({ chat: 404, detail: 460 });
      const width = detailResizer(460, boardRoomOf(boardOf(shown), NAUTICAL_ONE_COLUMN));
      expect(width(-60)).toBe(400);
      const after = fitPanels(keptAfterDetailDrag({ chat: 600, detail: 460 }, 404, width(0), width(-60)), room);
      expect(after).toEqual({ chat: 404, detail: 400 });
      expect(boardOf(after)).toBe(620);
    });
  });
});
