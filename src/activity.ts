export type Tone = "active" | "attention" | "trouble" | "quiet" | "good";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const JUST_NOW = 45_000;

const TONES: Record<string, Tone> = {
  working: "active",
  "needs-decision": "attention",
  blocked: "trouble",
  failed: "trouble",
  paused: "quiet",
  done: "good",
  resolved: "good",
};

export function stateWord(state: string): string {
  const words = state.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Note";
}

export function stateTone(state: string): Tone {
  return TONES[state] ?? "quiet";
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

export function relativeTime(ms: number, now: number): string {
  const ago = now - ms;
  if (ago < JUST_NOW) return "just now";
  if (ago < HOUR) return plural(Math.max(1, Math.round(ago / MINUTE)), "minute");
  if (ago < DAY) return plural(Math.round(ago / HOUR), "hour");
  if (ago < 2 * DAY) return "yesterday";
  if (ago < WEEK) return plural(Math.floor(ago / DAY), "day");
  if (ago < MONTH) return plural(Math.floor(ago / WEEK), "week");
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `on ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" })}`;
}

export function exactTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
