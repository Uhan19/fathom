import { useEffect, useRef, useState } from "react";
import type { HerdrStatus, MemoryGroup, MemorySample, SourceKind, Worker } from "../api";
import { formatMemory } from "../memory";
import {
  causeText,
  defaultSelection,
  durationText,
  idleWorkers,
  isHeavy,
  mapItems,
  percentOf,
  sparkPath,
  splitTotals,
  stopKey,
  tokensText,
  type IdleWorker,
  type MapItem,
  type Point,
} from "../machine";
import { states } from "../parts";
import { LegendItem, MemoryMap, useWidth } from "./MemoryMap";

export type StopState = { kind: "sending" } | { kind: "asked" } | { kind: "failed"; error: string };

interface MachineProps {
  sample: MemorySample | null;
  history: Point[];
  workers: Worker[];
  source: SourceKind;
  herdr: HerdrStatus;
  thresholdMb: number;
  mac: boolean;
  stops: Record<string, StopState>;
  onStop: (group: MemoryGroup) => void;
}

const PRESSURE_NAMES = { normal: "Pressure normal", warning: "Pressure warning", critical: "Pressure critical" };
const SPARK_HEIGHT = 44;
const IDLE_SHOWN = 3;

export function Machine({ sample, history, workers, source, herdr, thresholdMb, mac, stops, onStop }: MachineProps) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!sample) {
    return (
      <section className="dash-card" data-part="dash-card" data-kind="summary">
        <p className="dash-muted" data-part="dash-muted">
          Measuring memory…
        </p>
      </section>
    );
  }
  const items = mapItems(sample);
  const selectedId = picked && items.some((i) => i.id === picked) ? picked : defaultSelection(sample);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const idle = idleWorkers(sample, workers, sample.takenAtMs);
  const anyWorker = sample.groups.some((g) => g.kind === "worker");
  const ungrouped = sample.groups.some((g) => g.kind === "orchestrator") ? "workers" : "workers and the orchestrator";
  return (
    <>
      {!sample.herdrConnected && (
        <p className="dash-notice" data-part="dash-notice" role="status">
          herdr-core is not reachable ({herdr.message || "not connected"}), so {ungrouped} show under Everything else.
        </p>
      )}
      <Summary sample={sample} history={history} mac={mac} />
      <section className="dash-card" data-part="dash-card" data-kind="map">
        <div className="card-head" data-part="card-head">
          <h3 className="dash-label" data-part="dash-label">
            Memory map
          </h3>
          <span className="dash-muted" data-part="dash-muted">
            {anyWorker ? "Area = memory. Click a block for its processes." : "No workers are running. Area = memory."}
          </span>
        </div>
        <MemoryMap
          items={items}
          total={sample.total}
          selectedId={selectedId}
          idleIds={new Set(idle.map((w) => w.group.id))}
          thresholdMb={thresholdMb}
          onSelect={setPicked}
        />
      </section>
      <div className="dash-pair" data-part="dash-pair" data-state={states({ single: idle.length === 0 })}>
        {selected && <Selected item={selected} sample={sample} thresholdMb={thresholdMb} />}
        {idle.length > 0 && <Idle idle={idle} source={source} stops={stops} onStop={onStop} />}
      </div>
    </>
  );
}

function Summary({ sample, history, mac }: { sample: MemorySample; history: Point[]; mac: boolean }) {
  const split = splitTotals(sample);
  const share = (bytes: number) => `${((bytes / sample.total) * 100).toFixed(2)}%`;
  return (
    <section className="dash-card" data-part="dash-card" data-kind="summary">
      <div className="summary-top" data-part="summary-top">
        <div className="summary-main" data-part="summary-main">
          <span className="dash-label" data-part="dash-label">
            Memory used
          </span>
          <div className="mem-figures" data-part="mem-figures">
            <span className="mem-total" data-part="mem-total">
              {formatMemory(sample.used)}
            </span>
            <span className="mem-of" data-part="mem-of">
              of {formatMemory(sample.total)}
            </span>
            {sample.pressure && (
              <span className="pressure-pill" data-part="pressure-pill" data-kind={sample.pressure}>
                <i aria-hidden="true" />
                {PRESSURE_NAMES[sample.pressure]}
              </span>
            )}
          </div>
          <span className="dash-muted" data-part="dash-muted">
            {formatMemory(sample.available)} available{mac && sample.activityMonitor ? " · same total as Activity Monitor › Memory Used" : ""}
          </span>
        </div>
        <Spark history={history} total={sample.total} />
      </div>
      <div className="split-bar" data-part="split-bar" role="img" aria-label="Memory split: agents and Fathom, Docker, everything else, available">
        <span className="split-seg" data-part="split-seg" data-kind="worker" style={{ width: share(split.agents) }} />
        <span className="split-seg" data-part="split-seg" data-kind="docker" style={{ width: share(split.docker) }} />
        <span className="split-seg" data-part="split-seg" data-kind="rest" style={{ width: share(split.rest) }} />
      </div>
      <div className="dash-legend" data-part="dash-legend">
        <LegendItem kind="worker" label="Agents and Fathom" value={formatMemory(split.agents)} />
        <LegendItem kind="docker" label="Docker" value={formatMemory(split.docker)} />
        <LegendItem kind="rest" label="Everything else" value={formatMemory(split.rest)} />
        <LegendItem kind="available" label="Available" value={formatMemory(split.available)} />
      </div>
    </section>
  );
}

function Spark({ history, total }: { history: Point[]; total: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const path = width > 0 ? sparkPath(history, width, SPARK_HEIGHT, total) : "";
  return (
    <div ref={ref} className="spark" data-part="spark">
      <span className="dash-label" data-part="dash-label">
        Last hour
      </span>
      {path ? (
        <svg width={width} height={SPARK_HEIGHT} viewBox={`0 0 ${width} ${SPARK_HEIGHT}`} role="img" aria-label="Memory used over the last hour">
          <path d={path} />
        </svg>
      ) : (
        <span className="dash-muted" data-part="dash-muted">
          Builds up while this tab is open
        </span>
      )}
    </div>
  );
}

function Selected({ item, sample, thresholdMb }: { item: MapItem; sample: MemorySample; thresholdMb: number }) {
  const heavy = item.group !== null && isHeavy(item.bytes, thresholdMb);
  const rows = item.group ? item.group.parts.map((p) => ({ label: p.label, bytes: p.bytes })) : sample.rest.apps.map((a) => ({ label: a.name, bytes: a.bytes }));
  const largest = Math.max(1, ...rows.map((r) => r.bytes));
  const session = item.group?.session;
  return (
    <section className="dash-card" data-part="dash-card" data-kind="selected" aria-live="polite">
      <div className="selected-head" data-part="selected-head">
        <span className="dash-label" data-part="dash-label">
          Selected
        </span>
        <b className="selected-name" data-part="selected-name">
          {item.name}
        </b>
        <span className="selected-size" data-part="selected-size" data-state={states({ heavy })}>
          {formatMemory(item.bytes)}
        </span>
        <span className="selected-meta" data-part="selected-meta">
          {percentOf(item.bytes, sample.total)}
          {session && ` · ${tokensText(session.contextTokens)}`}
        </span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="proc-row" data-part="proc-row">
          <span className="proc-name" data-part="proc-name">
            {row.label}
          </span>
          <span className="proc-bar" data-part="proc-bar" aria-hidden="true">
            <span className="proc-fill" data-part="proc-fill" style={{ width: `${(row.bytes / largest) * 100}%` }} />
          </span>
          <span className="proc-size" data-part="proc-size">
            {formatMemory(row.bytes)}
          </span>
        </div>
      ))}
      {item.group === null && (
        <p className="dash-muted" data-part="dash-muted">
          The largest apps outside the agents, Fathom and Docker. macOS is the memory the system itself keeps (wired and compressed).
        </p>
      )}
      {heavy && item.group && (
        <p className="heavy-note" data-part="heavy-note">
          {causeText(item.group, thresholdMb)}
        </p>
      )}
    </section>
  );
}

function Idle({ idle, source, stops, onStop }: { idle: IdleWorker[]; source: SourceKind; stops: Record<string, StopState>; onStop: (group: MemoryGroup) => void }) {
  const [confirming, setConfirming] = useState<MemoryGroup | null>(null);
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded ? 0 : Math.max(0, idle.length - IDLE_SHOWN);
  return (
    <section className="dash-card" data-part="dash-card" data-kind="idle">
      {idle.slice(0, idle.length - hidden).map(({ group, idleForMs }) => {
        const stop = stops[stopKey(group)];
        return (
          <div key={group.id} className="idle-item" data-part="idle-item" data-id={group.taskId ?? group.id}>
            <span className="idle-tag" data-part="idle-tag">
              Idle · holding memory
            </span>
            <b className="idle-name" data-part="idle-name">
              {group.name}
            </b>
            <div className="idle-meta" data-part="idle-meta">
              {formatMemory(group.bytes)}
              {group.session && ` · ${tokensText(group.session.contextTokens)}`} · idle {durationText(idleForMs)} · cache expired
            </div>
            <p className="dash-muted" data-part="dash-muted">
              Stopping frees the memory. The task stays on the board and can start again.
            </p>
            {stop?.kind === "asked" && (
              <p className="dash-muted" data-part="dash-muted" role="status">
                Asked Firstmate to stop it.
              </p>
            )}
            <button
              type="button"
              className="btn btn-stop"
              data-part="button"
              data-kind="stop"
              data-control="stop-worker"
              disabled={stop?.kind === "sending"}
              onClick={() => setConfirming(group)}
            >
              {stop?.kind === "sending" ? "Stopping…" : "Stop worker"}
            </button>
            {stop?.kind === "failed" && (
              <p className="error-text" data-part="error-text" role="alert">
                Could not stop it: {stop.error}
              </p>
            )}
          </div>
        );
      })}
      {idle.length > IDLE_SHOWN && (
        <button type="button" className="mini idle-more" data-part="mini-button" data-control="idle-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show ${hidden} more idle ${hidden === 1 ? "worker" : "workers"}`}
        </button>
      )}
      {confirming && (
        <StopConfirm
          group={confirming}
          source={source}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            onStop(confirming);
            setConfirming(null);
          }}
        />
      )}
    </section>
  );
}

function StopConfirm({ group, source, onClose, onConfirm }: { group: MemoryGroup; source: SourceKind; onClose: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return (
    <dialog ref={dialogRef} className="confirm" data-part="confirm" onCancel={onClose} aria-label={`Stop the worker on ${group.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm();
        }}
      >
        <h2>Stop the worker on {group.name}?</h2>
        <p>
          {source === "firstmate"
            ? "Fathom asks Firstmate to stop this worker's agent and everything it started, which frees its memory."
            : "This ends the worker's herdr-core terminal: its agent and everything it started stop, which frees the memory."}{" "}
          The task stays where it is on the board and can start again.
        </p>
        <div className="confirm-foot" data-part="confirm-foot">
          <button type="button" className="btn" data-part="button" data-control="stop-worker-cancel" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" data-part="button" data-kind="danger" data-control="stop-worker-confirm">
            Stop worker
          </button>
        </div>
      </form>
    </dialog>
  );
}
