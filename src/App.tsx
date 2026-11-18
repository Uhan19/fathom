import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, events, ROW_ORDER, type BoardView, type Card, type HerdrStatus, type RowKey, type Settings, type Terminal } from "./api";
import { appearanceOf, boardStyle, chatFontStack, type Appearance } from "./appearance";
import { rowCounts } from "./board";
import { startDrag } from "./drag";
import { Board } from "./components/Board";
import { CardDetail } from "./components/CardDetail";
import { ChatPanel } from "./components/ChatPanel";
import { ChevronLeft } from "./components/Icons";
import { SettingsDialog } from "./components/SettingsDialog";

const DETAIL_WIDTH = { initial: 460, min: 340, max: 900 };
const CHAT_WIDTH = { initial: 600, min: 300, max: 1400 };

const clamp = (value: number, range: { min: number; max: number }) => Math.max(range.min, Math.min(range.max, value));

export default function App() {
  const [view, setView] = useState<BoardView | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [herdr, setHerdr] = useState<HerdrStatus>({ connected: false, message: "connecting" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatTerminal, setChatTerminal] = useState<Terminal | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<Appearance | null>(null);
  const [detailWidth, setDetailWidth] = useState(DETAIL_WIDTH.initial);
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH.initial);
  const launchLogged = useRef(false);

  const logLaunch = useCallback((board: BoardView) => {
    if (launchLogged.current || (board.fromCache && board.cards.length === 0)) return;
    launchLogged.current = true;
    requestAnimationFrame(() =>
      setTimeout(() => void api.logLaunch(board.fromCache ? "cache" : "read", board.cards.length), 0),
    );
  }, []);

  const accept = useCallback(
    (board: BoardView) => {
      setView(board);
      setReadError(board.error);
      logLaunch(board);
    },
    [logLaunch],
  );

  useEffect(() => {
    let alive = true;
    const unlisten = [events.board((b) => alive && accept(b)), events.herdr((s) => alive && setHerdr(s))];
    api
      .cachedBoard()
      .then((cached) => alive && cached.cards.length > 0 && accept(cached))
      .finally(() =>
        api
          .readBoard()
          .then((fresh) => alive && accept(fresh))
          .catch((e) => alive && setReadError(errorText(e))),
      );
    api.getSettings().then((s) => alive && setSettings(s));
    api.herdrStatus().then((s) => alive && setHerdr(s));
    return () => {
      alive = false;
      unlisten.forEach((p) => void p.then((fn) => fn()));
    };
  }, [accept]);

  const appearance = useMemo(() => preview ?? (settings ? appearanceOf(settings) : null), [preview, settings]);

  useEffect(() => {
    if (!appearance) return;
    const root = document.documentElement.style;
    Object.entries(boardStyle(appearance)).forEach(([name, value]) => root.setProperty(name, value));
  }, [appearance]);

  const rowNames = useMemo(() => {
    const names = Object.fromEntries(ROW_ORDER.map((r) => [r, r])) as Record<RowKey, string>;
    view?.rowNames.forEach((r) => (names[r.row] = r.name));
    return names;
  }, [view]);

  const cards = view?.cards ?? [];
  const counts = rowCounts(cards);
  const selected = cards.find((c) => c.id === selectedId) ?? null;

  const changeColumn = (project: string, change: { width?: number; collapsed?: boolean }) => {
    setView((v) => v && { ...v, columns: v.columns.map((c) => (c.project === project ? { ...c, ...change } : c)) });
    void api.updateColumn(project, change);
  };

  const anyCollapsed = view?.columns.some((c) => c.collapsed) ?? false;
  const expandAll = () => view?.columns.filter((c) => c.collapsed).forEach((c) => changeColumn(c.project, { collapsed: false }));

  const onSettingsSaved = (saved: Settings) => {
    setSettings(saved);
    setPreview(null);
    setSettingsOpen(false);
    void api.readBoard().then(accept).catch((e) => setReadError(errorText(e)));
  };

  const selectCard = (card: Card) => setSelectedId((id) => (id === card.id ? null : card.id));
  const connectionKey = settings ? `${settings.hcSession}|${settings.hcSocket}|${settings.terminalLabel}` : "";

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-name">Fathom</span>
          <span className="brand-sub">Read-only view of Firstmate's tasks. Click a card for details.</span>
        </div>
        <span className="count surface-count">{counts.surface} at the surface</span>
        <span className="count">{counts.shallows} in the shallows</span>
        <span className={`herdr-dot${herdr.connected ? " up" : ""}`} title={herdr.connected ? "herdr-core connected" : herdr.message}>
          herdr-core
        </span>
        {anyCollapsed && (
          <button className="btn" onClick={expandAll}>
            Expand all
          </button>
        )}
        <button className="btn" onClick={() => setSettingsOpen(true)} disabled={!settings}>
          Settings
        </button>
        <button className="btn btn-dark" onClick={() => setChatOpen((o) => !o)}>
          {chatOpen ? "Hide chat" : "Show chat"}
        </button>
      </header>
      {readError && (
        <div className="banner" role="status">
          Could not read tasks: {readError}
        </div>
      )}
      <main className="main">
        {view ? (
          view.columns.length > 0 ? (
            <Board
              cards={cards}
              columns={view.columns}
              rowNames={rowNames}
              selectedId={selectedId}
              onSelect={selectCard}
              onColumnChange={changeColumn}
            />
          ) : (
            <div className="board-empty">No tasks yet in {view.home}.</div>
          )
        ) : (
          <div className="board-empty">{readError ? "" : "Reading tasks…"}</div>
        )}
        {selected && (
          <>
            <div
              className="panel-handle"
              role="separator"
              aria-label="Resize card panel"
              onPointerDown={(e) => {
                const start = detailWidth;
                startDrag(e, (dx) => setDetailWidth(clamp(start - dx, DETAIL_WIDTH)));
              }}
            >
              <span />
            </div>
            <CardDetail
              card={selected}
              rowName={rowNames[selected.row]}
              width={detailWidth}
              chatTerminal={chatTerminal}
              onClose={() => setSelectedId(null)}
              onOpenCard={(id) => cards.some((c) => c.id === id) && setSelectedId(id)}
            />
          </>
        )}
        {settings && (
          <div className={chatOpen ? "chat-wrap" : "chat-wrap closed"}>
            <div
              className="panel-handle"
              role="separator"
              aria-label="Resize chat"
              onPointerDown={(e) => {
                const start = chatWidth;
                startDrag(e, (dx) => setChatWidth(clamp(start - dx, CHAT_WIDTH)));
              }}
            >
              <span />
            </div>
            <ChatPanel
              width={chatWidth}
              label={settings.terminalLabel}
              fontFamily={chatFontStack(appearance ?? appearanceOf(settings))}
              fontSize={(appearance ?? settings).chatFontSize}
              connectionKey={connectionKey}
              onTerminal={setChatTerminal}
              onCollapse={() => setChatOpen(false)}
            />
          </div>
        )}
        {settings && !chatOpen && (
          <button className="chat-rail" onClick={() => setChatOpen(true)} aria-label="Open Firstmate chat">
            <ChevronLeft />
            <span className="vname">Firstmate</span>
          </button>
        )}
      </main>
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          rowNames={rowNames}
          onPreview={setPreview}
          onSaved={onSettingsSaved}
          onClose={() => {
            setPreview(null);
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}
