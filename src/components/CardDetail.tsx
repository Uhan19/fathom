import { useEffect, useState } from "react";
import { api, errorText, type Card, type Detail, type MoveRequest, type RowKey, type SourceKind, type Terminal } from "../api";
import { cardMessage, holdHeading, linkLabel } from "../board";
import { cardMessageLabel, cardMessagePrompt, moveCopy } from "../source";
import { Close } from "./Icons";

interface CardDetailProps {
  card: Card;
  source: SourceKind;
  rowNames: Record<RowKey, string>;
  request: MoveRequest | null;
  width: number;
  chatTerminal: Terminal | null;
  onClose: () => void;
  onOpenCard: (id: string) => void;
  onResend: (requestId: string) => void;
  onDismiss: (requestId: string) => void;
}

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; to: string } | { kind: "failed"; error: string };

export function CardDetail({ card, source, rowNames, request, width, chatTerminal, onClose, onOpenCard, onResend, onDismiss }: CardDetailProps) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [send, setSend] = useState<SendState>({ kind: "idle" });

  useEffect(() => {
    let current = true;
    setDetail(null);
    setLoadError(null);
    setSend({ kind: "idle" });
    api
      .cardDetail(card.id)
      .then((d) => current && setDetail(d))
      .catch((e) => current && setLoadError(errorText(e)));
    return () => {
      current = false;
    };
  }, [card.id]);

  const shown = detail?.card ?? card;
  const hold = holdHeading(shown);
  const canSend = draft.trim().length > 0 && chatTerminal !== null && send.kind !== "sending";

  const submit = async () => {
    if (!canSend || !chatTerminal) return;
    setSend({ kind: "sending" });
    try {
      await api.sendToTerminal(chatTerminal.address, cardMessage(shown, draft));
      setDraft("");
      setSend({ kind: "sent", to: chatTerminal.name || chatTerminal.address });
    } catch (e) {
      setSend({ kind: "failed", error: errorText(e) });
    }
  };

  return (
    <section className="detail" style={{ width }} aria-label={`Card: ${shown.title}`}>
      <div className="detail-head">
        <div className="detail-title-row">
          <h2 className="detail-title">{shown.title}</h2>
          <button className="ico" onClick={onClose} aria-label="Close card" title="Close card">
            <Close />
          </button>
        </div>
        <div className="detail-meta">
          <span className={`pill pill-${shown.row}`}>{rowNames[shown.row]}</span>
          <span className="meta-text">
            {shown.project} · {shown.kind} · <code>{shown.id}</code>
          </span>
        </div>
        {shown.links.length > 0 && (
          <div className="detail-links">
            {shown.links.map((link) => (
              <button key={`${link.kind}:${link.target}`} className="link" onClick={() => api.openLink(link.target)}>
                {linkLabel(link)} ↗
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="detail-scroll">
        {request && <MoveSection request={request} source={source} rowNames={rowNames} onResend={onResend} onDismiss={onDismiss} />}
        {hold && (
          <div className={`sec hold hold-${shown.holdKind}`}>
            <span className="sech">{hold}</span>
            {shown.holdReason ? <p className="prose">{shown.holdReason}</p> : <p className="muted">No reason recorded.</p>}
          </div>
        )}
        {shown.blockedBy.length > 0 && (
          <div className="sec">
            <span className="sech">Waits for</span>
            <div className="chips">
              {shown.blockedBy.map((id) => (
                <button key={id} className="chip" onClick={() => onOpenCard(id)}>
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="sec">
          <span className="sech">Details</span>
          {loadError && <p className="error-text">Could not load the full card: {loadError}</p>}
          {!detail && !loadError && <p className="muted">Loading…</p>}
          {detail && (detail.body ? <p className="prose">{detail.body}</p> : <p className="muted">No details recorded.</p>)}
        </div>
        {detail && (
          <div className="sec facts">
            {detail.created && <Fact name="Created" value={detail.created} />}
            {shown.closed && <Fact name="Closed" value={shown.closed} />}
            {detail.priority && <Fact name="Priority" value={detail.priority} />}
            <Fact name="State" value={shown.state.replace("_", " ")} />
          </div>
        )}
      </div>

      <form
        className="detail-send"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="send-row">
          <label className="grow">
            <span className="sr-only">{cardMessageLabel(source)}</span>
            <input
              className="text-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={cardMessagePrompt(source, chatTerminal !== null)}
              disabled={!chatTerminal}
            />
          </label>
          <button className="btn btn-dark" type="submit" disabled={!canSend}>
            {send.kind === "sending" ? "Sending…" : "Send"}
          </button>
        </div>
        {send.kind === "sent" && <span className="send-note">Sent to {send.to}.</span>}
        {send.kind === "failed" && <span className="send-note error-text">Not sent: {send.error}</span>}
      </form>
    </section>
  );
}

function Fact({ name, value }: { name: string; value: string }) {
  return (
    <div className="fact">
      <span>{name}</span>
      <span>{value}</span>
    </div>
  );
}

interface MoveSectionProps {
  request: MoveRequest;
  source: SourceKind;
  rowNames: Record<RowKey, string>;
  onResend: (requestId: string) => void;
  onDismiss: (requestId: string) => void;
}

function MoveSection({ request, source, rowNames, onResend, onDismiss }: MoveSectionProps) {
  const copy = moveCopy(source, request.status, `from ${rowNames[request.fromRow]} to ${rowNames[request.toRow]}`);
  if (!copy) return null;
  switch (request.status) {
    case "failed":
      return (
        <div className="sec move move-failed">
          <span className="sech">{copy.heading}</span>
          <p className="error-text">
            {copy.body} {request.error}
          </p>
          <div className="move-actions">
            <button className="btn btn-dark" onClick={() => onResend(request.requestId)}>
              Send again
            </button>
            <button className="btn" onClick={() => onDismiss(request.requestId)}>
              Cancel
            </button>
          </div>
        </div>
      );
    case "answered":
      return (
        <div className="sec move move-answered">
          <span className="sech">{copy.heading}</span>
          <p className="muted">{copy.body}</p>
          <p className="prose">{request.answer}</p>
          <div className="move-actions">
            <button className="btn" onClick={() => onDismiss(request.requestId)}>
              Dismiss
            </button>
          </div>
        </div>
      );
    default:
      return (
        <div className="sec move">
          <span className="sech">{copy.heading}</span>
          <p className="prose">{copy.body}</p>
        </div>
      );
  }
}
