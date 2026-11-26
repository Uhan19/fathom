import { describe, expect, it } from "vitest";
import type { QuotaReport, QuotaWindow } from "./api";
import { hasPace, lastSeenText, paceText, quotaState, resetText, runsShort, spanText, usedText, windowLine } from "./quota";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date(2026, 9, 14, 13, 48).getTime();

const win = (over: Partial<QuotaWindow> = {}): QuotaWindow => ({
  usedPercent: 62,
  resetsAtMs: NOW + 112 * MINUTE,
  percentPerHour: 34,
  runsOutAtMs: NOW + 70 * MINUTE,
  ...over,
});

const report = (over: Partial<QuotaReport> = {}): QuotaReport => ({
  takenAtMs: NOW,
  available: true,
  lastSeenMs: NOW - MINUTE,
  fiveHour: win(),
  sevenDay: win({ usedPercent: 48, resetsAtMs: NOW + 4 * 24 * HOUR, percentPerHour: 0.4, runsOutAtMs: null }),
  recordLine: 'echo "$input" | \'/Applications/Fathom.app/Contents/MacOS/fathom\' --quota-record &',
  ...over,
});

describe("plan limits", () => {
  it("tells apart never recorded, stale, quiet and available", () => {
    expect(quotaState(report())).toBe("available");
    expect(quotaState(report({ available: false, lastSeenMs: null, fiveHour: null, sevenDay: null }))).toBe("never");
    expect(quotaState(report({ available: false, lastSeenMs: NOW - 2 * HOUR, fiveHour: null, sevenDay: null }))).toBe("stale");
    expect(quotaState(report({ available: false, lastSeenMs: NOW - 5 * MINUTE, fiveHour: null, sevenDay: null }))).toBe("quiet");
  });

  it("writes spans in hours and minutes", () => {
    expect(spanText(20_000)).toBe("1 m");
    expect(spanText(45 * MINUTE)).toBe("45 m");
    expect(spanText(112 * MINUTE)).toBe("1 h 52 m");
    expect(spanText(3 * HOUR)).toBe("3 h");
    expect(spanText(26 * HOUR)).toBe("1 d 2 h");
    expect(spanText(134 * MINUTE)).toBe("2 h 14 m");
  });

  it("gives a near reset as a clock time with the time left, and a far one with its weekday", () => {
    expect(resetText(NOW + 112 * MINUTE, NOW, "en-US")).toBe("Resets 3:40 PM, in 1 h 52 m");
    expect(resetText(new Date(2026, 9, 19, 9, 0).getTime(), NOW, "en-US")).toBe("Resets Mon 9:00 AM");
  });

  it("turns amber only when the runway ends before the reset", () => {
    expect(runsShort(win())).toBe(true);
    expect(runsShort(win({ runsOutAtMs: null }))).toBe(false);
  });

  it("words the runway from the recorded pace only", () => {
    expect(paceText(win(), NOW)).toBe("at this pace you reach the limit in about 1 h 10 m");
    expect(paceText(win({ runsOutAtMs: null }), NOW)).toBe("lasts until reset at this pace");
    expect(paceText(win({ percentPerHour: null, runsOutAtMs: null }), NOW)).toBe("");
    expect(paceText(win({ usedPercent: 100, runsOutAtMs: NOW }), NOW)).toBe("limit reached");
    expect(windowLine(win(), NOW, "en-US")).toBe("Resets 3:40 PM, in 1 h 52 m · at this pace you reach the limit in about 1 h 10 m");
    expect(windowLine(win({ percentPerHour: null, runsOutAtMs: null }), NOW, "en-US")).toBe("Resets 3:40 PM, in 1 h 52 m");
  });

  it("never rounds a window up to full", () => {
    expect(usedText(win({ usedPercent: 99.6 }))).toBe("99% used");
    expect(usedText(win({ usedPercent: 100 }))).toBe("100% used");
    expect(usedText(win({ usedPercent: 47.5 }))).toBe("48% used");
  });

  it("mentions the pace only when some window has one", () => {
    expect(hasPace(report())).toBe(true);
    expect(hasPace(report({ fiveHour: win({ percentPerHour: null, runsOutAtMs: null }), sevenDay: null }))).toBe(false);
  });

  it("says when quota was last seen", () => {
    expect(lastSeenText(report({ lastSeenMs: NOW - 134 * MINUTE }))).toBe("Last seen 2 h 14 m ago · checks again every minute");
    expect(lastSeenText(report({ lastSeenMs: null }))).toBe("Checks again every minute");
  });
});
