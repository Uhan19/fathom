import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, errorText, events, type Card, type SourceKind, type Terminal, type Worker } from "../api";
import { canReach, outgoing, sendsOnKey, type Recipient, type Recipients } from "../composer";
import { useLiveTerminal } from "../liveTerminal";
import { cardMessageLabel, cardMessagePrompt, chatAgentTitle, workerMessageLabel, workerMessagePrompt, workerTitle } from "../source";
import type { Theme } from "../theme";
import { ChatIcon, Sailor } from "./Icons";

type Phase = { kind: "attaching" } | { kind: "attached" } | { kind: "ended" } | { kind: "failed"; error: string };
type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; to: string } | { kind: "failed"; error: string };

const RECIPIENT_SAILOR_SIZE = 18;
const IDLE: SendState = { kind: "idle" };

interface AgentTabProps {
  card: Pick<Card, "id" | "title">;
  source: SourceKind;
  worker: Worker;
  chatTerminal: Terminal | null;
  fontFamily: string;
  fontSize: number;
  theme: Theme;
}

export function AgentTab({ card, source, worker, chatTerminal, fontFamily, fontSize, theme }: AgentTabProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "attaching" });
  const { hostRef, scrollRef, attach: attachLive, release, focus } = useLiveTerminal("agent", fontFamily, fontSize, theme);

  const attach = useCallback(async () => {
    setPhase({ kind: "attaching" });
    try {
      if (await attachLive(worker.terminal)) setPhase({ kind: "attached" });
    } catch (e) {
      setPhase({ kind: "failed", error: errorText(e) });
    }
  }, [attachLive, worker.terminal]);

  useEffect(() => {
    void attach();
    return release;
  }, [attach, release]);

  useEffect(() => {
    const unlisten = events.terminalEnded((ended) => {
      if (ended.view === "agent" && ended.terminal === worker.terminal) setPhase({ kind: "ended" });
    });
    return () => void unlisten.then((fn) => fn());
  }, [worker.terminal]);

  const shown = phase.kind === "attached" || phase.kind === "ended";
  const unreachable =
    phase.kind === "failed"
      ? `Cannot reach ${worker.terminal}: ${phase.error}`
      : phase.kind === "ended"
        ? `Detached from ${worker.terminal}. Reattach to send again.`
        : null;

  return (
    <div className="detail-agent" role="tabpanel" id="detail-panel-agent" aria-labelledby="detail-tab-agent">
      <div className="chat-body">
        <div ref={scrollRef} className={`terminal-scroll${shown ? "" : " hidden"}`} onClick={focus}>
          <div ref={hostRef} className="terminal-host" />
        </div>
        {phase.kind === "attaching" && <p className="chat-status">Attaching to {worker.terminal}…</p>}
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
            <span>Detached from {worker.terminal}.</span>
            <button className="mini" onClick={() => void attach()}>
              Reattach
            </button>
          </div>
        )}
      </div>
      <AgentComposer card={card} source={source} worker={worker} unreachable={unreachable} chatTerminal={chatTerminal} />
    </div>
  );
}

interface AgentComposerProps {
  card: Pick<Card, "id" | "title">;
  source: SourceKind;
  worker: Worker;
  unreachable: string | null;
  chatTerminal: Terminal | null;
}

export function AgentComposer({ card, source, worker, unreachable, chatTerminal }: AgentComposerProps) {
  const [recipient, setRecipient] = useState<Recipient>("worker");
  const [drafts, setDrafts] = useState<Record<Recipient, string>>({ worker: "", chat: "" });
  const [sends, setSends] = useState<Record<Recipient, SendState>>({ worker: IDLE, chat: IDLE });
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const to: Recipients = { card, worker, workerReachable: unreachable === null, chatTerminal };
  const draft = drafts[recipient];
  const send = sends[recipient];
  const reachable = canReach(recipient, to);
  const ready = outgoing(recipient, draft, to) !== null && send.kind !== "sending";

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [draft, recipient]);

  const choose = (next: Recipient) => {
    setRecipient(next);
    fieldRef.current?.focus();
  };

  const submit = async () => {
    const message = outgoing(recipient, draft, to);
    if (!message || send.kind === "sending") return;
    const from = recipient;
    setSends((s) => ({ ...s, [from]: { kind: "sending" } }));
    try {
      await api.sendToTerminal(message.terminal, message.text);
      setDrafts((d) => ({ ...d, [from]: "" }));
      setSends((s) => ({ ...s, [from]: { kind: "sent", to: message.to } }));
    } catch (e) {
      setSends((s) => ({ ...s, [from]: { kind: "failed", error: errorText(e) } }));
    }
  };

  const label = recipient === "worker" ? workerMessageLabel(source, worker.terminal) : cardMessageLabel(source);
  const prompt = recipient === "worker" ? workerMessagePrompt(source, worker.terminal, reachable) : cardMessagePrompt(source, reachable);

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="composer-to" role="group" aria-label="Send to">
        <span className="composer-to-label">To</span>
        <button
          type="button"
          className={`composer-recipient ${recipient === "worker" ? "on" : ""}`}
          aria-pressed={recipient === "worker"}
          onClick={() => choose("worker")}
        >
          <span className={`sailor ${worker.status}`} aria-hidden="true">
            <Sailor size={RECIPIENT_SAILOR_SIZE} />
          </span>
          {workerTitle(source)}
          <span className="terminal-chip">{worker.terminal}</span>
        </button>
        <button
          type="button"
          className={`composer-recipient ${recipient === "chat" ? "on" : ""}`}
          aria-pressed={recipient === "chat"}
          onClick={() => choose("chat")}
        >
          <ChatIcon />
          {chatAgentTitle(source)}
          {chatTerminal && <span className="terminal-chip">{chatTerminal.name || chatTerminal.address}</span>}
        </button>
      </div>
      <div className={`composer-box${reachable ? "" : " off"}`}>
        <label className="sr-only" htmlFor="composer-field">
          {label}
        </label>
        <textarea
          id="composer-field"
          ref={fieldRef}
          className="composer-field"
          rows={2}
          value={draft}
          placeholder={prompt}
          disabled={!reachable}
          onChange={(e) => {
            const value = e.target.value;
            setDrafts((d) => ({ ...d, [recipient]: value }));
          }}
          onKeyDown={(e) => {
            if (!sendsOnKey(e.nativeEvent)) return;
            e.preventDefault();
            void submit();
          }}
        />
        <div className="composer-foot">
          <span className="composer-hint">
            <kbd>Enter</kbd> sends · <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line
          </span>
          <button className="btn btn-dark" type="submit" disabled={!ready}>
            {send.kind === "sending" ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
      {recipient === "worker" && unreachable && <span className="send-note error-text">{unreachable}</span>}
      {send.kind === "sent" && <span className="send-note">Sent to {send.to}.</span>}
      {send.kind === "failed" && <span className="send-note error-text">Not sent: {send.error}</span>}
    </form>
  );
}
