import { describe, expect, it } from "vitest";
import type { TokenDay, TokenReport } from "./api";
import { axisLabels, byValue, consumerName, dollars, mix, modelName, overheadText, periods, shareText, sum, tokensShort, valueText } from "./tokens";

const day = (date: string, read: number, cost = 1): TokenDay => ({
  date,
  startMs: 0,
  input: 1_000,
  output: 2_000,
  cacheWrite: 30_000,
  cacheRead: read,
  cost: { input: 0.01 * cost, output: 0.19 * cost, cacheWrite: 0.44 * cost, cacheRead: 0.36 * cost },
});

const days = Array.from({ length: 30 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, 1_000_000 * (i + 1)));

const report = (over: Partial<TokenReport> = {}): TokenReport => ({
  takenAtMs: 0,
  days,
  models: [],
  consumers: [],
  projects: [],
  overhead: { assistantTokens: 2_900_000, assistantQuestions: 30, moveRequests: [1_200_000, 2_400_000, 1_900_000], weekTokens: 2_000_000_000, weekOverheadTokens: 5_400_000 },
  unpriced: [],
  pricesError: null,
  ...over,
});

describe("token numbers", () => {
  it("names models the way the plans do", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelName("claude-fable-5-2")).toBe("Fable 5.2");
    expect(modelName("gpt-x")).toBe("gpt-x");
  });

  it("splits the report into today, this week, the week before and the month", () => {
    const p = periods(report());
    expect([p.today.length, p.week.length, p.lastWeek.length, p.month.length]).toEqual([1, 7, 7, 30]);
    expect(p.today[0].date).toBe("2026-10-30");
    expect(p.lastWeek[0].date).toBe("2026-10-17");
    expect(sum(p.today, "raw")).toBe(30_033_000);
    expect(sum(p.today, "cost")).toBeCloseTo(1);
  });

  it("formats tokens and dollars compactly", () => {
    expect(tokensShort(2_100_000_000)).toBe("2.1B");
    expect(tokensShort(422_000_000)).toBe("422M");
    expect(tokensShort(2_900_000)).toBe("2.9M");
    expect(tokensShort(97_300)).toBe("97k");
    expect(tokensShort(84_000_000)).toBe("84M");
    expect(dollars(46)).toBe("$46");
    expect(dollars(4.321)).toBe("$4.32");
    expect(dollars(1234.5)).toBe("$1,235");
    expect(valueText(106_000_000, "raw")).toBe("106M");
    expect(valueText(4.5, "cost")).toBe("$4.50");
    expect(valueText(12.5, "cost")).toBe("$13");
  });

  it("gives the mix of each kind, and a sliver reads as under 1%", () => {
    const shares = mix(days, "raw");
    expect(shares.map((s) => s.kind)).toEqual(["cacheRead", "cacheWrite", "output", "input"]);
    expect(shares.reduce((t, s) => t + s.share, 0)).toBeCloseTo(1);
    expect(shareText(shares[3].value, sum(days, "raw"))).toBe("<1%");
    expect(shareText(37, 100)).toBe("37%");
    expect(shareText(0, 100)).toBe("0%");
  });

  it("labels the chart from the first day to today", () => {
    expect(axisLabels(days)).toEqual(["Oct 1", "Oct 8", "Oct 16", "Oct 23", "Today"]);
  });

  it("calls the orchestrator a session and keeps other names", () => {
    expect(consumerName({ role: "orchestrator", name: "Orchestrator", taskId: null, tokens: 1, cost: 0 })).toBe("Orchestrator session");
    expect(consumerName({ role: "worker", name: "Split the invoice service", taskId: "atl-9", tokens: 1, cost: 0 })).toBe("Split the invoice service");
  });

  it("orders a breakdown by the shown measure", () => {
    const shares = [
      { name: "a", tokens: 300, cost: 1 },
      { name: "b", tokens: 100, cost: 9 },
    ];
    expect(byValue(shares, "raw").map((s) => s.name)).toEqual(["a", "b"]);
    expect(byValue(shares, "cost").map((s) => s.name)).toEqual(["b", "a"]);
  });

  it("sums up Fathom's own overhead", () => {
    expect(overheadText(report())).toEqual({ assistant: "2.9M", perQuestion: "97k", moves: "1.2M–2.4M", shareLead: "", share: "0.27%" });
    const tiny = overheadText(report({ overhead: { assistantTokens: 0, assistantQuestions: 0, moveRequests: [], weekTokens: 10_000, weekOverheadTokens: 1 } }));
    expect([tiny.shareLead, tiny.share]).toEqual(["under ", "0.1%"]);
    const quiet = overheadText(report({ overhead: { assistantTokens: 0, assistantQuestions: 0, moveRequests: [], weekTokens: 0, weekOverheadTokens: 0 } }));
    expect(quiet).toEqual({ assistant: "0", perQuestion: "", moves: "", shareLead: "", share: "0%" });
  });
});
