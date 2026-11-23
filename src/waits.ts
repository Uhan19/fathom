import type { Person, PrStatus, ReviewState, Wait, WaitKind } from "./api";
import { describeUrl } from "./links";

export type PersonTone = "ok" | "warn" | "quiet";
export type ChipTone = "need" | "ok" | "warn";

export interface WaitTagText {
  names: string;
  more: number;
}

export interface PersonRow {
  name: string;
  initial: string;
  said: string | null;
  tone: PersonTone;
}

export interface Chip {
  text: string;
  tone: ChipTone;
}

const TAG_ENTRIES = 2;
const NO_ONE: Wait[] = [];

const KINDS: Record<WaitKind, { label: string; one: string; many: string }> = {
  "pr-review": { label: "PR review", one: "a PR review", many: "PR reviews" },
  "slack-reply": { label: "Slack reply", one: "a Slack reply", many: "Slack replies" },
  "email-reply": { label: "Email reply", one: "an email reply", many: "email replies" },
  other: { label: "Reply", one: "a reply", many: "replies" },
};

const REVIEW_WORDS: Record<ReviewState, [string, PersonTone]> = {
  approved: ["approved", "ok"],
  changesRequested: ["changes requested", "warn"],
  commented: ["commented", "quiet"],
  dismissed: ["review dismissed", "quiet"],
};

const DONE_WORDS = new Set(["approved", "replied", "answered", "confirmed", "done"]);

const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

export function waitsOf(tasks: Record<string, Wait[]>, id: string): Wait[] {
  return own(tasks, id) ?? NO_ONE;
}

export function joinNames(names: string[], conjunction: "and" | "or"): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

const eitherOf = (wait: Wait) => wait.who.length > 1 && (wait.need === "any" || wait.need === 1);

export function whoPhrase(wait: Wait): string {
  const count = wait.who.length;
  if (count === 0) return "";
  if (eitherOf(wait)) return joinNames(wait.who, "or");
  if (typeof wait.need === "number" && wait.need < count) return `${wait.need} of ${joinNames(wait.who, "and")}`;
  return joinNames(wait.who, "and");
}

export function everyone(waits: Wait[]): string[] {
  return [...new Set(waits.flatMap((w) => w.who))];
}

export function tagText(waits: Wait[]): WaitTagText {
  const entries: string[][] = [];
  const covered = new Set<string>();
  for (const wait of waits) {
    const fresh = wait.who.filter((name) => !covered.has(name));
    if (eitherOf(wait) && fresh.length === wait.who.length) entries.push(wait.who);
    else entries.push(...fresh.map((name) => [name]));
    wait.who.forEach((name) => covered.add(name));
  }
  const shown = entries.slice(0, TAG_ENTRIES);
  const named = new Set(shown.flat());
  return {
    names: shown.map((names) => joinNames(names, "or")).join(", "),
    more: everyone(waits).filter((name) => !named.has(name)).length,
  };
}

export function waitTitle(waits: Wait[]): string {
  return waits
    .map((wait) => {
      const who = whoPhrase(wait);
      if (wait.what) return `Waiting on ${who || KINDS[wait.kind].one}: ${wait.what}`;
      return who ? `Waiting on ${who} for ${KINDS[wait.kind].one}` : `Waiting on ${KINDS[wait.kind].one}`;
    })
    .join("\n");
}

export function waitHeading(waits: Wait[]): string {
  const names = everyone(waits);
  const named = waits.filter((w) => w.who.length > 0);
  const parts: string[] = [];
  if (named.length === 1 && names.length <= TAG_ENTRIES) parts.push(whoPhrase(named[0]));
  else if (names.length === 1) parts.push(names[0]);
  else if (names.length > 1) parts.push(`${names.length} people`);
  const unnamed = new Map<WaitKind, number>();
  for (const wait of waits) if (wait.who.length === 0) unnamed.set(wait.kind, (unnamed.get(wait.kind) ?? 0) + 1);
  for (const [kind, count] of unnamed) parts.push(count === 1 ? KINDS[kind].one : `${count} ${KINDS[kind].many}`);
  return `Waiting on ${joinNames(parts, "and")}`;
}

export function waitWhat(wait: Wait): string {
  return wait.what || KINDS[wait.kind].label;
}

export function needChip(wait: Wait, status: PrStatus | null | undefined): Chip | null {
  if (wait.kind === "pr-review" && status?.reviewDecision === "approved") return { text: "approved", tone: "ok" };
  if (wait.kind === "pr-review" && status?.reviewDecision === "changesRequested") return { text: "changes requested", tone: "warn" };
  const count = wait.who.length;
  if (count < 2) return null;
  if (eitherOf(wait)) return { text: `needs 1 of ${count}`, tone: "need" };
  if (typeof wait.need === "number" && wait.need < count) return { text: `needs ${wait.need} of ${count}`, tone: "need" };
  return { text: `needs all ${count}`, tone: "need" };
}

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

function loginOf(name: string, people: Record<string, Person>): string | null {
  const recorded = own(people, name)?.github;
  if (recorded) return recorded;
  return LOGIN.test(name) ? name : null;
}

function liveSaid(login: string, status: PrStatus): [string, PersonTone] | null {
  const review = status.reviews.find((r) => sameLogin(r.login, login));
  if (status.requested.some((r) => sameLogin(r, login))) return [review ? "re-review requested" : "review requested", "quiet"];
  return review ? REVIEW_WORDS[review.state] : null;
}

function declaredSaid(said: string | undefined): [string, PersonTone] | null {
  const words = said?.replace(/[-_]+/g, " ").trim().toLowerCase();
  if (!words) return null;
  return [words, DONE_WORDS.has(words) ? "ok" : "quiet"];
}

export function personRows(wait: Wait, people: Record<string, Person>, status: PrStatus | null | undefined): PersonRow[] {
  const live = wait.kind === "pr-review" && status && status.state !== "unknown" ? status : null;
  return wait.who.map((name) => {
    const login = live ? loginOf(name, people) : null;
    const [said, tone] = (live && login && liveSaid(login, live)) || declaredSaid(own(wait.state, name)) || [null, "quiet"];
    return { name, initial: Array.from(name)[0].toUpperCase(), said, tone };
  });
}

export function sinceMs(wait: Wait): number | null {
  if (!wait.since) return null;
  const ms = Date.parse(wait.since);
  return Number.isNaN(ms) ? null : ms;
}

export function prLinks(waits: Wait[]): string[] {
  return waits.flatMap((w) => (w.kind === "pr-review" && w.link && describeUrl(w.link)?.kind === "pr" ? [w.link] : []));
}
