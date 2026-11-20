import type { Link } from "./api";

export interface Linking {
  linearWorkspace: string;
  ticketPrefixes: string[];
}

export type LinkKind = "pr" | "issue" | "commit" | "repo" | "github" | "ticket" | "slack" | "web";
export type LinkGroup = "code" | "tickets" | "conversations" | "other";

export interface WebLink {
  kind: LinkKind;
  group: LinkGroup;
  url: string;
  label: string;
  detail: string;
}

export interface FoundLink extends WebLink {
  sources: string[];
}

export interface Source {
  name: string;
  text: string;
}

export type Piece =
  | { type: "text"; text: string }
  | { type: "link"; link: WebLink; text: string; label: string | null }
  | { type: "path"; path: string; text: string; label: string | null };

export const GROUPS: { group: LinkGroup; title: string }[] = [
  { group: "code", title: "Pull requests and issues" },
  { group: "tickets", title: "Tickets" },
  { group: "conversations", title: "Conversations" },
  { group: "other", title: "Other links" },
];

export const NO_LINKING: Linking = { linearWorkspace: "", ticketPrefixes: [] };
export const RECORDED_PR = "Recorded pull request";
export const CARD_LINKS = "Card links";

const KIND_ORDER: LinkKind[] = ["pr", "issue", "commit", "repo", "github", "ticket", "slack", "web"];
const TOP_ORDER: LinkKind[] = ["pr", "ticket", "slack", "issue"];
const TOP_LINKS = 3;
const HOME_FOLDERS = ["data", "state", "docs", "projects", "bin", "config", "assets", "skills"];
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];
const TRAILING = ".,;:!?'\"*_";
const FILE_NAME = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const ID_LIKE = /^(?:[0-9a-f]{12,}|\d+)$/i;

const MARKDOWN_LINK = /\[([^\]\n]+)\]\(\s*<?([^()\s<>]+)>?\s*\)/g;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
const ABSOLUTE_PATH = /(?<![\w@%+./~:-])~?\/[^\s<>"'`|(){}[\],;:*]+/g;
const RELATIVE_PATH = /(?<![\w@%+./~:-])(?:\.\.?\/)?[\w@][\w.@+-]*(?:\/[\w.@+%-]+)+\/?/g;
const TICKET = /(?<![\w-])([A-Z][A-Z0-9]{1,9})-(\d{1,7})(?![\w-])/g;

type Match = { at: number; end: number; piece: Piece | null };

export function splitText(text: string, linking: Linking = NO_LINKING): Piece[] {
  const pieces: Piece[] = [];
  let plain = "";
  let pos = 0;
  while (pos < text.length) {
    const match = nextMatch(text, pos, linking);
    if (!match) break;
    plain += text.slice(pos, match.at);
    if (match.piece) {
      if (plain) pieces.push({ type: "text", text: plain });
      plain = "";
      pieces.push(match.piece);
    } else {
      plain += text.slice(match.at, match.end);
    }
    pos = match.end;
  }
  plain += text.slice(pos);
  if (plain) pieces.push({ type: "text", text: plain });
  return pieces;
}

function nextMatch(text: string, pos: number, linking: Linking): Match | null {
  const found = [
    find(MARKDOWN_LINK, text, pos, (m) => markdownPiece(m[1], m[2], linking)),
    find(URL_PATTERN, text, pos, (m) => urlPiece(m[0])),
    find(ABSOLUTE_PATH, text, pos, (m) => pathPiece(m[0], false)),
    find(RELATIVE_PATH, text, pos, (m) => pathPiece(m[0], true)),
    find(TICKET, text, pos, (m) => ticketPiece(m[0], m[1], linking)),
  ].filter((m): m is Match => m !== null);
  if (found.length === 0) return null;
  return found.reduce((best, m) => (m.at < best.at ? m : best));
}

function find(pattern: RegExp, text: string, pos: number, build: (m: RegExpExecArray) => Piece | null | [Piece, number]): Match | null {
  pattern.lastIndex = pos;
  const m = pattern.exec(text);
  if (!m) return null;
  const built = build(m);
  if (Array.isArray(built)) return { at: m.index, end: m.index + built[1], piece: built[0] };
  return { at: m.index, end: m.index + m[0].length, piece: built };
}

function markdownPiece(label: string, target: string, linking: Linking): Piece | null {
  const inner = splitText(target, linking);
  if (inner.length !== 1) return null;
  const only = inner[0];
  if (only.type === "link") return { ...only, label };
  if (only.type === "path") return { ...only, label };
  return null;
}

function urlPiece(raw: string): Piece | [Piece, number] | null {
  const url = trimTrailing(raw);
  const link = describeUrl(url);
  if (!link) return null;
  return [{ type: "link", link, text: url, label: null }, url.length];
}

function pathPiece(raw: string, relative: boolean): Piece | [Piece, number] | null {
  const path = trimTrailing(raw);
  if (path.length < 2 || (relative && !plausibleRelative(path))) return null;
  return [{ type: "path", path, text: path, label: null }, path.length];
}

function plausibleRelative(path: string): boolean {
  const parts = path.replace(/^\.\.?\//, "").split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return HOME_FOLDERS.includes(parts[0]) || FILE_NAME.test(last);
}

function ticketPiece(text: string, prefix: string, linking: Linking): Piece | null {
  const workspace = linking.linearWorkspace.trim();
  if (!workspace || !linking.ticketPrefixes.includes(prefix)) return null;
  const link = describeUrl(`https://linear.app/${workspace}/issue/${text}`);
  return link && { type: "link", link, text, label: null };
}

export function trimTrailing(raw: string): string {
  let out = raw;
  for (;;) {
    const last = out[out.length - 1];
    if (last !== undefined && TRAILING.includes(last)) out = out.slice(0, -1);
    else if (last === ")" && count(out, "(") < count(out, ")")) out = out.slice(0, -1);
    else if (last === "]" && count(out, "[") < count(out, "]")) out = out.slice(0, -1);
    else return out;
  }
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

export function describeUrl(raw: string): WebLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map(decode);
  if (host === "github.com") return github(url, parts);
  if (host === "linear.app") return linear(url, parts);
  if (host.endsWith(".slack.com")) return slack(url, host, parts);
  return web(url, host, parts);
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function detailOf(host: string, parts: string[]): string {
  return [host, ...parts].join("/");
}

function github(url: URL, parts: string[]): WebLink {
  const [owner, rawRepo, section, id] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  const base = { detail: detailOf("github.com", parts), url: url.href };
  if (!owner) return { ...base, kind: "github", group: "other", label: "GitHub" };
  if (!repo) return { ...base, kind: "github", group: "other", label: `${owner} · GitHub` };
  const slug = `${owner}/${repo}`;
  const home = `https://github.com/${slug}`;
  if (section === "pull" && /^\d+$/.test(id ?? ""))
    return { kind: "pr", group: "code", url: `${home}/pull/${id}`, label: `PR #${id} · ${slug}`, detail: `github.com/${slug}/pull/${id}` };
  if (section === "issues" && /^\d+$/.test(id ?? ""))
    return { kind: "issue", group: "code", url: `${home}/issues/${id}${url.hash}`, label: `Issue #${id} · ${slug}`, detail: `github.com/${slug}/issues/${id}` };
  if (section === "commit" && /^[0-9a-f]{7,40}$/i.test(id ?? ""))
    return { kind: "commit", group: "code", url: `${home}/commit/${id}`, label: `Commit ${id.slice(0, 7)} · ${slug}`, detail: `github.com/${slug}/commit/${id.slice(0, 12)}` };
  if (!section) return { kind: "repo", group: "code", url: home, label: `${slug} · GitHub`, detail: `github.com/${slug}` };
  return { ...base, kind: "github", group: "other", label: `${tailName(parts.slice(2))} · ${slug}` };
}

function linear(url: URL, parts: string[]): WebLink {
  const [workspace, section, id, slug] = parts;
  const detail = detailOf("linear.app", parts);
  if (section === "issue" && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(id ?? "")) {
    const ticket = id.toUpperCase();
    return { kind: "ticket", group: "tickets", url: `https://linear.app/${workspace}/issue/${ticket}`, label: `${ticket} · Linear`, detail: `linear.app/${workspace}/issue/${ticket}` };
  }
  if (section === "project" && id) {
    const name = humanize((slug ?? id).replace(/-[0-9a-f]{8,}$/i, ""));
    return { kind: "ticket", group: "tickets", url: url.href, label: `${name} · Linear project`, detail };
  }
  return { kind: "web", group: "other", url: url.href, label: workspace ? `${workspace} · Linear` : "Linear", detail };
}

function slack(url: URL, host: string, parts: string[]): WebLink {
  const workspace = host.replace(/\.slack\.com$/, "");
  const [section, channel, message] = parts;
  const detail = detailOf(host, parts);
  if (section === "archives" && channel) {
    const thread = url.searchParams.get("thread_ts");
    const path = `https://${host}/archives/${channel}${message ? `/${message}` : ""}`;
    const canonical = thread ? `${path}?thread_ts=${thread}` : path;
    const what = !message ? "Slack channel" : thread ? "Slack thread" : "Slack message";
    return { kind: "slack", group: "conversations", url: canonical, label: `${what} · ${workspace}`, detail };
  }
  return { kind: "slack", group: "conversations", url: url.href, label: workspace === "app" ? "Slack" : `Slack · ${workspace}`, detail };
}

function web(url: URL, host: string, parts: string[]): WebLink {
  const shown = url.port ? `${host}:${url.port}` : host;
  const detail = detailOf(shown, parts);
  if (LOCAL_HOSTS.includes(host)) return { kind: "web", group: "other", url: url.href, label: `Local page · ${shown}`, detail };
  const tail = tailName(parts);
  return { kind: "web", group: "other", url: url.href, label: tail ? `${tail} · ${shown}` : shown, detail };
}

function tailName(parts: string[]): string {
  const meaningful = parts.filter((p) => !ID_LIKE.test(p));
  const last = meaningful[meaningful.length - 1];
  return last ? humanize(last.replace(/\.(html?|php|aspx?)$/i, "")) : "";
}

function humanize(segment: string): string {
  if (FILE_NAME.test(segment)) return segment;
  const words = segment.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : segment;
}

export function linkKey(link: WebLink): string {
  return link.url.replace(/\/+$/, "").toLowerCase();
}

export function findLinks(sources: Source[], linking: Linking = NO_LINKING): FoundLink[] {
  const found = new Map<string, FoundLink>();
  for (const source of sources) {
    for (const piece of splitText(source.text, linking)) {
      if (piece.type !== "link") continue;
      const key = linkKey(piece.link);
      const known = found.get(key);
      if (!known) found.set(key, { ...piece.link, sources: [source.name] });
      else if (!known.sources.includes(source.name)) known.sources.push(source.name);
    }
  }
  return [...found.values()]
    .map((link, index) => ({ link, index }))
    .sort((a, b) => KIND_ORDER.indexOf(a.link.kind) - KIND_ORDER.indexOf(b.link.kind) || a.index - b.index)
    .map((entry) => entry.link);
}

export function findPaths(sources: Source[]): string[] {
  const paths: string[] = [];
  for (const source of sources) {
    for (const piece of splitText(source.text)) {
      if (piece.type === "path" && !paths.includes(piece.path)) paths.push(piece.path);
    }
  }
  return paths;
}

export function cardLinkSources(links: Link[]): Source[] {
  return links.map((link) => ({ name: CARD_LINKS, text: link.target }));
}

export function groupLinks(links: FoundLink[]): { group: LinkGroup; title: string; links: FoundLink[] }[] {
  return GROUPS.map((g) => ({ ...g, links: links.filter((l) => l.group === g.group) })).filter((g) => g.links.length > 0);
}

export function topLinks(links: FoundLink[]): FoundLink[] {
  const rank = (link: FoundLink) => {
    if (link.kind === "pr" && link.sources.includes(RECORDED_PR)) return -1;
    const at = TOP_ORDER.indexOf(link.kind);
    return at === -1 ? TOP_ORDER.length : at;
  };
  return links
    .map((link, index) => ({ link, index }))
    .sort((a, b) => rank(a.link) - rank(b.link) || a.index - b.index)
    .slice(0, TOP_LINKS)
    .map((entry) => entry.link);
}

export function fileName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}
