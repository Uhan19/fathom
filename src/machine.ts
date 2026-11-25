import type { MemoryGroup, MemorySample, Worker } from "./api";
import { formatMemory } from "./memory";

const MB = 1024 * 1024;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const HISTORY_MS = HOUR;
export const REST_ID = "rest";

export type ItemKind = MemoryGroup["kind"] | "rest";

export interface MapItem {
  id: string;
  kind: ItemKind;
  name: string;
  bytes: number;
  group: MemoryGroup | null;
  note: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed<T> {
  item: T;
  rect: Rect;
}

export interface IdleWorker {
  group: MemoryGroup;
  idleForMs: number;
}

export interface Point {
  at: number;
  used: number;
}

export const KIND_ORDER: ItemKind[] = ["worker", "orchestrator", "fathom", "docker", "rest"];

export const KIND_NAMES: Record<ItemKind, string> = {
  worker: "Workers",
  orchestrator: "Orchestrator",
  fathom: "Fathom",
  docker: "Docker",
  rest: "Everything else",
};

export function mapItems(sample: MemorySample): MapItem[] {
  const groups: MapItem[] = sample.groups
    .filter((g) => g.bytes > 0)
    .map((g) => ({ id: g.id, kind: g.kind, name: g.kind === "orchestrator" ? "Orchestrator session" : g.name, bytes: g.bytes, group: g, note: "" }));
  const rest: MapItem = { id: REST_ID, kind: "rest", name: "Everything else", bytes: sample.rest.bytes, group: null, note: appsText(sample) };
  return [...groups, ...(rest.bytes > 0 ? [rest] : [])].sort((a, b) => b.bytes - a.bytes);
}

export function appsText(sample: MemorySample): string {
  const apps = sample.rest.apps.map((app) => `${app.name} ${formatMemory(app.bytes)}`);
  return apps.length ? `${apps.join(" · ")} · …` : "";
}

export function squarify<T>(items: { value: number; item: T }[], area: Rect): Placed<T>[] {
  const shown = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = shown.reduce((sum, i) => sum + i.value, 0);
  if (!total || area.w <= 0 || area.h <= 0) return [];
  const scale = (area.w * area.h) / total;
  const queue = shown.map((i) => ({ item: i.item, size: i.value * scale }));
  const placed: Placed<T>[] = [];
  let rect = { ...area };
  let row: typeof queue = [];
  const worst = (cells: typeof queue, side: number) => {
    const sum = cells.reduce((s, c) => s + c.size, 0);
    const largest = Math.max(...cells.map((c) => c.size));
    const smallest = Math.min(...cells.map((c) => c.size));
    return Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * smallest));
  };
  const lay = (cells: typeof queue) => {
    const sum = cells.reduce((s, c) => s + c.size, 0);
    if (rect.w >= rect.h) {
      const width = sum / rect.h;
      let y = rect.y;
      for (const c of cells) {
        const height = c.size / width;
        placed.push({ item: c.item, rect: { x: rect.x, y, w: width, h: height } });
        y += height;
      }
      rect = { x: rect.x + width, y: rect.y, w: rect.w - width, h: rect.h };
    } else {
      const height = sum / rect.w;
      let x = rect.x;
      for (const c of cells) {
        const width = c.size / height;
        placed.push({ item: c.item, rect: { x, y: rect.y, w: width, h: height } });
        x += width;
      }
      rect = { x: rect.x, y: rect.y + height, w: rect.w, h: rect.h - height };
    }
  };
  while (queue.length) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, queue[0]], side) <= worst(row, side)) row.push(queue.shift()!);
    else {
      lay(row);
      row = [];
    }
  }
  if (row.length) lay(row);
  return placed;
}

export function defaultSelection(sample: MemorySample): string {
  const largest = (kind: ItemKind) =>
    sample.groups.filter((g) => g.kind === kind && g.bytes > 0).sort((a, b) => b.bytes - a.bytes)[0];
  return (largest("worker") ?? largest("orchestrator") ?? largest("fathom"))?.id ?? REST_ID;
}

export function idleWorkers(sample: MemorySample, workers: Worker[], now: number): IdleWorker[] {
  const working = new Set(workers.filter((w) => w.status === "working").map((w) => w.taskId));
  return sample.groups
    .filter((g) => g.kind === "worker" && g.session && g.bytes > 0 && !(g.taskId && working.has(g.taskId)))
    .map((g) => ({ group: g, idleForMs: now - (g.session!.lastReplyMs + g.session!.warmMs) }))
    .filter((w) => w.idleForMs >= 0)
    .sort((a, b) => b.group.bytes - a.group.bytes);
}

export function splitTotals(sample: MemorySample) {
  const sum = (kinds: ItemKind[]) => sample.groups.filter((g) => kinds.includes(g.kind)).reduce((s, g) => s + g.bytes, 0);
  return {
    agents: sum(["worker", "orchestrator", "fathom"]),
    docker: sum(["docker"]),
    rest: sample.rest.bytes,
    available: sample.available,
  };
}

export function percentOf(bytes: number, total: number): string {
  if (!total) return "0%";
  const percent = (bytes / total) * 100;
  return percent >= 10 ? `${Math.round(percent)}%` : `${percent.toFixed(1)}%`;
}

export function tokensText(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tok`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k tok`;
  return `${tokens} tok`;
}

export function durationText(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} d`;
}

export function thresholdText(mb: number): string {
  return mb % 1024 === 0 ? `${mb / 1024} GB` : formatMemory(mb * MB);
}

export function isHeavy(bytes: number, thresholdMb: number): boolean {
  return bytes >= thresholdMb * MB;
}

const PLAIN: Record<string, string> = {
  "Headless Chrome": "browser",
  Chrome: "browser",
  "Browser automation helper": "browser",
  "Local dev server": "dev server",
  "Docker VM": "Docker VM",
  "Board assistant": "board assistant",
};

const STARTER: Record<ItemKind, string> = {
  worker: "this worker started",
  orchestrator: "the orchestrator started",
  fathom: "Fathom started",
  docker: "Docker runs",
  rest: "",
};

export function causeText(group: MemoryGroup, thresholdMb: number): string {
  const over = `Over ${thresholdText(thresholdMb)}`;
  const agent = (label: string) => label.startsWith("Agent (");
  const helpers = group.parts.filter((p) => !agent(p.label));
  const helperBytes = helpers.reduce((s, p) => s + p.bytes, 0);
  if (helperBytes * 2 < group.bytes) return `${over}, mostly the agent itself.`;
  const big = helpers.filter((p) => p.bytes * 10 >= group.bytes);
  const known = [...new Set(big.flatMap((p) => (PLAIN[p.label] ? [PLAIN[p.label]] : [])))];
  const other = big.filter((p) => !PLAIN[p.label]).map((p) => p.label);
  const named = [...(known.length ? [`the ${known.join(" and ")}`] : []), ...other];
  const list = named.length ? named.join(" and ") : "the programs";
  return `${over}, mostly ${list} ${STARTER[group.kind]}.`.replace(/ \.$/, ".");
}

export function withPoint(history: Point[], sample: MemorySample): Point[] {
  const at = sample.takenAtMs;
  if (history.length && history[history.length - 1].at >= at) return history;
  return [...history.filter((p) => at - p.at <= HISTORY_MS), { at, used: sample.used }];
}

export function sparkPath(history: Point[], width: number, height: number, total: number): string {
  if (history.length < 2 || !total) return "";
  const first = history[0].at;
  const span = Math.max(history[history.length - 1].at - first, 1);
  const low = Math.min(...history.map((p) => p.used));
  const high = Math.max(...history.map((p) => p.used));
  const pad = Math.max((high - low) * 0.15, total * 0.01);
  const bottom = Math.max(0, low - pad);
  const range = high + pad - bottom;
  return history
    .map((p, i) => `${i ? "L" : "M"}${(((p.at - first) / span) * width).toFixed(1)} ${(height - ((p.used - bottom) / range) * height).toFixed(1)}`)
    .join(" ");
}

export const ROOMY = 120;
const PAD_X = 12;
const PAD_Y = 16;
const GAP_Y = 3;
const NAME_LINE = 14;
const SIZE_LINE = 16;
const MORE_LINE = 15;
const TAG_LINE = 13;
const CHAR = 6.6;
const ROOMY_CHAR = 7.4;

export function blockLines(name: string, width: number, height: number, roomy: boolean) {
  const inner = width - PAD_X;
  const nameLines = Math.min(2, Math.ceil((name.length * (roomy ? ROOMY_CHAR : CHAR)) / Math.max(inner, 1)));
  const nameHeight = PAD_Y + nameLines * NAME_LINE * (roomy ? 1.15 : 1);
  const sizeHeight = nameHeight + GAP_Y + SIZE_LINE;
  const moreHeight = sizeHeight + GAP_Y + MORE_LINE;
  return {
    name: inner >= 26 && height >= PAD_Y + NAME_LINE,
    size: inner >= 46 && height >= sizeHeight,
    more: inner >= 46 && height >= moreHeight,
    tag: inner >= 78 && height >= moreHeight + GAP_Y + TAG_LINE,
  };
}
