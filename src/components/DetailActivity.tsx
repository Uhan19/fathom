import { exactTime, relativeTime, stateTone, stateWord } from "../activity";
import type { StatusEntry } from "../api";
import type { Linking } from "../links";
import { NeedsHome } from "./DetailFiles";
import type { PathAction } from "./Markdown";
import { RichText } from "./RichText";

interface ActivityTabProps {
  hasHome: boolean;
  entries: StatusEntry[] | null;
  linking: Linking;
  onPath: PathAction;
}

export function ActivityTab({ hasHome, entries, linking, onPath }: ActivityTabProps) {
  if (!hasHome) return <NeedsHome what="Progress updates" />;
  if (!entries) return <p className="tab-empty">Loading progress updates…</p>;
  if (entries.length === 0) return <p className="tab-empty">No progress updates yet. The worker's status lines show up here as it reports them.</p>;
  const now = Date.now();
  return (
    <ol className="timeline">
      {entries.map((entry, i) => (
        <li key={i} className={`moment tone-${stateTone(entry.state)}`}>
          <span className="moment-dot" aria-hidden="true" />
          <div className="moment-head">
            <span className="moment-state">{stateWord(entry.state)}</span>
            {entry.atMs !== null && (
              <time className="moment-time" dateTime={new Date(entry.atMs).toISOString()} title={exactTime(entry.atMs)}>
                {relativeTime(entry.atMs, now)}
              </time>
            )}
          </div>
          <p className="moment-text">
            <RichText text={entry.text} linking={linking} onPath={onPath} />
          </p>
        </li>
      ))}
    </ol>
  );
}
