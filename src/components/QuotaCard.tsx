import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Fragment, useEffect, useState } from "react";
import type { QuotaReport, QuotaWindow } from "../api";
import { states } from "../parts";
import { hasPace, lastSeenText, quotaState, runsShort, usedText, windowLine } from "../quota";

const COPIED_MS = 1600;

export function QuotaCard({ report }: { report: QuotaReport | null }) {
  if (!report) return null;
  const state = quotaState(report);
  const available = state === "available";
  return (
    <section className="dash-card" data-part="dash-card" data-kind="quota">
      <div className="card-head" data-part="card-head">
        <h3 className="dash-label" data-part="dash-label">
          Plan limits
        </h3>
        {available && hasPace(report) && (
          <span className="dash-muted" data-part="dash-muted">
            At the pace of the last 30 minutes
          </span>
        )}
      </div>
      {!available && <Notice report={report} state={state} />}
      <div className="quota-windows" data-part="quota-windows" data-state={states({ unavailable: !available })}>
        <Window name="5-hour window" window={report.fiveHour} available={available} now={report.takenAtMs} />
        <Window name="Weekly" window={report.sevenDay} available={available} now={report.takenAtMs} />
      </div>
    </section>
  );
}

function Window({ name, window, available, now }: { name: string; window: QuotaWindow | null; available: boolean; now: number }) {
  const shown = available ? window : null;
  return (
    <div className="quota-window" data-part="quota-window" data-state={states({ short: shown !== null && runsShort(shown), empty: shown === null })}>
      <div className="quota-head" data-part="quota-head">
        <span className="quota-name" data-part="quota-name">
          {name}
        </span>
        <span className="quota-used" data-part="quota-used">
          {shown ? usedText(shown) : "-"}
        </span>
      </div>
      <span className="quota-bar" data-part="quota-bar" aria-hidden="true">
        {shown && <span className="quota-fill" data-part="quota-fill" style={{ width: `${shown.usedPercent}%` }} />}
      </span>
      {available && (
        <span className="quota-note" data-part="quota-note">
          {shown ? windowLine(shown, now) : "Claude Code is not reporting this window right now"}
        </span>
      )}
    </div>
  );
}

function Notice({ report, state }: { report: QuotaReport; state: "never" | "stale" | "quiet" }) {
  return (
    <div className="quota-notice" data-part="quota-notice">
      <svg className="quota-notice-icon" data-part="quota-notice-icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 5.5v5.5M10 13.6v.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <div className="quota-notice-body" data-part="quota-notice-body">
        <b className="quota-notice-title" data-part="quota-notice-title">
          Quota data unavailable
        </b>
        {state === "never" ? <Setup line={report.recordLine} /> : <Absent state={state} />}
        <span className="quota-seen" data-part="quota-seen">
          {lastSeenText(report)}
        </span>
      </div>
    </div>
  );
}

function Absent({ state }: { state: "stale" | "quiet" }) {
  return (
    <p className="dash-muted" data-part="dash-muted">
      {state === "stale"
        ? "Fathom hasn’t seen your plan’s limits from Claude Code in the last hour, so it can’t show the 5-hour and weekly windows."
        : "Claude Code’s latest report has no current 5-hour or weekly window, so Fathom can’t show them."}{" "}
      Token totals above still come from your local session logs.
    </p>
  );
}

function Setup({ line }: { line: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => void writeText(line).then(() => setCopied(true), () => undefined);

  return (
    <>
      <p className="dash-muted" data-part="dash-muted">
        Claude Code shares your plan’s limits only with its status line, so Fathom has none recorded yet. To record them, add this line to your status line script, after the line that reads Claude Code’s input into <code>$input</code>.
        Token totals above still come from your local session logs.
      </p>
      <div className="quota-command" data-part="quota-command">
        <code>
          {line.split(" ").map((word, i) => (
            <Fragment key={i}>
              {i > 0 && " "}
              <BreakAfterSlashes word={word} />
            </Fragment>
          ))}
        </code>
        <button type="button" className="mini" data-part="mini-button" data-control="quota-copy-line" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </>
  );
}

function BreakAfterSlashes({ word }: { word: string }) {
  if (!word.includes("/")) return <span style={{ whiteSpace: "nowrap" }}>{word}</span>;
  return word.split("/").map((piece, i) => (
    <Fragment key={i}>
      {i > 0 && "/"}
      {i > 0 && <wbr />}
      {piece}
    </Fragment>
  ));
}
