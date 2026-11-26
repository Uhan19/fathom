import { describe, expect, it } from "vitest";
import type { MemoryGroup, MemorySample, Worker } from "./api";
import { blockLines, causeText, defaultSelection, durationText, idleWorkers, mapItems, percentOf, sparkPath, splitTotals, squarify, stopKey, thresholdText, tokensText, withPoint } from "./machine";

const MB = 1024 * 1024;
const NOW = 1_900_000_000_000;
const MINUTE = 60_000;

const group = (over: Partial<MemoryGroup>): MemoryGroup => ({
  kind: "worker",
  id: "worker:a",
  name: "Task A",
  taskId: "a",
  terminal: "t1",
  bytes: 400 * MB,
  parts: [{ label: "Agent (Claude Code)", bytes: 400 * MB, processes: 2 }],
  session: null,
  ...over,
});

const sample = (groups: MemoryGroup[], restBytes = 8000 * MB): MemorySample => ({
  takenAtMs: NOW,
  total: 24576 * MB,
  used: 14000 * MB,
  available: 10576 * MB,
  pressure: "normal",
  activityMonitor: true,
  herdrConnected: true,
  groups,
  rest: { bytes: restBytes, apps: [{ name: "macOS", bytes: 4300 * MB }, { name: "Chrome", bytes: 2150 * MB }] },
});

describe("the treemap layout", () => {
  const values = [5000, 1400, 800, 640, 442, 410, 352, 306, 262];
  const placed = squarify(values.map((value, i) => ({ value, item: i })), { x: 0, y: 0, w: 788, h: 330 });

  it("gives every item an area in proportion to its size and fills the box", () => {
    const total = values.reduce((s, v) => s + v, 0);
    expect(placed).toHaveLength(values.length);
    for (const { item, rect } of placed) {
      expect((rect.w * rect.h) / (788 * 330)).toBeCloseTo(values[item] / total, 6);
      expect(rect.x).toBeGreaterThanOrEqual(-1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-6);
      expect(rect.x + rect.w).toBeLessThanOrEqual(788 + 1e-6);
      expect(rect.y + rect.h).toBeLessThanOrEqual(330 + 1e-6);
    }
  });

  it("never overlaps two blocks", () => {
    for (const a of placed)
      for (const b of placed) {
        if (a === b) continue;
        const overlapX = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
        const overlapY = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
        expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false);
      }
  });

  it("keeps blocks close to square", () => {
    const ratios = placed.map(({ rect }) => Math.max(rect.w / rect.h, rect.h / rect.w));
    expect(Math.max(...ratios)).toBeLessThan(4);
  });

  it("skips empty items and an empty box", () => {
    expect(squarify([{ value: 0, item: "x" }], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(squarify([{ value: 5, item: "x" }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
  });
});

describe("the memory map items", () => {
  it("lists the groups and everything else, largest first, with the biggest apps", () => {
    const items = mapItems(sample([group({}), group({ kind: "orchestrator", id: "orchestrator", name: "Orchestrator", taskId: null, bytes: 800 * MB })]));
    expect(items.map((i) => i.name)).toEqual(["Everything else", "Orchestrator session", "Task A"]);
    expect(items[0].note).toBe("macOS 4.2 GB · Chrome 2.1 GB · …");
  });

  it("selects the largest worker, else the orchestrator, else Fathom", () => {
    const small = group({ id: "worker:s", bytes: 100 * MB });
    const big = group({ id: "worker:b", bytes: 900 * MB });
    const orchestrator = group({ kind: "orchestrator", id: "orchestrator", taskId: null, bytes: 2000 * MB });
    const fathom = group({ kind: "fathom", id: "fathom", taskId: null, bytes: 500 * MB });
    expect(defaultSelection(sample([small, big, orchestrator, fathom]))).toBe("worker:b");
    expect(defaultSelection(sample([orchestrator, fathom]))).toBe("orchestrator");
    expect(defaultSelection(sample([fathom]))).toBe("fathom");
    expect(defaultSelection(sample([]))).toBe("rest");
  });

  it("splits used memory into agents and Fathom, Docker and everything else", () => {
    const totals = splitTotals(sample([group({}), group({ kind: "fathom", id: "fathom", bytes: 300 * MB }), group({ kind: "docker", id: "docker", bytes: 350 * MB })]));
    expect(totals).toEqual({ agents: 700 * MB, docker: 350 * MB, rest: 8000 * MB, available: 10576 * MB });
  });
});

describe("idle workers", () => {
  const worker = (taskId: string, status: Worker["status"]): Worker => ({ taskId, terminal: "t", status });
  const session = (minutesAgo: number, warmMinutes = 5) => ({ contextTokens: 88_000, lastReplyMs: NOW - minutesAgo * MINUTE, warmMs: warmMinutes * MINUTE });

  it("counts a quiet worker idle once its prompt cache has expired", () => {
    const groups = [
      group({ id: "worker:a", taskId: "a", session: session(125, 5) }),
      group({ id: "worker:b", taskId: "b", session: session(3, 5) }),
      group({ id: "worker:c", taskId: "c", session: session(50, 60) }),
      group({ id: "worker:d", taskId: "d", session: null }),
    ];
    const idle = idleWorkers(sample(groups), [worker("a", "idle"), worker("b", "idle"), worker("c", "idle")], NOW);
    expect(idle.map((w) => [w.group.taskId, w.idleForMs / MINUTE])).toEqual([["a", 120]]);
  });

  it("never offers a worker that is still working, however long its tool runs", () => {
    const groups = [group({ taskId: "a", session: session(120) })];
    expect(idleWorkers(sample(groups), [worker("a", "working")], NOW)).toEqual([]);
  });

  it("keeps a stop with one idle spell, so a worker that replies again or starts again on the task can be stopped again", () => {
    const stopped = group({ taskId: "a", session: session(125) });
    expect(stopKey({ ...stopped, bytes: 900 * MB })).toBe(stopKey(stopped));
    expect(stopKey(group({ taskId: "a", terminal: "t2", session: session(30) }))).not.toBe(stopKey(stopped));
  });
});

describe("the over-threshold note", () => {
  it("names what the worker started when that is most of it", () => {
    const heavy = group({
      bytes: 1420 * MB,
      parts: [
        { label: "Headless Chrome", bytes: 529 * MB, processes: 7 },
        { label: "Browser automation helper", bytes: 354 * MB, processes: 2 },
        { label: "Agent (Claude Code)", bytes: 300 * MB, processes: 3 },
        { label: "Local dev server", bytes: 237 * MB, processes: 2 },
      ],
    });
    expect(causeText(heavy, 1024)).toBe("Over 1 GB, mostly the browser and dev server this worker started.");
  });

  it("words Docker without a starter", () => {
    const docker = group({ kind: "docker", id: "docker", taskId: null, bytes: 2000 * MB, parts: [{ label: "Docker VM", bytes: 1800 * MB, processes: 1 }, { label: "Docker Desktop", bytes: 200 * MB, processes: 6 }] });
    expect(causeText(docker, 1024)).toBe("Over 1 GB, mostly the Docker VM and Docker Desktop.");
  });

  it("names other programs as they are", () => {
    const own = group({ bytes: 1300 * MB, parts: [{ label: "fathom", bytes: 840 * MB, processes: 1 }, { label: "Agent (Claude Code)", bytes: 415 * MB, processes: 2 }, { label: "Local dev server", bytes: 140 * MB, processes: 1 }] });
    expect(causeText(own, 1024)).toBe("Over 1 GB, mostly the dev server and fathom, which this worker started.");
  });

  it("says when the agent itself is the bulk", () => {
    expect(causeText(group({ bytes: 1500 * MB, parts: [{ label: "Agent (Claude Code)", bytes: 1400 * MB, processes: 3 }, { label: "Shell", bytes: 100 * MB, processes: 1 }] }), 1536)).toBe(
      "Over 1.5 GB, mostly the agent itself.",
    );
  });
});

describe("numbers", () => {
  it("formats percent, tokens, durations and the threshold", () => {
    expect(percentOf(1434 * MB, 24576 * MB)).toBe("5.8%");
    expect(percentOf(10547 * MB, 24576 * MB)).toBe("43%");
    expect(tokensText(96_400)).toBe("96k tok");
    expect(tokensText(1_250_000)).toBe("1.3M tok");
    expect(durationText(4 * MINUTE)).toBe("4 min");
    expect(durationText(130 * MINUTE)).toBe("2 h");
    expect(durationText(30 * 60 * MINUTE)).toBe("1 d");
    expect(thresholdText(1024)).toBe("1 GB");
    expect(thresholdText(768)).toBe("768 MB");
  });
});

describe("the last hour", () => {
  it("keeps one point per sample for an hour and draws a line through them", () => {
    let history = withPoint([], { ...sample([]), takenAtMs: NOW - 70 * MINUTE });
    history = withPoint(history, { ...sample([]), takenAtMs: NOW - 30 * MINUTE, used: 15000 * MB });
    history = withPoint(history, { ...sample([]), takenAtMs: NOW });
    history = withPoint(history, { ...sample([]), takenAtMs: NOW });
    expect(history.map((p) => (NOW - p.at) / MINUTE)).toEqual([30, 0]);
    expect(sparkPath(history, 200, 40, 24576 * MB)).toMatch(/^M0\.0 [\d.]+ L200\.0 [\d.]+$/);
    expect(sparkPath(history.slice(0, 1), 200, 40, 1)).toBe("");
  });
});

describe("block labels", () => {
  it("shows each line only when it fits under a name that may wrap", () => {
    expect(blockLines("Docker", 200, 120, true)).toEqual({ name: true, size: true, more: true, tag: true });
    expect(blockLines("Rotate the staging certificates", 72, 50, false)).toEqual({ name: true, size: false, more: false, tag: false });
    expect(blockLines("Fathom", 72, 52, false)).toMatchObject({ name: true, size: true, more: false });
    expect(blockLines("Docker", 20, 120, false).name).toBe(false);
    expect(blockLines("Harness course", 100, 140, false)).toMatchObject({ more: true, tag: false });
    expect(blockLines("Harness course", 180, 140, true).tag).toBe(true);
  });
});
