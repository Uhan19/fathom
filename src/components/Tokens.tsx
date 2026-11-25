import type { ReactNode } from "react";
import type { TokenMode, TokenReport, TokenShare } from "../api";
import { states } from "../parts";
import {
  axisLabels,
  consumerName,
  dayLabel,
  dayValue,
  isEmpty,
  KIND_NAMES,
  KINDS,
  mix,
  modelName,
  overheadText,
  periods,
  shareText,
  shareValue,
  sum,
  valueText,
} from "../tokens";
import { SectionHead } from "./Dashboard";
import { Segment } from "./ShotViewer";

const MODE_NAMES: Record<TokenMode, string> = { raw: "Raw tokens", cost: "Cost-weighted" };
const MODES: TokenMode[] = ["raw", "cost"];
const CHART_HEIGHT = 150;

interface TokensProps {
  report: TokenReport | null;
  mode: TokenMode;
  onMode: (mode: TokenMode) => void;
  quota?: ReactNode;
}

export function Tokens({ report, mode, onMode, quota }: TokensProps) {
  return (
    <>
      <SectionHead title="Tokens and quota">
        <span className="dash-head-end" data-part="dash-head-end">
          <Segment control="token-mode" label="Count tokens as" values={MODES} current={mode} name={(m) => MODE_NAMES[m]} onPick={onMode} />
        </span>
      </SectionHead>
      {!report ? (
        <section className="dash-card" data-part="dash-card" data-kind="tiles">
          <p className="dash-muted" data-part="dash-muted">
            Reading Claude Code transcripts…
          </p>
        </section>
      ) : isEmpty(report) ? (
        <section className="dash-card" data-part="dash-card" data-kind="tiles">
          <p className="dash-muted" data-part="dash-muted">
            No Claude Code usage in the last 30 days.
          </p>
        </section>
      ) : (
        <>
          <Tiles report={report} mode={mode} />
          {quota}
          <Chart report={report} mode={mode} />
          <Breakdown report={report} mode={mode} />
          <Overhead report={report} />
        </>
      )}
    </>
  );
}

function Tiles({ report, mode }: { report: TokenReport; mode: TokenMode }) {
  const p = periods(report);
  const cost = mode === "cost";
  const tiles = [
    { label: "Today", value: sum(p.today, mode), note: cost ? "API-equivalent" : "so far, since midnight" },
    { label: "Last 7 days", value: sum(p.week, mode), note: cost ? "API-equivalent" : p.lastWeek.length ? `${valueText(sum(p.lastWeek, mode), mode)} the week before` : "" },
    { label: "Last 30 days", value: sum(p.month, mode), note: cost ? "API-equivalent" : "" },
  ];
  return (
    <div className="token-tiles" data-part="token-tiles">
      {tiles.map((tile) => (
        <div key={tile.label} className="token-tile" data-part="token-tile">
          <span className="dash-label" data-part="dash-label">
            {tile.label}
          </span>
          <span className="tile-value" data-part="tile-value">
            {valueText(tile.value, mode)}
          </span>
          <span className="tile-note" data-part="tile-note">
            {tile.note}
          </span>
        </div>
      ))}
    </div>
  );
}

function Chart({ report, mode }: { report: TokenReport; mode: TokenMode }) {
  const days = report.days;
  const highest = Math.max(1, ...days.map((d) => dayValue(d, mode)));
  const shares = mix(days, mode);
  const total = sum(days, mode);
  const last = days.length - 1;
  return (
    <section className="dash-card" data-part="dash-card" data-kind="chart">
      <div className="card-head" data-part="card-head">
        <h3 className="dash-label" data-part="dash-label">
          Daily, last 30 days
        </h3>
        <span className="dash-muted" data-part="dash-muted">
          {mode === "raw" ? "Million tokens per day" : "Relative cost per day"}
        </span>
      </div>
      <div className="chart-frame" data-part="chart-frame">
        {mode === "raw" && (
          <span className="chart-scale" data-part="chart-scale">
            {valueText(highest, mode)}
          </span>
        )}
        <div className="chart-bars" data-part="chart-bars" role="img" aria-label={`Stacked daily ${mode === "raw" ? "token" : "cost"} bars for the last 30 days`} style={{ height: CHART_HEIGHT }}>
          {days.map((day, i) => (
            <div
              key={day.date}
              className="chart-bar"
              data-part="chart-bar"
              data-state={states({ today: i === last })}
              title={`${dayLabel(day, i === last)}: ${valueText(dayValue(day, mode), mode)}${mode === "cost" ? " API-equivalent" : ""}`}
            >
              {KINDS.map((kind) => (
                <span key={kind} className="bar-seg" data-part="bar-seg" data-kind={kind} style={{ height: `${(dayValue(day, mode, kind) / highest) * 100}%` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="chart-axis" data-part="chart-axis">
        {axisLabels(days).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="mix-bar" data-part="mix-bar" role="img" aria-label="Mix of the last 30 days">
        {shares.map((s) => (
          <span key={s.kind} className="mix-seg" data-part="mix-seg" data-kind={s.kind} style={{ width: `${s.share * 100}%` }} />
        ))}
      </div>
      <div className="dash-legend" data-part="dash-legend">
        {shares.map((s) => (
          <span key={s.kind} className="legend-item" data-part="legend-item">
            <i className="legend-swatch" data-part="legend-swatch" data-kind={s.kind} aria-hidden="true" />
            {KIND_NAMES[s.kind]}
            <b className="legend-value" data-part="legend-value">
              {shareText(s.value, total)}
            </b>
          </span>
        ))}
      </div>
      {mode === "cost" && <PricesNote report={report} />}
    </section>
  );
}

function PricesNote({ report }: { report: TokenReport }) {
  if (!report.pricesError && report.unpriced.length === 0) return null;
  return (
    <p className="dash-muted prices-note" data-part="prices-note">
      {report.pricesError ? `prices.json could not be read (${report.pricesError}), so the built-in list prices are used. ` : ""}
      {report.unpriced.length > 0 ? `No price for ${report.unpriced.map(modelName).join(", ")}, so it counts as $0. ` : ""}
      Prices live in prices.json beside Fathom's database.
    </p>
  );
}

function Breakdown({ report, mode }: { report: TokenReport; mode: TokenMode }) {
  const week = sum(periods(report).week, mode);
  return (
    <section className="dash-card breakdown" data-part="dash-card" data-kind="breakdown">
      <div className="breakdown-col" data-part="breakdown-col" data-kind="models">
        <h3 className="dash-label" data-part="dash-label">
          By model, this week
        </h3>
        <Bars shares={report.models} mode={mode} kind="models" name={(s) => modelName(s.name)} />
      </div>
      <div className="breakdown-col" data-part="breakdown-col" data-kind="consumers">
        <h3 className="dash-label" data-part="dash-label">
          Top consumers, this week
        </h3>
        <div className="consumer-list" data-part="consumer-list">
          {report.consumers.map((c) => (
            <div key={`${c.role}:${c.name}`} className="consumer-row" data-part="consumer-row" data-kind={c.role}>
              <span className="consumer-name" data-part="consumer-name" title={consumerName(c)}>
                {consumerName(c)}
              </span>
              <span className="consumer-value" data-part="consumer-value">
                {valueText(shareValue(c, mode), mode)}
              </span>
              <span className="consumer-share" data-part="consumer-share">
                {shareText(shareValue(c, mode), week)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="breakdown-col" data-part="breakdown-col" data-kind="projects">
        <h3 className="dash-label" data-part="dash-label">
          By project, this week
        </h3>
        <Bars shares={report.projects} mode={mode} kind="projects" name={(s) => s.name} />
      </div>
    </section>
  );
}

function Bars({ shares, mode, kind, name }: { shares: TokenShare[]; mode: TokenMode; kind: string; name: (share: TokenShare) => string }) {
  const largest = Math.max(1e-9, ...shares.map((s) => shareValue(s, mode)));
  return (
    <div className="share-list" data-part="share-list">
      {shares.map((share) => (
        <div key={share.name} className="share-row" data-part="share-row" data-kind={kind}>
          <span className="share-name" data-part="share-name" title={name(share)}>
            {name(share)}
          </span>
          <span className="share-value" data-part="share-value">
            {valueText(shareValue(share, mode), mode)}
          </span>
          <span className="share-bar" data-part="share-bar" aria-hidden="true">
            <span className="share-fill" data-part="share-fill" style={{ width: `${(shareValue(share, mode) / largest) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Overhead({ report }: { report: TokenReport }) {
  const text = overheadText(report);
  return (
    <div className="overhead-line" data-part="overhead-line">
      <span className="dash-label" data-part="dash-label">
        Fathom’s own overhead
      </span>
      <span className="overhead-item" data-part="overhead-item">
        Board assistant <b>{text.assistant}</b> total{text.perQuestion && <>, about {text.perQuestion} per question</>}
      </span>
      <span className="overhead-item" data-part="overhead-item">
        {text.moves ? (
          <>
            Board move requests <b>{text.moves}</b> each
          </>
        ) : (
          "No board move requests this month"
        )}
      </span>
      <span className="overhead-item" data-part="overhead-item" data-kind="share">
        Together <b>{text.share}</b> of this week
      </span>
    </div>
  );
}
