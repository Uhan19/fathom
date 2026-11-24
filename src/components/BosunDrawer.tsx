import { useCallback, useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { launchErrorText } from "../agents";
import { api, errorText, events, type HelperStatus, type SignIn, type Terminal } from "../api";
import {
  BOARD_ABOVE_DRAWER,
  BOSUN,
  BREW_COMMAND,
  DRAWER_HEIGHT,
  EXAMPLE_REQUESTS,
  INSTALL_COMMAND,
  bosunState,
  dotOf,
  drawerRoom,
  hintOf,
  summaryOf,
  type BosunPhase,
} from "../bosun";
import { resizer, startDrag } from "../drag";
import { useLiveTerminal } from "../liveTerminal";
import { states } from "../parts";
import type { Theme } from "../theme";
import { ChevronDown, ChevronUp } from "./Icons";

const CLAUDE = "claude";
const COPIED_MS = 1500;
const MAX_HEIGHT = `calc(100% - ${BOARD_ABOVE_DRAWER}px)`;

interface BosunDrawerProps {
  open: boolean;
  height: number;
  helper: HelperStatus;
  helperStarted: boolean;
  mac: boolean;
  shortcut: string;
  fontFamily: string;
  fontSize: number;
  theme: Theme;
  connectionKey: string;
  onHeight: (height: number) => void;
  onToggle: () => void;
}

const missesClaude = (error: unknown) =>
  typeof error === "object" && error !== null && "kind" in error && error.kind === "missing" && "tool" in error && error.tool === CLAUDE;

export function BosunDrawer(props: BosunDrawerProps) {
  const { open, helper, helperStarted, fontFamily, fontSize, theme, connectionKey } = props;
  const [phase, setPhase] = useState<BosunPhase>({ kind: "finding" });
  const { hostRef, scrollRef, attach: attachLive, release, focus } = useLiveTerminal("helper", fontFamily, fontSize, theme);
  const startedRef = useRef(helperStarted);
  startedRef.current = helperStarted;
  const stoppedRef = useRef<string | null>(null);
  const soughtRef = useRef<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const attach = useCallback(
    async (terminal: Terminal, signIn: SignIn | null) => {
      try {
        if (await attachLive(terminal.address)) setPhase({ kind: "running", terminal, signIn });
      } catch (e) {
        setPhase({ kind: "failed", error: errorText(e) });
      }
    },
    [attachLive],
  );

  const find = useCallback(async () => {
    setPhase({ kind: "finding" });
    try {
      const found = await api.findHelper();
      if (found) await attach(found, null);
      else setPhase({ kind: startedRef.current ? "dormant" : "notStarted" });
    } catch (e) {
      setPhase({ kind: "failed", error: errorText(e) });
    }
  }, [attach]);

  const start = useCallback(async () => {
    setPhase({ kind: "starting" });
    try {
      const check = await api.helperCheck();
      if (!check.claude) {
        setPhase({ kind: "missing" });
        return;
      }
      await attach(await api.openHelper(), check.signIn);
    } catch (e) {
      setPhase(missesClaude(e) ? { kind: "missing" } : { kind: "failed", error: launchErrorText(e) });
    }
  }, [attach]);

  const stop = useCallback(async () => {
    if (phase.kind !== "running") return false;
    stoppedRef.current = phase.terminal.address;
    try {
      await api.stopHelper(phase.terminal.address);
      setPhase({ kind: "stopped", terminal: phase.terminal });
      return true;
    } catch (e) {
      setPhase({ kind: "failed", error: errorText(e) });
      return false;
    }
  }, [phase]);

  const restart = useCallback(async () => {
    if (await stop()) await start();
  }, [start, stop]);

  useEffect(() => {
    void find();
    return release;
  }, [find, connectionKey, release]);

  useEffect(() => {
    if (open && phase.kind === "dormant") void start();
  }, [open, phase.kind, start]);

  useEffect(() => {
    const unlisten = events.terminalEnded((ended) => {
      if (ended.view === "helper" && phase.kind === "running" && ended.terminal === phase.terminal.address) {
        setPhase({ kind: "stopped", terminal: phase.terminal });
      }
    });
    return () => void unlisten.then((fn) => fn());
  }, [phase]);

  useEffect(() => {
    const appeared = helper.terminal;
    const idle = ["notStarted", "dormant", "stopped", "failed"].includes(phase.kind);
    if (!appeared || !idle || appeared === stoppedRef.current || appeared === soughtRef.current) return;
    soughtRef.current = appeared;
    void find();
  }, [helper.terminal, phase.kind, find]);

  const runningTerminal = phase.kind === "running" ? phase.terminal : null;
  const signedOut = phase.kind === "running" && phase.signIn === "signedOut";
  useEffect(() => {
    if (!runningTerminal || !signedOut) return;
    let alive = true;
    void api.helperCheck().then((check) => {
      if (alive && check.signIn === "signedIn") setPhase({ kind: "running", terminal: runningTerminal, signIn: check.signIn });
    });
    return () => {
      alive = false;
    };
  }, [runningTerminal, signedOut, helper.status]);

  const state = bosunState(phase, helper);

  useEffect(() => {
    if (open && phase.kind === "running") focus();
  }, [open, phase.kind, focus]);

  const hint = hintOf(state);
  const running = phase.kind === "running";
  const shownTerminal = phase.kind === "running" || phase.kind === "stopped";

  return (
    <>
      <section
        ref={drawerRef}
        className={`bosun${open ? "" : " closed"}`}
        data-part="bosun"
        data-state={states({ closed: !open })}
        style={{ height: props.height, maxHeight: MAX_HEIGHT }}
        aria-label={BOSUN}
      >
        <div
          className="bosun-handle"
          data-part="bosun-handle"
          data-control="resize-helper"
          role="separator"
          aria-label="Resize Bosun"
          onPointerDown={(e) => {
            const column = drawerRef.current?.parentElement;
            const height = resizer(props.height, column ? drawerRoom(column.clientHeight) : props.height, DRAWER_HEIGHT);
            startDrag(e, (dy) => props.onHeight(height(-dy)), (dy) => props.onHeight(height(-dy)), "y");
          }}
        >
          <span />
        </div>
        <header className="bosun-head" data-part="bosun-head">
          <span className={`bosun-dot ${dotOf(state)}`} data-part="bosun-dot" data-state={dotOf(state)} aria-hidden="true" />
          <span className="bosun-title" data-part="bosun-title">{BOSUN}</span>
          <span className="bosun-summary" data-part="bosun-summary">{summaryOf(state)}</span>
          <span className="spacer" data-part="spacer" />
          {running && (
            <>
              <button className="mini" data-part="mini-button" data-control="helper-restart" onClick={() => void restart()}>
                Restart
              </button>
              <button className="mini" data-part="mini-button" data-control="helper-stop" onClick={() => void stop()}>
                Stop
              </button>
            </>
          )}
          <button className="ico" data-part="icon-button" data-control="helper-close" onClick={props.onToggle} aria-label={`Close ${BOSUN}`} title={`Close ${BOSUN} (${props.shortcut})`}>
            <ChevronDown />
          </button>
        </header>
        {hint && (
          <p className={`bosun-hint ${state}`} data-part="bosun-hint" data-state={state}>
            {hint}
          </p>
        )}
        <div className="chat-body bosun-body" data-part="chat-body" data-kind="bosun">
          <div
            ref={scrollRef}
            className={`terminal-scroll${shownTerminal ? "" : " hidden"}${phase.kind === "stopped" ? " dimmed" : ""}`}
            data-part="terminal-scroll"
            data-state={states({ hidden: !shownTerminal, dimmed: phase.kind === "stopped" })}
            onClick={focus}
          >
            <div ref={hostRef} className="terminal-host" data-part="terminal-host" />
          </div>
          <Screen phase={phase} mac={props.mac} onStart={() => void start()} onFind={() => void find()} />
        </div>
      </section>
      {!open && (
        <button className="bosun-rail" data-part="bosun-rail" data-control="helper-open" onClick={props.onToggle} aria-label={`Open ${BOSUN}`} title={`Open ${BOSUN} (${props.shortcut})`}>
          <ChevronUp />
          <span className={`bosun-dot ${dotOf(state)}`} data-part="bosun-dot" data-state={dotOf(state)} aria-hidden="true" />
          <span className="bosun-title" data-part="bosun-title">{BOSUN}</span>
          <span className="bosun-summary" data-part="bosun-summary">{summaryOf(state)}</span>
          <span className="spacer" data-part="spacer" />
          <kbd>{props.shortcut}</kbd>
        </button>
      )}
    </>
  );
}

interface ScreenProps {
  phase: BosunPhase;
  mac: boolean;
  onStart: () => void;
  onFind: () => void;
}

function Screen({ phase, mac, onStart, onFind }: ScreenProps) {
  switch (phase.kind) {
    case "finding":
      return <p className="chat-status" data-part="chat-status">Looking for {BOSUN}…</p>;
    case "dormant":
    case "starting":
      return <p className="chat-status" data-part="chat-status">Starting {BOSUN}…</p>;
    case "notStarted":
      return <Intro onStart={onStart} />;
    case "missing":
      return <Install mac={mac} onCheck={onStart} />;
    case "failed":
      return (
        <div className="chat-status" data-part="chat-status">
          <p className="error-text" data-part="error-text">{phase.error}</p>
          <button className="btn" data-part="button" data-control="helper-retry" onClick={onFind}>
            Try again
          </button>
        </div>
      );
    case "stopped":
      return (
        <div className="chat-ended" data-part="chat-ended">
          <span>{BOSUN} stopped.</span>
          <button className="mini" data-part="mini-button" data-control="helper-start-again" onClick={onStart}>
            Start again
          </button>
        </div>
      );
    case "running":
      return null;
  }
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="bosun-screen" data-part="bosun-screen">
      <div className="bosun-about" data-part="bosun-about">
        <p>
          {BOSUN} changes Fathom when you ask in plain words: columns, rows, which projects show, the theme, fonts and panels. It runs Claude Code
          with only Fathom's own tools and asks before risky changes.
        </p>
        <button className="btn btn-dark" data-part="button" data-kind="dark" data-control="helper-start" onClick={onStart}>
          Start {BOSUN}
        </button>
        <p className="muted" data-part="muted">{BOSUN} keeps running when Fathom quits, and Fathom finds it again next time.</p>
      </div>
      <div className="bosun-examples" data-part="bosun-examples">
        <span className="sech" data-part="sech">Try asking</span>
        <ul>
          {EXAMPLE_REQUESTS.map((request) => (
            <li key={request}>{request}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Install({ mac, onCheck }: { mac: boolean; onCheck: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => void writeText(INSTALL_COMMAND).then(() => setCopied(true), () => undefined);

  return (
    <div className="bosun-screen" data-part="bosun-screen">
      <div className="bosun-about" data-part="bosun-about">
        <p>{BOSUN} runs on Claude Code, which is not installed or not on your PATH. Install it in a terminal, then check again.</p>
        <div className="bosun-command" data-part="bosun-command">
          <code>{INSTALL_COMMAND}</code>
          <button className="mini" data-part="mini-button" data-control="helper-copy-install" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {mac && (
          <p className="muted" data-part="muted">
            Or with Homebrew: <code>{BREW_COMMAND}</code>. That copy does not update itself.
          </p>
        )}
        <p className="muted" data-part="muted">Claude Code needs a paid Claude plan or a Claude Console account.</p>
        <button className="btn" data-part="button" data-control="helper-check-again" onClick={onCheck}>
          Check again
        </button>
      </div>
    </div>
  );
}
