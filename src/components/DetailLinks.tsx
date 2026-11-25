import { useEffect, useState, type ReactNode } from "react";
import { api, errorText, unknownPrStatus, type PrStatus } from "../api";
import { groupLinks, type FoundLink, type LinkKind } from "../links";
import { ChatIcon, CommitIcon, GlobeIcon, IssueIcon, PullRequestIcon, RepoIcon, TicketIcon } from "./Icons";
import { WebAnchor } from "./RichText";

export type PrStatuses = Map<string, PrStatus | null>;

const STATE_WORDS: Record<PrStatus["state"], string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
  unknown: "Status unknown",
};

const CHECK_WORDS: Record<PrStatus["checks"], string | null> = {
  passing: "Checks pass",
  failing: "Checks failing",
  running: "Checks running",
  none: null,
  unknown: null,
};

const GLYPHS: Record<LinkKind, () => ReactNode> = {
  pr: PullRequestIcon,
  issue: IssueIcon,
  commit: CommitIcon,
  repo: RepoIcon,
  github: RepoIcon,
  ticket: TicketIcon,
  slack: ChatIcon,
  web: GlobeIcon,
};

export function usePrStatuses(urls: string[]): PrStatuses {
  const key = urls.join(" ");
  const [statuses, setStatuses] = useState<PrStatuses>(new Map());
  useEffect(() => {
    let alive = true;
    const wanted = key ? key.split(" ") : [];
    setStatuses((known) => new Map(wanted.map((url) => [url, known.get(url) ?? null])));
    const settle = (url: string, status: PrStatus) => alive && setStatuses((prev) => new Map(prev).set(url, status));
    for (const url of wanted) {
      api
        .prStatus(url)
        .then((status) => settle(url, status))
        .catch((e) => settle(url, unknownPrStatus(url, errorText(e))));
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return statuses;
}

export function PrBadge({ status }: { status: PrStatus | null | undefined }) {
  if (status === undefined) return null;
  if (status === null)
    return (
      <span className="pr-line muted-small" data-part="pr-line" data-state="checking">
        Checking status…
      </span>
    );
  if (status.state === "unknown")
    return (
      <span className="pr-line muted-small" data-part="pr-line" data-state="unknown" title={status.note ?? undefined}>
        Status unknown
      </span>
    );
  const checks = status.state === "open" || status.state === "draft" ? CHECK_WORDS[status.checks] : null;
  return (
    <span className="pr-line" data-part="pr-line">
      <span className={`pr-state pr-${status.state}`} data-part="pr-state" data-kind={status.state}>
        {STATE_WORDS[status.state]}
      </span>
      {checks && (
        <span className={`pr-checks checks-${status.checks}`} data-part="pr-checks" data-kind={status.checks}>
          {checks}
        </span>
      )}
    </span>
  );
}

export function LinkRow({ link, status, showSources }: { link: FoundLink; status?: PrStatus | null; showSources: boolean }) {
  const Glyph = GLYPHS[link.kind];
  return (
    <li className="link-row" data-part="link-row" data-key={link.url}>
      <span className={`link-glyph glyph-${link.group}`} data-part="link-glyph" data-kind={link.group}>
        <Glyph />
      </span>
      <div className="link-body" data-part="link-body">
        <WebAnchor url={link.url} className="link-label" part="link-label" control="link-open">
          {link.label}
        </WebAnchor>
        {link.kind === "pr" && <PrBadge status={status} />}
        <span className="link-detail" data-part="link-detail" title={link.url}>
          {link.detail}
        </span>
        {showSources && (
          <span className="link-sources" data-part="link-sources">
            Found in {link.sources.map((s) => s.toLowerCase()).join(", ")}
          </span>
        )}
      </div>
    </li>
  );
}

export function unknownNotes(links: FoundLink[], statuses: PrStatuses): string[] {
  const notes = links.map((l) => statuses.get(l.url)).flatMap((s) => (s?.state === "unknown" && s.note ? [s.note] : []));
  return [...new Set(notes)];
}

export function LinksTab({ links, statuses }: { links: FoundLink[]; statuses: PrStatuses }) {
  if (links.length === 0)
    return (
      <p className="tab-empty" data-part="tab-empty">
        No links yet. Links in the title, note, hold reason, card links and activity show up here.
      </p>
    );
  const notes = unknownNotes(links, statuses);
  return (
    <>
      {groupLinks(links).map((group) => (
        <section key={group.group} className="sec" data-part="link-group" data-key={group.group}>
          <h3 className="sech" data-part="sech">
            {group.title}
          </h3>
          <ul className="link-list" data-part="link-list">
            {group.links.map((link) => (
              <LinkRow key={link.url} link={link} status={statuses.get(link.url)} showSources />
            ))}
          </ul>
        </section>
      ))}
      {notes.length > 0 && <p className="quiet-note" data-part="quiet-note">Live pull request status is unavailable: {notes.join("; ")}.</p>}
    </>
  );
}
