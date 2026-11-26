import type { MemoryGroup, MemorySample } from "./api";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const THRESHOLDS_MB = [512, 768, 1024, 1536, 2048, 3072, 4096, 8192];

export interface MemoryBadge {
  bytes: number;
  high: boolean;
  text: string;
  breakdown: string;
}

export function formatMemory(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / MB))} MB`;
}

export function breakdownOf(group: MemoryGroup): string {
  return group.parts.map((part) => `${part.label} ${formatMemory(part.bytes)}`).join("\n");
}

export function badgesByTask(sample: MemorySample | null, thresholdMb: number): Record<string, MemoryBadge> {
  if (!sample) return {};
  const badges: Record<string, MemoryBadge> = {};
  for (const group of sample.groups) {
    if (group.kind !== "worker" || !group.taskId) continue;
    badges[group.taskId] = {
      bytes: group.bytes,
      high: group.bytes >= thresholdMb * MB,
      text: formatMemory(group.bytes),
      breakdown: breakdownOf(group),
    };
  }
  return badges;
}

export function badgeThresholds(current: number): number[] {
  return [...new Set([...THRESHOLDS_MB, current])].sort((a, b) => a - b);
}
