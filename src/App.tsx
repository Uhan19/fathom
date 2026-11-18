import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  errorText,
  events,
  ROW_ORDER,
  type BoardView,
  type Card,
  type Column,
  type HerdrStatus,
  type MoveTo,
  type Overlay,
  type Placement,
  type RowKey,
  type Settings,
  type Terminal,
  type Worker,
} from "./api";
import { appearanceOf, boardStyle, chatFontStack, type Appearance } from "./appearance";
import { placeLocally, rowCounts, shownRequest } from "./board";
import { emptyBoardText } from "./source";
import { moveTo } from "./columnOrder";
import { startDrag } from "./drag";
import { Board } from "./components/Board";
import { CardDetail } from "./components/CardDetail";
import { ChatPanel } from "./components/ChatPanel";
import { WorkerTerminal, type Watched } from "./components/WorkerTerminal";
import { ChevronLeft } from "./components/Icons";
import { SettingsDialog } from "./components/SettingsDialog";
import { INITIAL_THEME, otherTheme, themeToggleLabel, type Theme } from "./theme";

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
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [columnError, setColumnError] = useState<string | null>(null);
  const [watched, setWatched] = useState<Watched | null>(null);
  const [theme, setTheme] = useState<Theme>(INITIAL_THEME);
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
    const unlisten = [
      events.board((b) => alive && accept(b)),
      events.herdr((s) => alive && setHerdr(s)),
      events.workers((w) => alive && setWorkers(w)),
    ];
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
    api.workers().then((w) => alive && setWorkers(w));
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const rowNames = useMemo(() => {
    const names = Object.fromEntries(ROW_ORDER.map((r) => [r, r])) as Record<RowKey, string>;
    view?.rowNames.forEach((r) => (names[r.row] = r.name));
    return names;
  }, [view]);

  const cards = view?.cards ?? [];
  const counts = rowCounts(cards);
  const selected = cards.find((c) => c.id === selectedId) ?? null;

  const changeColumn = (id: number, change: { width?: number; collapsed?: boolean }) => {
    setView((v) => v && { ...v, columns: v.columns.map((c) => (c.id === id ? { ...c, ...change } : c)) });
    void api.updateColumn(id, change);
  };

  const renameColumn = (id: number, name: string) => {
    setView((v) => v && { ...v, columns: v.columns.map((c) => (c.id === id ? { ...c, name } : c)) });
    void api.setColumnName(id, name);
  };

  const replaceColumns = (change: Promise<Column[]>) =>
    change
      .then((columns) => {
        setColumnError(null);
        setView((v) => v && { ...v, columns });
      })
      .catch((e) => setColumnError(errorText(e)));

  const moveColumn = (id: number, index: number) => {
    setView((v) => v && { ...v, columns: moveTo(v.columns, id, index) });
    void replaceColumns(api.moveColumn(id, index));
  };

  const deleteColumn = (id: number, moveTo?: MoveTo) =>
    api
      .deleteColumn(id, moveTo)
      .then(({ columns, overlay }) => {
        setColumnError(null);
        setView((v) => v && { ...v, columns, ...overlay });
      })
      .catch((e) => {
        throw errorText(e);
      });

  const overlay: Overlay = { places: view?.places ?? [], requests: view?.requests ?? [] };
  const workerByTask = useMemo(() => Object.fromEntries(workers.map((w) => [w.taskId, w])) as Record<string, Worker>, [workers]);
  const watchedWorker = watched ? workers.find((w) => w.terminal === watched.terminal) : undefined;
  const applyOverlay = (next: Overlay) => setView((v) => v && { ...v, ...next });
  const changeOverlay = (change: Promise<Overlay>) =>
    change
      .then((next) => {
        setMoveError(null);
        applyOverlay(next);
      })
      .catch((e) => {
        setMoveError(errorText(e));
        void api.cachedBoard().then((cached) => applyOverlay({ places: cached.places, requests: cached.requests }));
      });

  const placeCard = (placement: Placement) => {
    setView((v) => v && { ...v, ...placeLocally({ places: v.places, requests: v.requests }, placement, Date.now()) });
    void changeOverlay(api.placeCard(placement, chatTerminal?.address ?? null));
  };

  const anyCollapsed = view?.columns.some((c) => c.collapsed) ?? false;
  const expandAll = () => view?.columns.filter((c) => c.collapsed).forEach((c) => changeColumn(c.id, { collapsed: false }));

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
          <span className="brand-name" role="img" aria-label="Fathom">
            <span aria-hidden="true">FATHOM</span>
          </span>
        </div>
        <span className="count">
          <span className="count-label">At the surface</span>
          <b className="count-surface">{counts.surface}</b>
        </span>
        <span className="count">
          <span className="count-label">In the shallows</span>
          <b className="count-shallows">{counts.shallows}</b>
        </span>
        <span className={`herdr-dot${herdr.connected ? " up" : ""}`} title={herdr.connected ? "herdr-core connected" : herdr.message}>
          herdr-core
        </span>
        {anyCollapsed && (
          <button className="btn btn-header" onClick={expandAll}>
            Expand all
          </button>
        )}
        <button className="btn btn-header" onClick={() => setTheme(otherTheme)}>
          {themeToggleLabel(theme)}
        </button>
        <button className="btn btn-header" onClick={() => setSettingsOpen(true)} disabled={!settings}>
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
      {moveError && (
        <div className="banner" role="status">
          Could not save the move: {moveError}
        </div>
      )}
      {columnError && (
        <div className="banner" role="status">
          Could not change the columns: {columnError}
        </div>
      )}
      <main className="main">
        {view ? (
          view.columns.length > 0 ? (
            <Board
              cards={cards}
              source={view.source}
              columns={view.columns}
              overlay={overlay}
              workers={workerByTask}
              rowNames={rowNames}
              selectedId={selectedId}
              onSelect={selectCard}
              onColumnChange={changeColumn}
              onColumnRename={renameColumn}
              onColumnMove={moveColumn}
              onColumnAdd={(name) => void replaceColumns(api.addColumn(name))}
              onColumnDelete={deleteColumn}
              onPlace={placeCard}
              onWatch={(card, worker) => setWatched({ taskId: card.id, title: card.title, terminal: worker.terminal })}
            />
          ) : (
            <div className="board-empty">{emptyBoardText(view.source, view.home)}</div>
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
              source={view?.source ?? "firstmate"}
              rowNames={rowNames}
              request={shownRequest(selected.id, overlay.requests)}
              width={detailWidth}
              chatTerminal={chatTerminal}
              onClose={() => setSelectedId(null)}
              onOpenCard={(id) => cards.some((c) => c.id === id) && setSelectedId(id)}
              onResend={(id) => void changeOverlay(api.resendRequest(id))}
              onDismiss={(id) => void changeOverlay(api.dismissRequest(id))}
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
              theme={theme}
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
      {watched && settings && (
        <WorkerTerminal
          key={watched.terminal}
          watched={watched}
          status={watchedWorker?.status ?? null}
          fontFamily={chatFontStack(appearance ?? appearanceOf(settings))}
          fontSize={(appearance ?? settings).chatFontSize}
          theme={theme}
          onClose={() => setWatched(null)}
        />
      )}
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
