import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, events, type WorkerStatus } from "../api";
import { useLiveTerminal } from "../liveTerminal";
import { isPlainEscape } from "../terminalInput";
import type { Theme } from "../theme";
import { Close, Sailor } from "./Icons";

export interface Watched {
  taskId: string;
  title: string;
  terminal: string;
}

type Phase = { kind: "attaching" } | { kind: "attached" } | { kind: "ended" } | { kind: "failed"; error: string };

interface WorkerTerminalProps {
  watched: Watched;
  status: WorkerStatus | null;
  fontFamily: string;
  fontSize: number;
  theme: Theme;
  onClose: () => void;
}

export function WorkerTerminal({ watched, status, fontFamily, fontSize, theme, onClose }: WorkerTerminalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "attaching" });
  const { hostRef, scrollRef, attach: attachLive, release, focus } = useLiveTerminal("worker", fontFamily, fontSize, theme);

  const attach = useCallback(async () => {
    setPhase({ kind: "attaching" });
    try {
      if (await attachLive(watched.terminal)) setPhase({ kind: "attached" });
    } catch (e) {
      setPhase({ kind: "failed", error: errorText(e) });
    }
  }, [attachLive, watched.terminal]);

  useEffect(() => {
    void attach();
    return release;
  }, [attach, release]);

  useEffect(() => {
    const unlisten = events.terminalEnded((ended) => {
      if (ended.view === "worker" && ended.terminal === watched.terminal) setPhase({ kind: "ended" });
    });
    return () => void unlisten.then((fn) => fn());
  }, [watched.terminal]);

  useEffect(() => {
    if (phase.kind === "attached") focus();
  }, [phase.kind, focus]);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (!isPlainEscape(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);

  const pressedOnBackdrop = useRef(false);

  const shown = phase.kind === "attached" || phase.kind === "ended";

  return (
    <div
      className="watch-backdrop"
      onMouseDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) onClose();
        pressedOnBackdrop.current = false;
      }}
    >
      <section className="watch" role="dialog" aria-modal="true" aria-label={`Crewmate terminal for ${watched.title}`}>
        <header className="watch-head">
          <span className={`sailor${status ? ` ${status}` : ""}`} aria-hidden="true">
            <Sailor />
          </span>
          <span className="watch-title" title={watched.title}>
            {watched.title}
          </span>
          <span className="terminal-chip">{watched.taskId}</span>
          <span className="terminal-chip">{watched.terminal}</span>
          <span className="watch-status">{status ?? "no longer live"}</span>
          <span className="spacer" />
          <button className="ico" onClick={onClose} aria-label="Close the crewmate terminal" title="Close (the crewmate keeps running)">
            <Close />
          </button>
        </header>
        <div className="chat-body">
          <div ref={scrollRef} className={`terminal-scroll${shown ? "" : " hidden"}`} onClick={focus}>
            <div ref={hostRef} className="terminal-host" />
          </div>
          {phase.kind === "attaching" && <p className="chat-status">Attaching to {watched.terminal}…</p>}
          {phase.kind === "failed" && (
            <div className="chat-status">
              <p className="error-text">{phase.error}</p>
              <button className="btn" onClick={() => void attach()}>
                Try again
              </button>
            </div>
          )}
          {phase.kind === "ended" && (
            <div className="chat-ended">
              <span>Detached from {watched.terminal}.</span>
              <button className="mini" onClick={() => void attach()}>
                Reattach
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
