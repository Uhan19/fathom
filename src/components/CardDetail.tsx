import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, errorText, type Card, type CardContext, type Detail, type FileEntry, type MoveRequest, type RowKey, type SourceKind, type Terminal, type Worker } from "../api";
import { cardMessage, holdHeading } from "../board";
import { cardLinkSources, findLinks, findPaths, RECORDED_PR, topLinks, type Linking, type Source } from "../links";
import { cardMessageLabel, cardMessagePrompt, moveCopy, sailorLabel } from "../source";
import type { Theme } from "../theme";
import { ActivityTab } from "./DetailActivity";
import { AgentTab } from "./DetailAgent";
import { FilesTab, openEntry } from "./DetailFiles";
import { LinkRow, LinksTab, usePrStatuses, type PrStatuses } from "./DetailLinks";
import { Close, Sailor } from "./Icons";
import { Markdown, type PathAction } from "./Markdown";
import { RichText } from "./RichText";

interface CardDetailProps {
  card: Card;
  source: SourceKind;
  rowNames: Record<RowKey, string>;
  request: MoveRequest | null;
  width: number;
  chatTerminal: Terminal | null;
  worker: Worker | null;
  fontFamily: string;
  fontSize: number;
  theme: Theme;
  linking: Linking;
  mark: string;
  onClose: () => void;
  onOpenCard: (id: string) => void;
  onResend: (requestId: string) => void;
  onDismiss: (requestId: string) => void;
}

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; to: string } | { kind: "failed"; error: string };
type Tab = "overview" | "links" | "files" | "activity" | "agent";
type TabEntry = { tab: Tab; name: string };

const TABS: TabEntry[] = [
  { tab: "overview", name: "Overview" },
  { tab: "links", name: "Links" },
  { tab: "files", name: "Files" },
  { tab: "activity", name: "Activity" },
];
const TABS_WITH_AGENT: TabEntry[] = [...TABS, { tab: "agent", name: "Agent" }];
const TAB_SAILOR_SIZE = 20;

const NO_CONTEXT: CardContext = { hasHome: false, recordedPr: null, activity: [], taskFolder: null };

function useCardContext(id: string, mark: string) {
  const [context, setContext] = useState<CardContext | null>(null);
  useEffect(() => setContext(null), [id]);
  useEffect(() => {
    let alive = true;
    api
      .cardContext(id)
      .then((c) => alive && setContext(c))
      .catch(() => alive && setContext((known) => known ?? { ...NO_CONTEXT, hasHome: true }));
    return () => {
      alive = false;
    };
  }, [id, mark]);
  return context;
}

function useCardFiles(id: string, paths: string[] | null) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = paths?.join("\n") ?? null;
  useEffect(() => {
    setFiles(null);
    setError(null);
  }, [id]);
  useEffect(() => {
    if (key === null) return;
    let alive = true;
    api
      .cardFiles(id, key ? key.split("\n") : [])
      .then((f) => alive && (setFiles(f), setError(null)))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [id, key]);
  return { files, error };
}

function cardSources(card: Card, body: string, context: CardContext): Source[] {
  return [
    ...(context.recordedPr ? [{ name: RECORDED_PR, text: context.recordedPr }] : []),
    ...cardLinkSources(card.links),
    { name: "Title", text: card.title },
    { name: "Note", text: body },
    { name: "Hold reason", text: card.holdReason },
    ...context.activity.map((entry) => ({ name: "Activity", text: entry.text })),
  ];
}

export function CardDetail(props: CardDetailProps) {
  const { card, source, rowNames, request, width, chatTerminal, worker, fontFamily, fontSize, theme, linking, mark, onClose, onOpenCard, onResend, onDismiss } =
    props;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [picked, setPicked] = useState<Tab>("overview");
  const tab: Tab = picked === "agent" && !worker ? "overview" : picked;
  const [previewing, setPreviewing] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const context = useCardContext(card.id, mark);

  useEffect(() => {
    let current = true;
    setDetail(null);
    setLoadError(null);
    setSend({ kind: "idle" });
    setPreviewing(null);
    setPicked("overview");
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
  const settled = (detail !== null || loadError !== null) && context !== null;
  const sources = useMemo(
    () => (settled && context ? cardSources(shown, detail?.body ?? "", context) : null),
    [settled, context, shown, detail?.body],
  );
  const links = useMemo(() => (sources ? findLinks(sources, linking) : []), [sources, linking]);
  const paths = useMemo(() => (sources && context?.hasHome ? findPaths(sources) : null), [sources, context?.hasHome]);
  const { files, error: filesError } = useCardFiles(card.id, paths);
  const prUrls = useMemo(() => links.filter((l) => l.kind === "pr").map((l) => l.url), [links]);
  const statuses = usePrStatuses(prUrls);

  const byMention = useMemo(() => {
    const map = new Map<string, FileEntry>();
    for (const file of files ?? []) for (const raw of file.mentions) map.set(raw, file);
    return map;
  }, [files]);

  useEffect(() => {
    if (!worker) setPicked((p) => (p === "agent" ? "overview" : p));
  }, [worker]);

  const showTab = (next: Tab) => {
    setPicked(next);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const preview = useCallback((path: string | null) => {
    setPreviewing(path);
    if (path) setPicked("files");
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  const onPath = useCallback<PathAction>(
    (raw) => {
      const entry = byMention.get(raw);
      return entry ? () => openEntry(entry, preview) : null;
    },
    [byMention, preview],
  );

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

  const hasHome = context?.hasHome ?? source === "firstmate";
  const counts: Record<Tab, number | null> = {
    overview: null,
    links: sources ? links.length : null,
    files: hasHome && files ? files.length : null,
    activity: hasHome && context ? context.activity.length : null,
    agent: null,
  };

  return (
    <section className="detail" style={{ width }} aria-label={`Card: ${shown.title}`}>
      <div className="detail-head">
        <div className="detail-title-row">
          <h2 className="detail-title">
            <RichText text={shown.title} linking={linking} onPath={onPath} />
          </h2>
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
      </div>

      <TabBar tabs={worker ? TABS_WITH_AGENT : TABS} tab={tab} counts={counts} worker={worker} source={source} onChange={showTab} />

      {tab === "agent" && worker ? (
        <AgentTab
          key={worker.terminal}
          card={shown}
          source={source}
          worker={worker}
          chatTerminal={chatTerminal}
          fontFamily={fontFamily}
          fontSize={fontSize}
          theme={theme}
        />
      ) : (
        <div className="detail-scroll" ref={scrollRef} role="tabpanel" id={`detail-panel-${tab}`} aria-labelledby={`detail-tab-${tab}`}>
          {tab === "overview" && (
            <>
              {request && <MoveSection request={request} source={source} rowNames={rowNames} onResend={onResend} onDismiss={onDismiss} />}
              {hold && (
                <div className={`sec hold hold-${shown.holdKind}`}>
                  <span className="sech">{hold}</span>
                  {shown.holdReason ? (
                    <Markdown text={shown.holdReason} linking={linking} onPath={onPath} />
                  ) : (
                    <p className="muted">No reason recorded.</p>
                  )}
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
                <span className="sech">Note</span>
                {loadError && <p className="error-text">Could not load the full card: {loadError}</p>}
                {!detail && !loadError && <p className="muted">Loading…</p>}
                {detail && (detail.body ? <Markdown text={detail.body} linking={linking} onPath={onPath} /> : <p className="muted">No note recorded.</p>)}
              </div>
              <KeyLinks links={links} statuses={statuses} onAll={() => showTab("links")} />
              {detail && (
                <div className="sec facts">
                  {detail.created && <Fact name="Created" value={detail.created} />}
                  {shown.closed && <Fact name="Closed" value={shown.closed} />}
                  {detail.priority && <Fact name="Priority" value={detail.priority} />}
                  <Fact name="State" value={shown.state.replace("_", " ")} />
                </div>
              )}
            </>
          )}
          {tab === "links" && (sources ? <LinksTab links={links} statuses={statuses} /> : <p className="tab-empty">Looking for links…</p>)}
          {tab === "files" && (
            <FilesTab
              hasHome={hasHome}
              files={files}
              error={filesError}
              taskFolder={context?.taskFolder ?? null}
              cardId={card.id}
              selected={previewing}
              linking={linking}
              onPreview={preview}
            />
          )}
          {tab === "activity" && <ActivityTab hasHome={hasHome} entries={context?.activity ?? null} linking={linking} onPath={onPath} />}
        </div>
      )}

      {tab !== "agent" && (
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
      )}
    </section>
  );
}

interface TabBarProps {
  tabs: TabEntry[];
  tab: Tab;
  counts: Record<Tab, number | null>;
  worker: Worker | null;
  source: SourceKind;
  onChange: (tab: Tab) => void;
}

function TabBar({ tabs, tab, counts, worker, source, onChange }: TabBarProps) {
  const refs = useRef(new Map<Tab, HTMLButtonElement>());
  const step = (e: KeyboardEvent, by: number) => {
    e.preventDefault();
    const at = Math.max(0, tabs.findIndex((t) => t.tab === tab));
    const next = tabs[(at + by + tabs.length) % tabs.length].tab;
    onChange(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div
      className="detail-tabs"
      role="tablist"
      aria-label="Card details"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(e, 1);
        if (e.key === "ArrowLeft") step(e, -1);
      }}
    >
      {tabs.map(({ tab: key, name }) => (
        <button
          key={key}
          ref={(node) => {
            if (node) refs.current.set(key, node);
            else refs.current.delete(key);
          }}
          type="button"
          role="tab"
          id={`detail-tab-${key}`}
          aria-selected={tab === key}
          aria-controls={`detail-panel-${key}`}
          tabIndex={tab === key ? 0 : -1}
          className={`detail-tab ${tab === key ? "on" : ""}`}
          title={key === "agent" && worker ? sailorLabel(source, worker.status) : undefined}
          onClick={() => onChange(key)}
        >
          {key === "agent" && worker && (
            <span className={`sailor ${worker.status}`} aria-hidden="true">
              <Sailor size={TAB_SAILOR_SIZE} />
            </span>
          )}
          {name}
          {key === "agent" && worker && <span className="sr-only">, {worker.status}</span>}
          {counts[key] !== null && counts[key] > 0 && <span className="tab-count">{counts[key]}</span>}
        </button>
      ))}
    </div>
  );
}

function KeyLinks({ links, statuses, onAll }: { links: ReturnType<typeof findLinks>; statuses: PrStatuses; onAll: () => void }) {
  const top = topLinks(links);
  if (top.length === 0) return null;
  return (
    <div className="sec">
      <span className="sech">Key links</span>
      <ul className="link-list">
        {top.map((link) => (
          <LinkRow key={link.url} link={link} status={statuses.get(link.url)} showSources={false} />
        ))}
      </ul>
      {links.length > top.length && (
        <button type="button" className="link more-link" onClick={onAll}>
          All {links.length} links
        </button>
      )}
    </div>
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
