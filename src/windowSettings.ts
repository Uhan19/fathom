import type { Settings } from "./api";
import { MIN_COLUMN_WIDTH, ROW_LABEL_WIDTH } from "./board";
import { resizer } from "./drag";

export const DETAIL_WIDTH = { min: 340, max: 900 };
export const CHAT_WIDTH = { min: 300, max: 1400 };
export const BOARD_MIN_WIDTH = ROW_LABEL_WIDTH + MIN_COLUMN_WIDTH;

export interface PanelWidths {
  chat: number;
  detail: number | null;
}

export function spareBoard(boardShown: number): number {
  return boardShown < 0 ? boardShown : Math.max(0, boardShown - BOARD_MIN_WIDTH);
}

export function detailResizer(width: number, boardShown: number): (growth: number) => number {
  return resizer(width, width + spareBoard(boardShown), DETAIL_WIDTH);
}

export function chatResizer(start: PanelWidths, boardShown: number): (growth: number) => PanelWidths {
  const fromBoard = spareBoard(boardShown);
  const fromDetail = start.detail === null ? 0 : Math.max(0, start.detail - DETAIL_WIDTH.min);
  const chat = resizer(start.chat, start.chat + fromBoard + fromDetail, CHAT_WIDTH);
  const shownChat = chat(0);
  return (growth) => {
    const next = chat(growth);
    const takenFromDetail = Math.max(0, next - shownChat - Math.max(0, fromBoard));
    return { chat: next, detail: start.detail === null ? null : start.detail - takenFromDetail };
  };
}

export function withLatestWindow(draft: Settings, latest: Settings): Settings {
  const { theme, chatOpen, chatWidth, detailWidth, projectFilter, agentFilter, helperStarted } = latest;
  return { ...draft, theme, chatOpen, chatWidth, detailWidth, projectFilter, agentFilter, helperStarted };
}
