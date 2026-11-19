import type { Settings } from "./api";

export const DETAIL_WIDTH = { min: 340, max: 900 };
export const CHAT_WIDTH = { min: 300, max: 1400 };

export function withLatestWindow(draft: Settings, latest: Settings): Settings {
  const { theme, chatOpen, chatWidth, detailWidth, projectFilter, helperStarted } = latest;
  return { ...draft, theme, chatOpen, chatWidth, detailWidth, projectFilter, helperStarted };
}
