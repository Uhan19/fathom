import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, events, type Terminal } from "../api";
import { droppedPathsText } from "../fileDrop";
import { useLiveTerminal } from "../liveTerminal";
import { ChevronRight } from "./Icons";

type Phase =
  | { kind: "finding" }
  | { kind: "picking"; terminals: Terminal[] | null; error: string | null; reason: string }
  | { kind: "attached"; terminal: Terminal }
  | { kind: "ended"; terminal: Terminal }
  | { kind: "failed"; error: string };

interface ChatPanelProps {
  width: number;
  label: string;
  fontFamily: string;
  fontSize: number;
  connectionKey: string;
  onTerminal: (terminal: Terminal | null) => void;
  onCollapse: () => void;
}

export function ChatPanel({ width, label, fontFamily, fontSize, connectionKey, onTerminal, onCollapse }: ChatPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "finding" });
  const { hostRef, scrollRef, attach: attachLive, release, focus, paste } = useLiveTerminal("chat", fontFamily, fontSize);
  const panelRef = useRef<HTMLElement>(null);

  const pick = useCallback(async (reason: string) => {
    setPhase({ kind: "picking", terminals: null, error: null, reason });
    try {
      const terminals = await api.listTerminals();
      setPhase({ kind: "picking", terminals, error: null, reason });
    } catch (e) {
      setPhase({ kind: "picking", terminals: [], error: errorText(e), reason });
    }
  }, []);

  const attach = useCallback(
    async (terminal: Terminal) => {
      try {
        if (!(await attachLive(terminal.address))) return;
        setPhase({ kind: "attached", terminal });
        onTerminal(terminal);
      } catch (e) {
        setPhase({ kind: "failed", error: errorText(e) });
        onTerminal(null);
      }
    },
    [attachLive, onTerminal],
  );

  const find = useCallback(async () => {
    setPhase({ kind: "finding" });
    onTerminal(null);
    try {
      const found = await api.findChatTerminal();
      if (found) await attach(found);
      else await pick(`No terminal carries the label ${label}.`);
    } catch (e) {
      setPhase({ kind: "failed", error: errorText(e) });
    }
  }, [attach, label, onTerminal, pick]);

  useEffect(() => {
    void find();
    return release;
  }, [find, connectionKey, release]);

  useEffect(() => {
    const unlisten = [
      events.terminalEnded((ended) => {
        if (ended.view === "chat" && phase.kind === "attached" && ended.terminal === phase.terminal.address) {
          setPhase({ kind: "ended", terminal: phase.terminal });
          onTerminal(null);
        }
      }),
      events.terminals(() => {
        if (phase.kind === "picking") void pick(phase.reason);
      }),
    ];
    return () => unlisten.forEach((p) => void p.then((fn) => fn()));
  }, [phase, pick, onTerminal]);

  useEffect(() => {
    if (phase.kind === "attached") focus();
  }, [phase.kind, focus]);

  const attached = phase.kind === "attached";
  useEffect(() => {
    if (!attached) return;
    const unlisten = events.fileDrop((paths, at) => {
      const hit = document.elementFromPoint(at.x, at.y);
      if (hit && panelRef.current?.contains(hit)) paste(droppedPathsText(paths));
    });
    return () => void unlisten.then((fn) => fn());
  }, [attached, paste]);

  const attachedName = phase.kind === "attached" || phase.kind === "ended" ? phase.terminal.name || phase.terminal.address : null;

  return (
    <aside ref={panelRef} className="chat" style={{ width }} aria-label="Firstmate chat">
      <div className="chat-head">
        <span className="chat-title">Firstmate</span>
        {attachedName && <span className="terminal-chip">{attachedName}</span>}
        <span className="spacer" />
        {(phase.kind === "attached" || phase.kind === "ended") && (
          <button className="mini" onClick={() => void pick("Choose the terminal to show here.")}>
            Change
          </button>
        )}
        <button className="ico" onClick={onCollapse} aria-label="Collapse chat" title="Collapse chat">
          <ChevronRight />
        </button>
      </div>
      <div className="chat-body">
        <div
          ref={scrollRef}
          className={`terminal-scroll${phase.kind === "attached" || phase.kind === "ended" ? "" : " hidden"}`}
          onClick={focus}
        >
          <div ref={hostRef} className="terminal-host" />
        </div>
        {phase.kind === "finding" && <p className="chat-status">Looking for Firstmate's terminal ({label})…</p>}
        {phase.kind === "failed" && (
          <div className="chat-status">
            <p className="error-text">{phase.error}</p>
            <button className="btn" onClick={() => void find()}>
              Try again
            </button>
          </div>
        )}
        {phase.kind === "ended" && (
          <div className="chat-ended">
            <span>Detached from {attachedName}.</span>
            <button className="mini" onClick={() => void attach(phase.terminal)}>
              Reattach
            </button>
          </div>
        )}
        {phase.kind === "picking" && (
          <div className="picker">
            <p className="picker-reason">{phase.reason}</p>
            <span className="sech">Pick a herdr-core terminal</span>
            {phase.error && <p className="error-text">{phase.error}</p>}
            {phase.terminals === null && <p className="muted">Listing terminals…</p>}
            {phase.terminals?.length === 0 && !phase.error && <p className="muted">No terminals are running.</p>}
            <ul className="picker-list">
              {phase.terminals?.map((t) => (
                <li key={t.address}>
                  <button className="picker-item" onClick={() => void attach(t)}>
                    <span className="picker-name">{t.name || t.address}</span>
                    <span className="picker-meta">
                      {t.address}
                      {t.agent ? ` · ${t.agent}` : ""}
                      {t.cwd ? ` · ${t.cwd}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="mini" onClick={() => void find()}>
              Look for the label again
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
