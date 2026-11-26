import type { QuotaReport, QuotaWindow } from "./api";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STALE_AFTER_MS = HOUR;
const CLOCK_ONLY_WITHIN_MS = 12 * HOUR;
const FULL = 100;

export type QuotaState = "never" | "stale" | "quiet" | "available";

export function quotaState(report: QuotaReport): QuotaState {
  if (report.available) return "available";
  if (report.lastSeenMs === null) return "never";
  return report.takenAtMs - report.lastSeenMs > STALE_AFTER_MS ? "stale" : "quiet";
}

export function spanText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} m` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export function resetText(resetsAtMs: number, nowMs: number, locale?: string): string {
  const at = new Date(resetsAtMs);
  const clock = at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (resetsAtMs - nowMs < CLOCK_ONLY_WITHIN_MS) return `Resets ${clock}, in ${spanText(resetsAtMs - nowMs)}`;
  return `Resets ${at.toLocaleDateString(locale, { weekday: "short" })} ${clock}`;
}

export function runsShort(window: QuotaWindow): boolean {
  return window.runsOutAtMs !== null;
}

export function usedText(window: QuotaWindow): string {
  const shown = window.usedPercent >= FULL ? FULL : Math.min(FULL - 1, Math.round(window.usedPercent));
  return `${shown}% used`;
}

export function paceText(window: QuotaWindow, nowMs: number): string {
  if (window.usedPercent >= FULL) return "limit reached";
  if (window.percentPerHour === null) return "";
  if (window.runsOutAtMs === null) return "lasts until reset at this pace";
  return `at this pace you reach the limit in about ${spanText(window.runsOutAtMs - nowMs)}`;
}

export function windowLine(window: QuotaWindow, nowMs: number, locale?: string): string {
  return [resetText(window.resetsAtMs, nowMs, locale), paceText(window, nowMs)].filter(Boolean).join(" · ");
}

export function hasPace(report: QuotaReport): boolean {
  return [report.fiveHour, report.sevenDay].some((w) => w !== null && w.percentPerHour !== null);
}

export function lastSeenText(report: QuotaReport): string {
  if (report.lastSeenMs === null) return "Checks again every minute";
  return `Last seen ${spanText(report.takenAtMs - report.lastSeenMs)} ago · checks again every minute`;
}
