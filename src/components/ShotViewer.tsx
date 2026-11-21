import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, errorText } from "../api";
import { counterpart, pickShot, stateLabel, stepShot, type Axes, type Axis, type Phase, type Shot, type ShotSet } from "../result";
import { Close, ImageIcon, OpenIcon, RevealIcon } from "./Icons";

const THUMB_MAX_BYTES = 4 * 1024 * 1024;
const CACHED_IMAGES = 48;
const SIDE_BY_SIDE_MIN_WIDTH = 1100;
const HALF = 50;

type Loaded = { src: string } | { error: string } | null;
type CompareMode = "flip" | "slider" | "side";

const cache = new Map<string, Promise<string>>();

function loadImage(path: string): Promise<string> {
  const known = cache.get(path);
  if (known) {
    cache.delete(path);
    cache.set(path, known);
    return known;
  }
  const loading = api.filePreview(path).then((p) => {
    if (!p.dataUrl) throw new Error("this file has no image preview");
    return p.dataUrl;
  });
  loading.catch(() => cache.delete(path));
  cache.set(path, loading);
  while (cache.size > CACHED_IMAGES) cache.delete(cache.keys().next().value!);
  return loading;
}

function useImage(path: string | null, lazy: boolean): [Loaded, (node: Element | null) => void] {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [node, setNode] = useState<Element | null>(null);
  useEffect(() => {
    setLoaded(null);
    if (!path || (lazy && !node)) return;
    let alive = true;
    const start = () =>
      loadImage(path)
        .then((src) => alive && setLoaded({ src }))
        .catch((e) => alive && setLoaded({ error: errorText(e) }));
    if (!lazy || !node) {
      void start();
      return () => {
        alive = false;
      };
    }
    const observer = new IntersectionObserver((seen) => {
      if (!seen.some((s) => s.isIntersecting)) return;
      observer.disconnect();
      void start();
    });
    observer.observe(node);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [path, lazy, node]);
  return [loaded, setNode];
}

export function ShotImage({ shot, className, onScale }: { shot: Shot; className?: string; onScale?: (scale: number | null) => void }) {
  const [loaded] = useImage(shot.path, false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!onScale || !img) return;
    const measure = () => onScale(img.naturalWidth ? img.clientWidth / img.naturalWidth : null);
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    img.addEventListener("load", measure);
    return () => {
      observer.disconnect();
      img.removeEventListener("load", measure);
    };
  }, [onScale, loaded]);
  if (!loaded) return <span className={`shot-pending ${className ?? ""}`} aria-label={`Loading ${shot.name}`} />;
  if ("error" in loaded)
    return (
      <span className={`shot-missing ${className ?? ""}`}>
        <ImageIcon />
        <span>{loaded.error}</span>
      </span>
    );
  return <img ref={ref} className={className} src={loaded.src} alt={describeShot(shot)} draggable={false} />;
}

export function ShotThumb({ shot }: { shot: Shot | null }) {
  const small = shot !== null && (shot.size ?? Infinity) <= THUMB_MAX_BYTES;
  const [loaded, observe] = useImage(small ? shot.path : null, true);
  return (
    <span ref={observe} className="shot-thumb-img">
      {loaded && "src" in loaded ? <img src={loaded.src} alt="" draggable={false} /> : <ImageIcon />}
    </span>
  );
}

export function describeShot(shot: Shot): string {
  return [stateLabel(shot.state), ...variantWords(shot)].join(" · ");
}

export function variantWords(shot: Shot): string[] {
  return [shot.phase && capital(shot.phase), shot.width && `${shot.width}`, shot.theme && capital(shot.theme)].filter((w): w is string => Boolean(w));
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function scaleText(scale: number | null): string {
  return scale ? `${Math.round(scale * 100)}%` : "";
}

interface SegmentProps<T> {
  label: string;
  values: T[];
  current: T | null;
  name: (value: T) => string;
  enabled?: (value: T) => boolean;
  onPick: (value: T) => void;
}

export function Segment<T extends string | number>({ label, values, current, name, enabled, onPick }: SegmentProps<T>) {
  return (
    <span className="seg" role="group" aria-label={label}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={value === current ? "on" : ""}
          aria-pressed={value === current}
          disabled={enabled ? !enabled(value) : false}
          onClick={() => onPick(value)}
        >
          {name(value)}
        </button>
      ))}
    </span>
  );
}

export const PHASE_NAMES: Record<Phase, string> = { before: "Before", after: "After" };

export function AxisSwitches({ axes, shots, current, onPick }: { axes: Axes; shots: Shot[]; current: Shot; onPick: (shot: Shot) => void }) {
  const choose = <K extends Axis>(axis: K, value: Shot[K]) => {
    const next = pickShot(shots, current, { [axis]: value });
    if (next) onPick(next);
  };
  const reachable = <K extends Axis>(axis: K, value: Shot[K]) => pickShot(shots, current, { [axis]: value, state: current.state }) !== null;
  return (
    <>
      {axes.phase.length > 0 && current.phase && (
        <Segment label="Before or after" values={axes.phase} current={current.phase} name={(p) => PHASE_NAMES[p]} enabled={(p) => reachable("phase", p)} onPick={(p) => choose("phase", p)} />
      )}
      {axes.width.length > 0 && current.width && (
        <Segment label="Width" values={axes.width} current={current.width} name={String} enabled={(w) => reachable("width", w)} onPick={(w) => choose("width", w)} />
      )}
      {axes.theme.length > 0 && current.theme && (
        <Segment label="Theme" values={axes.theme} current={current.theme} name={capital} enabled={(t) => reachable("theme", t)} onPick={(t) => choose("theme", t)} />
      )}
    </>
  );
}

interface ShotViewerProps {
  set: ShotSet;
  start: Shot;
  title: string;
  onClose: () => void;
}

export function ShotViewer(props: ShotViewerProps) {
  return createPortal(<ViewerLayer {...props} />, document.body);
}

export function ViewerLayer({ set, start, title, onClose }: ShotViewerProps) {
  const [current, setCurrent] = useState(start);
  const [mode, setMode] = useState<CompareMode>("flip");
  const [zoomed, setZoomed] = useState(false);
  const [split, setSplit] = useState(HALF);
  const [scale, setScale] = useState<number | null>(null);
  const [wide, setWide] = useState(() => window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH);
  const dialog = useRef<HTMLDivElement>(null);
  const shots = set.shots;
  const pair = counterpart(shots, current);
  const before = current.phase === "before" ? current : pair;
  const after = current.phase === "after" ? current : pair;
  const comparing = pair !== null && mode !== "flip";
  const at = shots.findIndex((s) => s.path === current.path);
  const variants = shots.filter((s) => s.state === current.state);

  const show = (shot: Shot) => {
    setCurrent(shot);
    setZoomed(false);
  };

  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const onResize = () => setWide(window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      back?.focus();
    };
  }, []);

  useEffect(() => {
    if (mode === "side" && !wide) setMode("slider");
  }, [mode, wide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (e.key !== "Escape" && step === 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") onClose();
      else setCurrent((c) => stepShot(shots, c, step));
      setZoomed(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shots, onClose]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Screenshots: ${title}`} ref={dialog} tabIndex={-1}>
      <div className="viewer-bar">
        <span className="viewer-title" title={current.path}>
          <span className="viewer-task">{title}</span>
          <span>{describeShot(current)}</span>
        </span>
        {pair && (
          <Segment<CompareMode>
            label="Compare"
            values={wide ? ["flip", "slider", "side"] : ["flip", "slider"]}
            current={mode}
            name={(m) => ({ flip: "Flip", slider: "Slider", side: "Side by side" })[m]}
            onPick={setMode}
          />
        )}
        <AxisSwitches axes={comparing ? { ...set.axes, phase: [] } : set.axes} shots={shots} current={current} onPick={show} />
        <span className="viewer-count">
          {at + 1} / {shots.length}
        </span>
        <button type="button" className="ico viewer-close" onClick={onClose} aria-label="Close screenshots" title="Close (Esc)">
          <Close />
        </button>
      </div>
      <div className="viewer-body">
        <div className={`viewer-stage ${zoomed ? "zoomed" : ""}`}>
          {comparing && before && after ? (
            mode === "slider" ? (
              <Slider before={before} after={after} split={split} onSplit={setSplit} />
            ) : (
              <div className="viewer-side">
                <Framed shot={before} />
                <Framed shot={after} />
              </div>
            )
          ) : (
            <button type="button" className="viewer-frame" onClick={() => setZoomed((z) => !z)} title={zoomed ? "Fit to window" : "Show at full size"}>
              <ShotImage shot={current} className="viewer-img" onScale={setScale} />
            </button>
          )}
          {!comparing && <span className="viewer-scale">{zoomed ? "1:1" : `fit · ${scaleText(scale)}`}</span>}
        </div>
        <aside className="viewer-side-panel">
          <StateMatrix set={set} current={current} onPick={show} />
          <div className="viewer-file">
            <h4 className="sech">File</h4>
            <code>
              {current.folder}/{current.name}
            </code>
            <div className="file-actions wide">
              <button type="button" className="btn btn-small" onClick={() => void api.openFile(current.path)}>
                <OpenIcon />
                <span>Open</span>
              </button>
              <button type="button" className="btn btn-small" onClick={() => void api.revealFile(current.path)}>
                <RevealIcon />
                <span>Reveal</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
      {variants.length > 1 && (
        <div className="viewer-film" role="group" aria-label={`Variants of ${stateLabel(current.state)}`}>
          {variants.map((shot) => (
            <button key={shot.path} type="button" className={`film-cell ${shot.path === current.path ? "on" : ""}`} onClick={() => show(shot)} title={shot.name}>
              <ShotThumb shot={shot} />
              <span className="film-label">{variantWords(shot).join(" ") || shot.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  return <span className={`shot-badge phase-${phase} viewer-phase`}>{PHASE_NAMES[phase]}</span>;
}

function Framed({ shot }: { shot: Shot }) {
  return (
    <div className="viewer-half">
      <ShotImage shot={shot} className="viewer-img" />
      {shot.phase && <PhaseBadge phase={shot.phase} />}
    </div>
  );
}

function Slider({ before, after, split, onSplit }: { before: Shot; after: Shot; split: number; onSplit: (at: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect && rect.width > 0) onSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };
  const clip: CSSProperties = { clipPath: `inset(0 ${100 - split}% 0 0)` };
  return (
    <div
      className="viewer-slider"
      ref={box}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        move(e.clientX);
      }}
      onPointerMove={(e) => dragging && move(e.clientX)}
      onPointerUp={() => setDragging(false)}
    >
      <ShotImage shot={after} className="viewer-img" />
      <div className="viewer-slider-top" style={clip}>
        <ShotImage shot={before} className="viewer-img" />
      </div>
      <span className="viewer-split" style={{ left: `${split}%` }}>
        <span className="viewer-knob">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 4.5L2.5 8L6 11.5M10 4.5L13.5 8L10 11.5" />
          </svg>
        </span>
      </span>
      <span className="shot-badge phase-before viewer-phase">Before</span>
      <span className="shot-badge phase-after viewer-phase right">After</span>
      <input
        className="sr-only"
        type="range"
        min={0}
        max={100}
        value={Math.round(split)}
        aria-label="Before and after divider"
        onChange={(e) => onSplit(Number(e.target.value))}
      />
    </div>
  );
}

function StateMatrix({ set, current, onPick }: { set: ShotSet; current: Shot; onPick: (shot: Shot) => void }) {
  const themes = set.axes.theme;
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    list.current?.querySelector(".matrix-cell.on")?.scrollIntoView?.({ block: "nearest" });
  }, [current.path]);
  const cell = (shot: Shot | null, key: string, label: string): ReactNode =>
    shot ? (
      <button key={key} type="button" className={`matrix-cell ${shot.path === current.path ? "on" : ""}`} onClick={() => onPick(shot)} title={describeShot(shot)} aria-label={label}>
        <ShotThumb shot={shot} />
      </button>
    ) : (
      <span key={key} className="matrix-cell empty" />
    );
  return (
    <div className="viewer-matrix">
      <h4 className="sech">{themes.length > 0 ? "States × theme" : `States · ${set.states.length}`}</h4>
      <div className="matrix-grid" ref={list} style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${Math.max(themes.length, 1)}, 64px)` }}>
        {themes.length > 0 && (
          <>
            <span />
            {themes.map((t) => (
              <span key={t} className="matrix-head">
                {capital(t)}
              </span>
            ))}
          </>
        )}
        {set.states.map((state) => (
          <MatrixRow key={state} state={state} active={state === current.state}>
            {themes.length > 0
              ? themes.map((theme) => cell(pickShot(set.shots, current, { state, theme }), `${state}-${theme}`, `${stateLabel(state)}, ${theme}`))
              : [cell(pickShot(set.shots, current, { state }), state, stateLabel(state))]}
          </MatrixRow>
        ))}
      </div>
    </div>
  );
}

function MatrixRow({ state, active, children }: { state: string; active: boolean; children: ReactNode }) {
  return (
    <>
      <span className={`matrix-state ${active ? "on" : ""}`} title={stateLabel(state)}>
        {stateLabel(state)}
      </span>
      {children}
    </>
  );
}
