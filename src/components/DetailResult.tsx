import { useEffect, useState } from "react";
import { relativeTime, exactTime } from "../activity";
import { describeUrl, type Linking } from "../links";
import { callAnswer, pickShot, stateLabel, stripStates, type Call, type CallQuestion, type ResultModel, type Shot, type ShotSet, type Tone } from "../result";
import { LinkRow, type PrStatuses } from "./DetailLinks";
import { ExpandIcon } from "./Icons";
import { Markdown, type PathAction } from "./Markdown";
import { AxisSwitches, PHASE_NAMES, scaleText, ShotImage, ShotThumb, ShotViewer } from "./ShotViewer";

export const STRIP_STATES = 4;

interface ResultSectionProps {
  model: ResultModel;
  cardId: string;
  holdUntil: string;
  statuses: PrStatuses;
  linking: Linking;
  onPath: PathAction;
  onOpenReport: (path: string) => void;
  onAnswer: (text: string) => void;
}

export function ResultSection({ model, cardId, holdUntil, statuses, linking, onPath, onOpenReport, onAnswer }: ResultSectionProps) {
  const { body } = model;
  return (
    <div className={`sec result ${body.kind === "call" ? "result-call" : ""}`}>
      <span className="sech">{model.label}</span>
      {model.headline && <Markdown className="result-headline" text={model.headline} linking={linking} onPath={onPath} />}
      {body.kind === "shots" && <ShotsBody set={body.set} cardId={cardId} />}
      {(body.kind === "shots" || body.kind === "prs") && body.prs.length > 0 && <PrList urls={body.prs} statuses={statuses} boxed={body.kind === "prs"} />}
      {body.kind === "watch" && <WatchBody text={body.entry.text} state={body.entry.state} atMs={body.entry.atMs} tone={body.tone} linking={linking} onPath={onPath} />}
      {body.kind === "call" && <CallBody call={body.call} holdUntil={holdUntil} linking={linking} onPath={onPath} onAnswer={onAnswer} />}
      {model.points.length > 0 && (
        <ul className="result-points">
          {model.points.map((point, i) => (
            <li key={i}>
              <Markdown text={point} linking={linking} onPath={onPath} />
            </li>
          ))}
        </ul>
      )}
      {model.report && (
        <div className="result-foot">
          <button type="button" className="link more-link" onClick={() => onOpenReport(model.report!.path)}>
            Read the full report →
          </button>
          <span className="muted-small">
            {model.report.sections > 0 && `${model.report.sections} sections · `}
            {model.report.lines} lines
          </span>
        </div>
      )}
    </div>
  );
}

function ShotsBody({ set, cardId }: { set: ShotSet; cardId: string }) {
  const [current, setCurrent] = useState(set.lead);
  const [viewing, setViewing] = useState<Shot | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => setCurrent(set.lead), [set]);
  const states = stripStates(set, STRIP_STATES);
  const strip = states.map((state) => ({ state, shot: pickShot(set.shots, current, { state }) }));
  const more = set.shots.length > strip.length;
  const single = set.shots.length === 1;
  return (
    <>
      <div className="shot-lead">
        <button type="button" className="shot-lead-frame" onClick={() => setViewing(current)} title="Open in the full-window viewer">
          <ShotImage shot={current} className="shot-lead-img" onScale={setScale} />
        </button>
        <span className="shot-badges" aria-hidden="true">
          {current.phase && <span className={`shot-badge phase-${current.phase}`}>{PHASE_NAMES[current.phase]}</span>}
          {current.width && <span className="shot-badge">{current.width}</span>}
          {current.theme && <span className="shot-badge">{current.theme}</span>}
        </span>
        <button type="button" className="shot-expand" onClick={() => setViewing(current)} aria-label="Open screenshots in full window">
          <ExpandIcon />
          <span>Full window</span>
        </button>
        {scale && <span className="shot-scale">whole frame · {scaleText(scale)}</span>}
      </div>
      {!single && (set.axes.phase.length > 0 || set.axes.width.length > 0 || set.axes.theme.length > 0) && (
        <div className="shot-axes">
          <AxisSwitches axes={set.axes} shots={set.shots} current={current} onPick={setCurrent} />
        </div>
      )}
      {!single && (strip.length > 1 || more) && (
        <div className="shot-strip">
          {strip.length > 1 &&
            strip.map(({ state, shot }) => (
              <button
                key={state}
                type="button"
                className={`shot-cell ${state === current.state ? "on" : ""}`}
                onClick={() => shot && setCurrent(shot)}
                aria-pressed={state === current.state}
                title={stateLabel(state)}
              >
                <ShotThumb shot={shot} />
                <span className="shot-cell-label">{stateLabel(state)}</span>
              </button>
            ))}
          {more && (
            <button type="button" className="shot-cell shot-all" onClick={() => setViewing(current)}>
              <span className="shot-thumb-img">All {set.shots.length}</span>
              <span className="shot-cell-label">Full window</span>
            </button>
          )}
        </div>
      )}
      {viewing && <ShotViewer set={set} start={viewing} title={cardId} onClose={() => setViewing(null)} />}
    </>
  );
}

function PrList({ urls, statuses, boxed }: { urls: string[]; statuses: PrStatuses; boxed: boolean }) {
  const links = urls.flatMap((url) => {
    const link = describeUrl(url);
    return link ? [{ ...link, sources: [] }] : [];
  });
  if (links.length === 0) return null;
  return (
    <ul className={`link-list result-prs ${boxed ? "boxed" : ""}`}>
      {links.map((link) => (
        <LinkRow key={link.url} link={link} status={statuses.get(link.url)} showSources={false} />
      ))}
    </ul>
  );
}

const STATE_WORDS: Record<string, string> = { "needs-decision": "Needs a decision" };

interface WatchBodyProps {
  text: string;
  state: string;
  atMs: number | null;
  tone: Tone;
  linking: Linking;
  onPath: PathAction;
}

function WatchBody({ text, state, atMs, tone, linking, onPath }: WatchBodyProps) {
  const word = STATE_WORDS[state] ?? (state ? state.charAt(0).toUpperCase() + state.slice(1) : "Update");
  return (
    <div className={`result-watch tone-${tone}`}>
      <span className="beacon" aria-hidden="true" />
      <div className="result-watch-text">
        <span className="result-watch-head">
          <b>{word}</b>
          {atMs !== null && (
            <span className="muted-small" title={exactTime(atMs)}>
              last update {relativeTime(atMs, Date.now())}
            </span>
          )}
        </span>
        <Markdown className="clamp" text={text} linking={linking} onPath={onPath} />
      </div>
    </div>
  );
}

interface CallBodyProps {
  call: Call;
  holdUntil: string;
  linking: Linking;
  onPath: PathAction;
  onAnswer: (text: string) => void;
}

function CallBody({ call, holdUntil, linking, onPath, onAnswer }: CallBodyProps) {
  const [picks, setPicks] = useState<Map<string, string>>(new Map());
  const choosable = call.questions.filter((q) => q.options.length > 0);
  const [open, setOpen] = useState<string | null>(choosable[0]?.key ?? null);
  const multi = call.questions.length > 1;

  const pick = (question: CallQuestion, key: string) => {
    const next = new Map(picks).set(question.key, key);
    setPicks(next);
    onAnswer(callAnswer(call.questions, next));
    const waiting = choosable.find((q) => !next.has(q.key));
    if (multi && waiting) setOpen(waiting.key);
  };

  return (
    <>
      {call.intro && <Markdown className="result-headline" text={call.intro} linking={linking} onPath={onPath} />}
      {holdUntil && <p className="muted-small">Waiting until {holdUntil}</p>}
      {multi && (
        <div className="call-progress">
          <span className="muted-small">
            {picks.size} of {choosable.length} picked
          </span>
          <span className="call-bar">
            <i style={{ width: `${(picks.size / Math.max(choosable.length, 1)) * 100}%` }} />
          </span>
        </div>
      )}
      {call.questions.map((question) =>
        !multi || question.key === open ? (
          <Question key={question.key} question={question} multi={multi} picked={picks.get(question.key) ?? null} onPick={(key) => pick(question, key)} />
        ) : (
          <QuestionRow key={question.key} question={question} picked={picks.get(question.key) ?? null} onOpen={() => question.options.length > 0 && setOpen(question.key)} />
        ),
      )}
      {call.outro && <Markdown className="call-outro" text={call.outro} linking={linking} onPath={onPath} />}
    </>
  );
}

function Question({ question, multi, picked, onPick }: { question: CallQuestion; multi: boolean; picked: string | null; onPick: (key: string) => void }) {
  return (
    <div className="call-box" role="radiogroup" aria-label={question.text || "Options"}>
      {multi && (
        <span className="call-q">
          <span className="call-key">{question.key}</span> {question.text}
        </span>
      )}
      {question.options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={picked === option.key}
          className={`call-opt ${option.recommended ? "rec" : ""} ${picked === option.key ? "on" : ""}`}
          onClick={() => onPick(option.key)}
        >
          <span className="call-radio" aria-hidden="true" />
          <span>
            <span className="call-letter">{option.key})</span> {option.text}
            {option.recommended && <span className="rec-tag">Recommended</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function QuestionRow({ question, picked, onOpen }: { question: CallQuestion; picked: string | null; onOpen: () => void }) {
  const recommended = question.options.find((o) => o.recommended)?.key;
  return (
    <button type="button" className="call-row" onClick={onOpen} disabled={question.options.length === 0} title={question.text}>
      <span className="call-key">{question.key}</span>
      <span className="call-row-text">{question.text}</span>
      {picked ? <span className="call-pick">{picked}</span> : recommended && <span className="call-rec">rec {recommended}</span>}
    </button>
  );
}
