import type { ReactNode } from "react";
import type { Person, PrStatus, Wait, WaitKind } from "../api";
import { exactTime, relativeTime } from "../activity";
import { describeUrl } from "../links";
import { needChip, personRows, sinceMs, waitHeading, waitWhat } from "../waits";
import type { PrStatuses } from "./DetailLinks";
import { ChatIcon, CheckIcon, HandoffIcon, MailIcon, PullRequestIcon } from "./Icons";
import { WebAnchor } from "./RichText";

const KIND_GLYPHS: Record<WaitKind, (props: { size?: number }) => ReactNode> = {
  "pr-review": PullRequestIcon,
  "slack-reply": ChatIcon,
  "email-reply": MailIcon,
  other: HandoffIcon,
};

interface WaitingSectionProps {
  waits: Wait[];
  people: Record<string, Person>;
  statuses: PrStatuses;
}

export function WaitingSection({ waits, people, statuses }: WaitingSectionProps) {
  const now = Date.now();
  return (
    <div className="sec wait-box" data-part="wait-box">
      <span className="sech" data-part="sech">{waitHeading(waits)}</span>
      {waits.map((wait, i) => (
        <WaitGroup key={i} wait={wait} people={people} status={wait.link ? statuses.get(wait.link) : undefined} now={now} />
      ))}
    </div>
  );
}

function WaitGroup({ wait, people, status, now }: { wait: Wait; people: Record<string, Person>; status: PrStatus | null | undefined; now: number }) {
  const Glyph = KIND_GLYPHS[wait.kind];
  const chip = needChip(wait, status);
  const link = wait.link ? describeUrl(wait.link) : null;
  const since = sinceMs(wait);
  const rows = personRows(wait, people, status);
  return (
    <div className="wait-group" data-part="wait-group" data-kind={wait.kind} data-key={wait.link ?? wait.what}>
      <div className="wait-group-head" data-part="wait-group-head">
        <span className="wait-kind" data-part="wait-kind">
          <Glyph />
        </span>
        <span className="wait-what" data-part="wait-what">
          {waitWhat(wait)}
        </span>
        {chip && (
          <span className={`wait-need need-${chip.tone}`} data-part="wait-need" data-kind={chip.tone}>
            {chip.text}
          </span>
        )}
      </div>
      {(link || since !== null) && (
        <div className="wait-meta" data-part="wait-meta">
          {link && (
            <WebAnchor url={link.url} control="wait-link">
              {link.label}
            </WebAnchor>
          )}
          {link && since !== null && <span aria-hidden="true">·</span>}
          {since !== null && (
            <time dateTime={new Date(since).toISOString()} title={exactTime(since)}>
              asked {relativeTime(since, now)}
            </time>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <ul className="wait-people" data-part="wait-people">
          {rows.map((row) => (
            <li key={row.name}>
              <span className="wait-avatar" data-part="wait-avatar" aria-hidden="true">
                {row.initial}
              </span>
              <span className="wait-who" data-part="wait-who">
                {row.name}
              </span>
              {row.said && (
                <span className={`wait-said said-${row.tone}`} data-part="wait-said" data-kind={row.tone}>
                  {row.tone === "ok" && <CheckIcon size={11} />}
                  {row.said}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
