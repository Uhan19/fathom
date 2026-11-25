import { describe, expect, it } from "vitest";
import type { MemoryGroup, MemorySample } from "./api";
import { badgesByTask, badgeThresholds, formatMemory } from "./memory";

const MB = 1024 * 1024;

const group = (over: Partial<MemoryGroup>): MemoryGroup => ({
  kind: "worker",
  id: "worker:demo",
  name: "Demo task",
  taskId: "demo-1",
  terminal: "t1",
  bytes: 410 * MB,
  parts: [{ label: "Agent (Claude Code)", bytes: 410 * MB, processes: 1 }],
  ...over,
});

const sample = (groups: MemoryGroup[]): MemorySample => ({
  takenAtMs: 0,
  total: 16384 * MB,
  used: 8192 * MB,
  available: 8192 * MB,
  pressure: "normal",
  activityMonitor: true,
  herdrConnected: true,
  groups,
  rest: { bytes: 0, apps: [] },
});

describe("memory badges", () => {
  it("formats sizes as whole megabytes, then gigabytes with one decimal", () => {
    expect(formatMemory(410 * MB)).toBe("410 MB");
    expect(formatMemory(1023 * MB)).toBe("1023 MB");
    expect(formatMemory(1434 * MB)).toBe("1.4 GB");
    expect(formatMemory(10)).toBe("1 MB");
  });

  it("gives each running worker a badge, amber at the threshold and up", () => {
    const badges = badgesByTask(
      sample([
        group({}),
        group({
          id: "worker:heavy",
          taskId: "heavy-2",
          bytes: 1024 * MB,
          parts: [
            { label: "Agent (Claude Code)", bytes: 300 * MB, processes: 1 },
            { label: "Headless Chrome", bytes: 724 * MB, processes: 6 },
          ],
        }),
        group({ kind: "fathom", id: "fathom", taskId: null }),
        group({ id: "worker:untasked", taskId: null }),
      ]),
      1024,
    );
    expect(Object.keys(badges).sort()).toEqual(["demo-1", "heavy-2"]);
    expect(badges["demo-1"]).toMatchObject({ text: "410 MB", high: false });
    expect(badges["heavy-2"]).toMatchObject({ text: "1.0 GB", high: true, breakdown: "Agent (Claude Code) 300 MB\nHeadless Chrome 724 MB" });
  });

  it("shows nothing without a sample", () => {
    expect(badgesByTask(null, 1024)).toEqual({});
  });
});

describe("badge thresholds", () => {
  it("offers the usual sizes and keeps a stored one that is not among them", () => {
    expect(badgeThresholds(1024)).toContain(1024);
    expect(badgeThresholds(1200)).toEqual([512, 768, 1024, 1200, 1536, 2048, 3072, 4096, 8192]);
  });
});
