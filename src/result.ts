import type { Card, FileEntry, PrStatus, StatusEntry } from "./api";
import type { Theme } from "./theme";

export type ResultLabel = "Result" | "Answer" | "Verdict" | "Recommendation" | "Your call" | "Watch";
export type Phase = "before" | "after";
export type Tone = "ok" | "warn" | "bad" | "quiet";

export interface Shot {
  path: string;
  name: string;
  folder: string;
  size: number | null;
  phase: Phase | null;
  theme: Theme | null;
  width: number | null;
  state: string;
}

export interface Axes {
  phase: Phase[];
  width: number[];
  theme: Theme[];
}

export interface ShotSet {
  shots: Shot[];
  states: string[];
  axes: Axes;
  lead: Shot;
}

export interface CallOption {
  key: string;
  text: string;
  recommended: boolean;
}

export interface CallQuestion {
  key: string;
  text: string;
  options: CallOption[];
}

export interface Call {
  intro: string;
  questions: CallQuestion[];
  outro: string;
}

export interface ReportLead {
  heading: string | null;
  items: string[];
}

export interface ReportFile {
  path: string;
  sections: number;
  lines: number;
}

export type ResultBody =
  | { kind: "call"; call: Call }
  | { kind: "watch"; entry: StatusEntry; tone: Tone }
  | { kind: "shots"; set: ShotSet; prs: string[] }
  | { kind: "prs"; prs: string[] }
  | { kind: "none" };

export interface ResultModel {
  label: ResultLabel;
  headline: string | null;
  points: string[];
  body: ResultBody;
  report: ReportFile | null;
}

export interface ResultInput {
  card: Pick<Card, "id" | "kind" | "state" | "holdKind" | "holdReason">;
  activity: StatusEntry[];
  report: (ReportFile & { text: string }) | null;
  prBody: string | null;
  prs: string[];
  prStatuses: Map<string, PrStatus | null>;
  images: FileEntry[];
  theme: Theme;
}

export const MAX_POINTS = 3;
const MIN_HEADLINE_WORDS = 4;
const SUBHEAD_MAX_WORDS = 6;
const LABEL_MAX_WORDS = 3;
const MIN_SCREEN_WIDTH = 240;
const MAX_SCREEN_WIDTH = 3840;

const LEAD_HEADING =
  /\b(short answers?|direct answer|answers?|tl;?dr|bottom line|in short|at a glance|verdicts?|headline findings|result|outcome|summary|conclusion|recommendation)\b/i;
const LABEL_BY_HEADING: [RegExp, ResultLabel][] = [
  [/\b(answers?|tl;?dr|bottom line|in short)\b/i, "Answer"],
  [/\b(verdicts?|findings)\b/i, "Verdict"],
  [/\brecommendation\b/i, "Recommendation"],
];
const PROSE_WORD = /^[("“]?[A-Za-z][a-z'’-]*[,.;:!?)"”]*$/;
const PR_BEFORE_LINK = /\bPR:?\s+(?=https:\/\/\S+\/pull\/\d+)/g;
const LIST_MARKER = /^([-*+]|\d+[.)])\s+/;
const META_LINE = /^(?:[A-Z][\w ]{0,20}:\s*)?(?:\[[^\]]+\]\([^)\s]+\)|https?:\/\/\S+|[A-Z][A-Z0-9]*-\d+)\.?$/;
const SENTENCE_END = /(?<=[.!?]["”')*_`]*)\s+(?=[A-Z0-9"“(`*])/;
const STATE_TONES: Record<string, Tone> = {
  working: "ok",
  done: "ok",
  resolved: "ok",
  paused: "quiet",
  "needs-decision": "warn",
  blocked: "warn",
  failed: "bad",
};

export function buildResult(input: ResultInput): ResultModel | null {
  const lead = input.report ? leadSection(input.report.text) : null;
  const prLead = input.prBody ? leadSection(input.prBody) ?? openingItems(input.prBody) : null;
  const done = doneLine(input.activity);
  const report = input.report ? { path: input.report.path, sections: input.report.sections, lines: input.report.lines } : null;
  const waiting = input.card.holdKind === "captain" && input.card.state !== "done";
  const call = waiting ? parseCall(input.card.holdReason) : null;

  if (call) return { label: "Your call", headline: null, points: [], body: { kind: "call", call }, report };

  const told = tellStory(lead, done, prLead, prTitle(input.prs, input.prStatuses));
  const watched = input.card.kind === "watch" ? input.activity[0] : undefined;
  const body: ResultBody = watched
    ? { kind: "watch", entry: watched, tone: STATE_TONES[watched.state] ?? "quiet" }
    : bodyFor(input);
  if (!told.headline && body.kind !== "watch" && body.kind !== "shots") return null;
  const label = watched ? "Watch" : labelFor(lead?.heading ?? null);
  return { label, headline: told.headline, points: told.points, body, report };
}

function bodyFor(input: ResultInput): ResultBody {
  const shots = shotSet(toShots(input.images, input.card.id), input.theme);
  if (shots) return { kind: "shots", set: shots, prs: input.prs };
  if (input.prs.length > 0) return { kind: "prs", prs: input.prs };
  return { kind: "none" };
}

function tellStory(lead: ReportLead | null, done: string | null, prLead: ReportLead | null, title: string | null) {
  if (lead && lead.items.length > 0) return split(lead.items);
  if (done) return { headline: done, points: (prLead?.items ?? []).slice(0, MAX_POINTS) };
  if (prLead && prLead.items.length > 0) return split(prLead.items);
  return { headline: title, points: [] };
}

function split(items: string[]) {
  const [first, ...rest] = items;
  const [sentence, remainder] = firstSentence(first);
  return { headline: sentence, points: [...(remainder ? [remainder] : []), ...rest].slice(0, MAX_POINTS) };
}

function firstSentence(text: string): [string, string] {
  const parts = text.split(SENTENCE_END);
  let head = parts[0];
  let next = 1;
  while (next < parts.length && !balanced(head)) head = `${head} ${parts[next++]}`;
  return [head, parts.slice(next).join(" ").trim()];
}

const balanced = (text: string) => [/\*\*/g, /`/g].every((mark) => (text.match(mark)?.length ?? 0) % 2 === 0);

function prTitle(prs: string[], statuses: Map<string, PrStatus | null>): string | null {
  for (const url of prs) {
    const title = statuses.get(url)?.title;
    if (title) return title;
  }
  return null;
}

export function labelFor(heading: string | null): ResultLabel {
  if (!heading) return "Result";
  return LABEL_BY_HEADING.find(([pattern]) => pattern.test(heading))?.[1] ?? "Result";
}

export function doneLine(activity: StatusEntry[]): string | null {
  const done = activity.find((entry) => entry.state === "done");
  if (!done) return null;
  const prose = done.text.split(/\s+/).filter((word) => PROSE_WORD.test(word));
  return prose.length >= MIN_HEADLINE_WORDS ? done.text.replace(PR_BEFORE_LINK, "").trim() : null;
}

export function reportFile(path: string, text: string): ReportFile & { text: string } {
  const lines = text.replace(/\n+$/, "").split("\n");
  return { path, text, lines: lines.length, sections: lines.filter((line) => /^##\s/.test(line)).length };
}

export function leadSection(markdown: string): ReportLead | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const firstHeading = lines.findIndex((line) => /^#{1,6}\s/.test(line));
  const opening = firstHeading > 0 ? leadItems(lines.slice(0, firstHeading)) : [];
  if (opening.length > 0) return { heading: null, items: opening };
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^##\s+(.*)$/)?.[1];
    if (!heading || !LEAD_HEADING.test(heading)) continue;
    const end = lines.findIndex((line, j) => j > i && /^#{1,2}\s/.test(line));
    const items = leadItems(lines.slice(i + 1, end < 0 ? undefined : end));
    if (items.length > 0) return { heading: heading.replace(/^[\d.]+\s*/, "").trim(), items };
  }
  return null;
}

function openingItems(markdown: string): ReportLead | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s/.test(line));
  if (start < 0) {
    const items = leadItems(lines);
    return items.length > 0 ? { heading: null, items } : null;
  }
  const end = lines.findIndex((line, j) => j > start && /^#{1,2}\s/.test(line));
  const items = leadItems(lines.slice(start + 1, end < 0 ? undefined : end));
  return items.length > 0 ? { heading: lines[start].replace(/^##\s+/, ""), items } : null;
}

function leadItems(lines: string[]): string[] {
  const items: string[] = [];
  let fenced = false;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s{2,}\S/.test(raw) && items.length > 0 && /^\s/.test(raw)) continue;
    const line = raw.trim();
    if (!line || /^(#|\||<!--|!\[|---|>)/.test(line)) continue;
    const text = line.replace(LIST_MARKER, "").trim();
    if (!text || META_LINE.test(text) || (text === line && isSubhead(text))) continue;
    if (items.length > 0 && text.endsWith(":")) break;
    items.push(text);
  }
  return items;
}

function isSubhead(text: string): boolean {
  const bold = text.match(/^\*\*([^*]+)\*\*:?$/);
  if (bold) return words(bold[1]) <= SUBHEAD_MAX_WORDS;
  return text.endsWith(":") && words(text) <= LABEL_MAX_WORDS;
}

const words = (text: string) => text.trim().split(/\s+/).length;

type MarkerStyle = { pattern: RegExp; lower: boolean };

const QUESTION_MARKER = /\((\d{1,2})\)\s/g;
const OPTION_STYLES: MarkerStyle[] = [
  { pattern: /\(([a-h])\)\s/gi, lower: true },
  { pattern: /(?<![\w(])([a-h])\)\s/gi, lower: true },
  { pattern: /(?:^|[:;,]\s)([A-H])\s(?=\S)/g, lower: false },
];
const RECOMMENDED = /\s*(?:\[recommended\]|\((?:recommended|rec)\)|^recommended\s*[-:–]\s*)\s*/i;
const FRAGMENT_WORDS = 4;

export function parseCall(reason: string): Call | null {
  const text = reason.trim();
  if (!text) return null;
  const numbered = sequence(text, QUESTION_MARKER, (n) => String(n + 1));
  if (numbered.length >= 2) {
    const questions = numbered.map((marker, i) => {
      const end = numbered[i + 1]?.at ?? text.length;
      const part = trimJoin(text.slice(marker.end, end), KEEP_STOP);
      const options = parseOptions(part);
      return options
        ? { key: marker.key, text: options.intro, options: options.options }
        : { key: marker.key, text: part, options: [] };
    });
    if (!questions.some((q) => q.options.length >= 2)) return null;
    const outros = questions.map(cutQuestion);
    const outro = outros[outros.length - 1];
    return { intro: trimJoin(text.slice(0, numbered[0].at)), questions, outro };
  }
  const options = parseOptions(text);
  if (!options) return null;
  const lastOption = options.options[options.options.length - 1];
  const [tail, outro] = cutTrailing(lastOption.text);
  lastOption.text = tail;
  return { intro: options.intro, questions: [{ key: "", text: "", options: options.options }], outro };
}

function parseOptions(text: string): { intro: string; options: CallOption[] } | null {
  for (const style of OPTION_STYLES) {
    const markers = sequence(text, style.pattern, (n) => String.fromCharCode((style.lower ? 97 : 65) + n), style.lower);
    if (markers.length < 2) continue;
    const options = markers.map((marker, i) => {
      const last = i === markers.length - 1;
      const raw = trimJoin(text.slice(marker.end, markers[i + 1]?.at ?? text.length), last);
      const recommended = RECOMMENDED.test(raw);
      return { key: marker.key.toUpperCase(), text: trimJoin(raw.replace(RECOMMENDED, " "), last), recommended };
    });
    return { intro: trimJoin(text.slice(0, markers[0].at)).replace(/(^|[.?!]\s+)options:?$/i, "$1").replace(/[:\s]+$/, ""), options };
  }
  return null;
}

type Marker = { key: string; at: number; end: number };

function sequence(text: string, pattern: RegExp, expected: (n: number) => string, caseless = false): Marker[] {
  const markers: Marker[] = [];
  for (const match of text.matchAll(pattern)) {
    const key = match[1];
    const want = expected(markers.length);
    if ((caseless ? key.toLowerCase() : key) !== want) continue;
    const at = match.index + (match[0].startsWith("(") ? 0 : match[0].indexOf(key));
    markers.push({ key, at, end: match.index + match[0].length });
  }
  return markers;
}

function cutQuestion(question: CallQuestion, index: number, all: CallQuestion[]): string {
  const last = question.options[question.options.length - 1];
  const [kept, rest] = cutTrailing(last ? last.text : question.text);
  const final = index === all.length - 1;
  if (!final && rest.split(/\s+/).length >= FRAGMENT_WORDS) return "";
  if (last) last.text = kept;
  else question.text = kept;
  return final ? rest : "";
}

function cutTrailing(text: string): [string, string] {
  const [first, ...rest] = text.split(SENTENCE_END);
  return [trimJoin(first), rest.join(" ").trim()];
}

const KEEP_STOP = true;

function trimJoin(text: string, keepStop = false): string {
  const joined = text
    .trim()
    .replace(/^[;,]\s*/, "")
    .replace(/[;,]?\s+(?:or|and)$/i, "")
    .trim();
  return joined.replace(keepStop ? /[;,]$/ : /[;,.]$/, "").trim();
}

export function shotTags(name: string, id: string): Omit<Shot, "path" | "name" | "folder" | "size"> {
  let base = name.replace(/\.[^.]+$/, "");
  if (base.toLowerCase().startsWith(id.toLowerCase())) base = base.slice(id.length);
  const tags: Omit<Shot, "path" | "name" | "folder" | "size"> = { phase: null, theme: null, width: null, state: "" };
  const rest: string[] = [];
  for (const token of base.split(/[-_\s.]+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    const frame = lower.match(/^(\d{3,4})x\d{3,4}$/);
    const plain = lower.match(/^(\d{3,4})(?:px|w)?$/);
    if (lower === "before" || lower === "after") tags.phase ??= lower;
    else if (lower === "light" || lower === "dark") tags.theme ??= lower;
    else if (frame && tags.width === null) tags.width = Number(frame[1]);
    else if (plain && tags.width === null && isScreenWidth(Number(plain[1]))) tags.width = Number(plain[1]);
    else if (!(rest.length === 0 && /^\d{1,2}$/.test(token))) rest.push(token);
  }
  tags.state = rest.join(" ");
  return tags;
}

const isScreenWidth = (n: number) => n >= MIN_SCREEN_WIDTH && n <= MAX_SCREEN_WIDTH;

export function stateLabel(state: string): string {
  if (!state) return "Main";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function toShots(images: FileEntry[], id: string): Shot[] {
  return images
    .map((image) => ({ path: image.path, name: image.name, folder: image.folder, size: image.size, ...shotTags(image.name, id) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function shotSet(shots: Shot[], theme: Theme): ShotSet | null {
  if (shots.length === 0) return null;
  const states = unique(shots.map((s) => s.state));
  const axes: Axes = {
    phase: present(shots.map((s) => s.phase), ["before", "after"]),
    width: unique(shots.map((s) => s.width).filter((w): w is number => w !== null)).sort((a, b) => b - a),
    theme: present(shots.map((s) => s.theme), ["light", "dark"]),
  };
  return { shots, states, axes: { ...axes, width: axes.width.length > 1 ? axes.width : [] }, lead: leadShot(shots, states, theme) };
}

function present<T>(values: (T | null)[], order: T[]): T[] {
  const found = order.filter((v) => values.includes(v));
  return found.length > 1 ? found : [];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function leadShot(shots: Shot[], states: string[], theme: Theme): Shot {
  const after = shots.filter((s) => s.phase !== "before");
  const pool = after.length > 0 ? after : shots;
  const themed = pool.filter((s) => s.theme === theme);
  const inTheme = themed.length > 0 ? themed : pool;
  const width = mostCommon(inTheme.map((s) => s.width));
  const sized = inTheme.filter((s) => s.width === width);
  const ranked = (sized.length > 0 ? sized : inTheme).slice().sort((a, b) => states.indexOf(a.state) - states.indexOf(b.state));
  return ranked[0];
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let most = 0;
  for (const [v, n] of counts) if (n > most) [best, most] = [v, n];
  return best;
}

export type Axis = keyof Axes;

export function pickShot(shots: Shot[], current: Shot, change: Partial<Pick<Shot, Axis | "state">>): Shot | null {
  const want = { ...current, ...change };
  const fixed = Object.keys(change) as (Axis | "state")[];
  const loose: (Axis | "state")[] = ["state", "phase", "width", "theme"].filter((k) => !fixed.includes(k as Axis)) as (Axis | "state")[];
  const matching = shots.filter((s) => fixed.every((k) => s[k] === want[k]));
  if (matching.length === 0) return null;
  const score = (s: Shot) => loose.reduce((n, k, i) => n + (s[k] === want[k] ? 1 << (loose.length - i) : 0), 0);
  return matching.reduce((best, s) => (score(s) > score(best) ? s : best));
}

export function counterpart(shots: Shot[], shot: Shot): Shot | null {
  if (!shot.phase) return null;
  const other: Phase = shot.phase === "after" ? "before" : "after";
  return shots.find((s) => s.phase === other && s.state === shot.state && s.width === shot.width && s.theme === shot.theme) ?? null;
}

export function stripStates(set: ShotSet, limit: number): string[] {
  const at = set.states.indexOf(set.lead.state);
  const rest = set.states.filter((_, i) => i !== at);
  return [set.lead.state, ...rest].slice(0, limit).sort((a, b) => set.states.indexOf(a) - set.states.indexOf(b));
}

export function stepShot(shots: Shot[], current: Shot, by: number): Shot {
  const at = Math.max(0, shots.findIndex((s) => s.path === current.path));
  return shots[(at + by + shots.length) % shots.length];
}

export function callAnswer(questions: CallQuestion[], picks: Map<string, string>): string {
  if (questions.length === 1) return picks.get(questions[0].key) ?? "";
  return questions
    .filter((q) => picks.has(q.key))
    .map((q) => `${q.key}: ${picks.get(q.key)}`)
    .join("; ");
}

export const REPORT_FILE = "report.md";
export const PR_BODY_FILE = "pr-body.md";

export function reportEntry(links: Card["links"], files: FileEntry[], taskFolder: string | null): FileEntry | null {
  const linked = links.filter((l) => l.kind === "report").map((l) => l.target);
  const isFile = (f: FileEntry) => f.kind === "file" && f.preview === "markdown";
  return files.find((f) => isFile(f) && f.mentions.some((m) => linked.includes(m))) ?? taskFile(files, taskFolder, REPORT_FILE);
}

export function taskFile(files: FileEntry[], taskFolder: string | null, name: string): FileEntry | null {
  return files.find((f) => f.kind === "file" && f.inTaskFolder && f.folder === taskFolder && f.name === name) ?? null;
}

export function shownPrs(model: ResultModel | null): string[] {
  const body = model?.body;
  return body && (body.kind === "shots" || body.kind === "prs") ? body.prs : [];
}
