import { useCallback, useEffect, useState, type RefObject } from "react";
import { api, errorText, events, type ShellTab } from "../api";
import { droppedPathsText } from "../fileDrop";
import { useLiveTerminal } from "../liveTerminal";
import { states } from "../parts";
import { shellView } from "../terminalTabs";
import type { Theme } from "../theme";

export type ShellPhase =
  | { kind: "attaching" }
  | { kind: "attached" }
  | { kind: "ended" }
  | { kind: "gone" }
  | { kind: "failed"; error: string };

interface ShellPaneProps {
  tab: ShellTab;
  active: boolean;
  focusTick: number;
  fontFamily: string;
  fontSize: number;
  theme: Theme;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

const isGone = (terminal: string) =>
  api
    .listTerminals()
    .then((terminals) => !terminals.some((t) => t.address === terminal))
    .catch(() => false);

export function ShellPane({ tab, active, focusTick, fontFamily, fontSize, theme, panelRef, onClose }: ShellPaneProps) {
  const view = shellView(tab.terminal);
  const { hostRef, scrollRef, attach, release, focus, paste, fit } = useLiveTerminal(view, fontFamily, fontSize, theme);
  const [phase, setPhase] = useState<ShellPhase>({ kind: "attaching" });

  const connect = useCallback(async () => {
    setPhase({ kind: "attaching" });
    try {
      if (await attach(tab.terminal)) setPhase({ kind: "attached" });
    } catch (e) {
      setPhase((await isGone(tab.terminal)) ? { kind: "gone" } : { kind: "failed", error: errorText(e) });
    }
  }, [attach, tab.terminal]);

  useEffect(() => {
    void connect();
    return release;
  }, [connect, release]);

  useEffect(() => {
    const unlisten = events.terminalEnded((ended) => {
      if (ended.view === view && ended.terminal === tab.terminal) setPhase({ kind: "ended" });
    });
    return () => void unlisten.then((fn) => fn());
  }, [view, tab.terminal]);

  const attached = phase.kind === "attached";
  useEffect(() => {
    if (!active || !attached) return;
    fit();
    focus();
  }, [active, attached, focusTick, fit, focus]);

  useEffect(() => {
    if (!active || !attached) return;
    const unlisten = events.fileDrop((paths, at) => {
      const hit = document.elementFromPoint(at.x, at.y);
      if (hit && panelRef.current?.contains(hit)) paste(droppedPathsText(paths));
    });
    return () => void unlisten.then((fn) => fn());
  }, [active, attached, panelRef, paste]);

  const shown = phase.kind === "attached" || phase.kind === "ended";
  return (
    <div
      className={active ? "tab-pane" : "tab-pane hidden"}
      data-part="tab-pane"
      data-state={states({ hidden: !active })}
      data-key={tab.terminal}
      role="tabpanel"
      aria-label={tab.name}
    >
      <div
        ref={scrollRef}
        className={shown ? "terminal-scroll" : "terminal-scroll hidden"}
        data-part="terminal-scroll"
        data-state={states({ hidden: !shown })}
        onClick={focus}
      >
        <div ref={hostRef} className="terminal-host" data-part="terminal-host" />
      </div>
      <ShellNotice name={tab.name} phase={phase} onReattach={() => void connect()} onClose={onClose} />
    </div>
  );
}

interface ShellNoticeProps {
  name: string;
  phase: ShellPhase;
  onReattach: () => void;
  onClose: () => void;
}

export function ShellNotice({ name, phase, onReattach, onClose }: ShellNoticeProps) {
  const closeButton = (
    <button className="mini" data-part="mini-button" data-control="shell-close-tab" onClick={onClose}>
      Close tab
    </button>
  );
  switch (phase.kind) {
    case "attaching":
      return <p className="chat-status" data-part="chat-status">Attaching to {name}…</p>;
    case "attached":
      return null;
    case "ended":
      return (
        <div className="chat-ended" data-part="chat-ended">
          <span>Detached from {name}.</span>
          <button className="mini" data-part="mini-button" data-control="shell-reattach" onClick={onReattach}>
            Reattach
          </button>
          {closeButton}
        </div>
      );
    case "gone":
      return (
        <div className="chat-status" data-part="chat-status">
          <p>{name} is gone. Its terminal has ended, so there is nothing to reattach.</p>
          {closeButton}
        </div>
      );
    case "failed":
      return (
        <div className="chat-status" data-part="chat-status">
          <p className="error-text" data-part="error-text">{phase.error}</p>
          <div className="chat-actions" data-part="chat-actions">
            <button className="mini" data-part="mini-button" data-control="shell-retry" onClick={onReattach}>
              Try again
            </button>
            {closeButton}
          </div>
        </div>
      );
  }
}
