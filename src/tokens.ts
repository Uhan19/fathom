import type { ConsumerShare, Costs, TokenDay, TokenMode, TokenReport, TokenShare } from "./api";

export const WEEK = 7;
export const TOP = 8;
export const KINDS = ["cacheRead", "cacheWrite", "output", "input"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_NAMES: Record<Kind, string> = {
  cacheRead: "Cache read",
  cacheWrite: "Cache write",
  output: "Output",
  input: "Fresh input",
};

const ROLE_NAMES: Partial<Record<ConsumerShare["role"], string>> = {
  orchestrator: "Orchestrator session",
};

const FAMILIES = ["opus", "sonnet", "haiku", "fable", "mythos"];
const DATE_STAMP = /^\d{8}$/;
const LABEL_COUNT = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function modelName(id: string): string {
  const parts = id.replace(/^claude-/, "").split("-").filter((p) => !DATE_STAMP.test(p));
  const family = parts.find((p) => FAMILIES.includes(p));
  if (!family) return id;
  const version = parts.filter((p) => /^\d+$/.test(p)).join(".");
  return `${family[0].toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ""}`;
}

export function consumerName(consumer: ConsumerShare): string {
  return ROLE_NAMES[consumer.role] ?? consumer.name;
}

export function dayTokens(day: TokenDay, kind?: Kind): number {
  return kind ? day[kind] : day.input + day.output + day.cacheWrite + day.cacheRead;
}

export function dayCost(day: TokenDay, kind?: Kind): number {
  const cost: Costs = day.cost;
  return kind ? cost[kind] : cost.input + cost.output + cost.cacheWrite + cost.cacheRead;
}

export function dayValue(day: TokenDay, mode: TokenMode, kind?: Kind): number {
  return mode === "raw" ? dayTokens(day, kind) : dayCost(day, kind);
}

export function shareValue(share: TokenShare, mode: TokenMode): number {
  return mode === "raw" ? share.tokens : share.cost;
}

export function byValue<T extends TokenShare>(shares: T[], mode: TokenMode): T[] {
  return [...shares].sort((a, b) => shareValue(b, mode) - shareValue(a, mode));
}

export function top<T extends TokenShare>(shares: T[], mode: TokenMode): T[] {
  return byValue(shares, mode).slice(0, TOP);
}

export function sum(days: TokenDay[], mode: TokenMode, kind?: Kind): number {
  return days.reduce((total, day) => total + dayValue(day, mode, kind), 0);
}

export function periods(report: TokenReport) {
  const days = report.days;
  return {
    today: days.slice(-1),
    week: days.slice(-WEEK),
    lastWeek: days.slice(-2 * WEEK, -WEEK),
    month: days,
  };
}

export function tokensShort(tokens: number): string {
  if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(1)}B`;
  if (tokens >= 1e6) return `${tokens >= 1e7 ? Math.round(tokens / 1e6) : (tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e3) return `${Math.round(tokens / 1e3)}k`;
  return `${Math.round(tokens)}`;
}

export function dollars(amount: number): string {
  if (amount >= 10) return `$${Math.round(amount).toLocaleString("en-US")}`;
  return `$${amount.toFixed(2)}`;
}

export function valueText(value: number, mode: TokenMode): string {
  return mode === "raw" ? tokensShort(value) : dollars(value);
}

export function shareText(part: number, whole: number): string {
  if (!whole || part <= 0) return "0%";
  const percent = (part / whole) * 100;
  return percent < 0.5 ? "<1%" : `${Math.round(percent)}%`;
}

export function mix(days: TokenDay[], mode: TokenMode): { kind: Kind; value: number; share: number }[] {
  const total = sum(days, mode);
  return KINDS.map((kind) => {
    const value = sum(days, mode, kind);
    return { kind, value, share: total ? value / total : 0 };
  });
}

export function dayLabel(day: TokenDay, isToday: boolean): string {
  if (isToday) return "Today";
  const [, month, date] = day.date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${date}`;
}

export function axisLabels(days: TokenDay[]): string[] {
  if (!days.length) return [];
  const last = days.length - 1;
  const picks = [...new Set(Array.from({ length: LABEL_COUNT }, (_, i) => Math.round((i * last) / (LABEL_COUNT - 1))))];
  return picks.map((i) => dayLabel(days[i], i === last));
}

export function overheadText(report: TokenReport) {
  const { assistantTokens, assistantQuestions, moveRequests, weekTokens, weekOverheadTokens } = report.overhead;
  const low = Math.min(...moveRequests);
  const high = Math.max(...moveRequests);
  const share = weekTokens ? (weekOverheadTokens / weekTokens) * 100 : 0;
  return {
    assistant: assistantTokens ? tokensShort(assistantTokens) : "",
    perQuestion: assistantTokens && assistantQuestions ? tokensShort(assistantTokens / assistantQuestions) : "",
    moves: moveRequests.length === 0 ? "" : low === high || moveRequests.length === 1 ? tokensShort(high) : `${tokensShort(low)}–${tokensShort(high)}`,
    shareLead: share > 0 && share < 0.1 ? "under " : "",
    share: share === 0 ? "0%" : share < 0.1 ? "0.1%" : `${share < 10 ? share.toFixed(2) : Math.round(share)}%`,
  };
}

export function isEmpty(report: TokenReport): boolean {
  return report.days.every((day) => dayTokens(day) === 0);
}
