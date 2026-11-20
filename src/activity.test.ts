import { describe, expect, it } from "vitest";
import { relativeTime, stateTone, stateWord } from "./activity";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("says how long ago in plain words", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(relativeTime(NOW + 5 * MINUTE, NOW)).toBe("just now");
    expect(relativeTime(NOW - 50_000, NOW)).toBe("1 minute ago");
    expect(relativeTime(NOW - 17 * MINUTE, NOW)).toBe("17 minutes ago");
    expect(relativeTime(NOW - 61 * MINUTE, NOW)).toBe("1 hour ago");
    expect(relativeTime(NOW - 5 * HOUR, NOW)).toBe("5 hours ago");
    expect(relativeTime(NOW - 30 * HOUR, NOW)).toBe("yesterday");
    expect(relativeTime(NOW - 3 * DAY, NOW)).toBe("3 days ago");
    expect(relativeTime(NOW - 8 * DAY, NOW)).toBe("1 week ago");
    expect(relativeTime(NOW - 22 * DAY, NOW)).toBe("3 weeks ago");
    expect(relativeTime(NOW - 90 * DAY, NOW)).toMatch(/^on /);
  });
});

describe("status words", () => {
  it("turns states into plain words with a tone", () => {
    expect(stateWord("needs-decision")).toBe("Needs decision");
    expect(stateWord("working")).toBe("Working");
    expect(stateWord("")).toBe("Note");
    expect(stateTone("working")).toBe("active");
    expect(stateTone("needs-decision")).toBe("attention");
    expect(stateTone("blocked")).toBe("trouble");
    expect(stateTone("failed")).toBe("trouble");
    expect(stateTone("done")).toBe("good");
    expect(stateTone("paused")).toBe("quiet");
    expect(stateTone("mystery")).toBe("quiet");
  });
});
