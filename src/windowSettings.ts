import type { Settings } from "./api";
import { resizer } from "./drag";

export const DETAIL_WIDTH = { min: 340, max: 900 };
export const CHAT_WIDTH = { min: 300, max: 1400 };

export const USABLE_BOARD = 560;

export interface BoardRoom {
  shown: number;
  min: number;
}

export interface PanelWidths {
  chat: number;
  detail: number | null;
}

export interface OpenPanels {
  chat: number | null;
  detail: number | null;
}

export function boardRoomOf(shown: number, oneVisible: number): BoardRoom {
  return { shown, min: Math.max(oneVisible, USABLE_BOARD) };
}

export function spareBoard(board: BoardRoom): number {
  return board.shown < 0 ? board.shown : Math.max(0, board.shown - board.min);
}

export function detailResizer(width: number, board: BoardRoom): (growth: number) => number {
  return resizer(width, width + spareBoard(board), DETAIL_WIDTH);
}

export function chatResizer(start: PanelWidths, board: BoardRoom): (growth: number) => PanelWidths {
  const fromBoard = spareBoard(board);
  const fromDetail = start.detail === null ? 0 : Math.max(0, start.detail - DETAIL_WIDTH.min);
  const chat = resizer(start.chat, start.chat + fromBoard + fromDetail, CHAT_WIDTH);
  const shownChat = chat(0);
  return (growth) => {
    const next = chat(growth);
    const takenFromDetail = Math.max(0, next - shownChat - Math.max(0, fromBoard));
    return { chat: next, detail: start.detail === null ? null : start.detail - takenFromDetail };
  };
}

export function fitPanels(stored: OpenPanels, budget: number | null): OpenPanels {
  if (budget === null) return stored;
  const room = Math.max(0, Math.floor(budget));
  const chat = stored.chat === null ? null : Math.max(CHAT_WIDTH.min, Math.min(stored.chat, room - (stored.detail ?? 0)));
  const detail = stored.detail === null ? null : Math.max(DETAIL_WIDTH.min, Math.min(stored.detail, room - (chat ?? 0)));
  return { chat, detail };
}

export function keptWidth(stored: number, from: number, to: number): number {
  return to < from ? to : Math.max(stored, to);
}

export function withLatestWindow(draft: Settings, latest: Settings): Settings {
  const { theme, chatOpen, chatWidth, detailWidth, projectFilter, agentFilter, helperStarted } = latest;
  return { ...draft, theme, chatOpen, chatWidth, detailWidth, projectFilter, agentFilter, helperStarted };
}
