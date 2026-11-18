import type { Settings } from "./api";

export function withLatestWindow(draft: Settings, latest: Settings): Settings {
  const { theme, chatOpen, chatWidth, detailWidth, projectFilter, helperStarted } = latest;
  return { ...draft, theme, chatOpen, chatWidth, detailWidth, projectFilter, helperStarted };
}
