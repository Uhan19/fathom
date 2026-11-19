import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  errorText,
  events,
  ROW_ORDER,
  type BoardView,
  type Card,
  type Column,
  type HelperStatus,
  type HerdrStatus,
  type MoveTo,
  type Overlay,
  type Placement,
  type RowKey,
  type Settings,
  type Terminal,
  type WindowChange,
  type Worker,
} from "./api";
import { appearanceOf, boardStyle, chatFontStack, type Appearance } from "./appearance";
import { placeLocally, rowCounts, shownRequest } from "./board";
import { emptyBoardText } from "./source";
import { moveTo } from "./columnOrder";
import { resizer, startDrag } from "./drag";
import { Board } from "./components/Board";
import { Brand } from "./components/Brand";
import { CardDetail } from "./components/CardDetail";
import { ChatPanel } from "./components/ChatPanel";
import { chatTitle, initialAgent, type AgentKey } from "./agents";
import { WorkerTerminal, type Watched } from "./components/WorkerTerminal";
import { ChevronLeft } from "./components/Icons";
import { SettingsDialog } from "./components/SettingsDialog";
import { BosunDrawer } from "./components/BosunDrawer";
import { BOSUN, DRAWER_HEIGHT, dotOf, isMac, isToggleShortcut, shortcutLabel, summaryOf, type BosunState } from "./bosun";
import { filterText, indexAmongAll, shownColumns } from "./projectFilter";
import { DEFAULT_THEME, otherTheme, themeToggleLabel } from "./theme";
import { CHAT_WIDTH, DETAIL_WIDTH } from "./windowSettings";

const NO_HELPER: HelperStatus = { terminal: null, status: "", asking: false };
const MAC = isMac(navigator.platform);
const SHORTCUT = shortcutLabel(MAC);

export default function App() {
  const [view, setView] = useState<BoardView | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [herdr, setHerdr] = useState<HerdrStatus>({ connected: false, message: "connecting" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatTerminal, setChatTerminal] = useState<Terminal | null>(null);
  const [pickedAgent, setPickedAgent] = useState<AgentKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<Appearance | null>(null);
  const [detailDrag, setDetailDrag] = useState<number | null>(null);
  const [chatDrag, setChatDrag] = useState<number | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [columnError, setColumnError] = useState<string | null>(null);
  const [watched, setWatched] = useState<Watched | null>(null);
  const [helper, setHelper] = useState<HelperStatus>(NO_HELPER);
  const [bosunOpen, setBosunOpen] = useState(false);
  const [bosunHeight, setBosunHeight] = useState(DRAWER_HEIGHT.initial);
  const [bosunState, setBosunState] = useState<BosunState>("finding");
  const launchLogged = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const boardColumnRef = useRef<HTMLDivElement>(null);

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
      events.settings((s) => alive && setSettings(s)),
      events.helper((h) => alive && setHelper(h)),
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
    api.helperStatus().then((h) => alive && setHelper(h));
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

  const theme = settings?.theme ?? DEFAULT_THEME;
  const chatOpen = settings?.chatOpen ?? true;
  const chatWidth = chatDrag ?? settings?.chatWidth ?? 0;
  const detailWidth = detailDrag ?? settings?.detailWidth ?? 0;
  const projectFilter = settings?.projectFilter ?? [];

  const panelRoom = (width: number) => {
    const main = mainRef.current;
    const board = boardColumnRef.current;
    if (!main || !board) return width;
    const hidden = main.scrollWidth - main.clientWidth;
    return width + board.getBoundingClientRect().width - hidden;
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const toggle = (e: KeyboardEvent) => {
      if (!isToggleShortcut(e, MAC)) return;
      e.preventDefault();
      e.stopPropagation();
      setBosunOpen((o) => !o);
    };
    window.addEventListener("keydown", toggle, true);
    return () => window.removeEventListener("keydown", toggle, true);
  }, []);

  const changeWindow = (change: WindowChange) => {
    setSettings((s) => s && { ...s, ...change });
    void api
      .changeWindow(change)
      .then(setSettings)
      .catch(() => api.getSettings().then(setSettings));
  };

  const showAllProjects = () => {
    setSettings((s) => s && { ...s, projectFilter: [] });
    void api
      .showAllProjects()
      .then(setSettings)
      .catch(() => api.getSettings().then(setSettings));
  };

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

  const moveColumn = (id: number, shownIndex: number) => {
    if (!view) return;
    const index = indexAmongAll(view.columns, shownColumns(view.columns, projectFilter), id, shownIndex);
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

  const columns = shownColumns(view?.columns ?? [], projectFilter);
  const anyCollapsed = columns.some((c) => c.collapsed);
  const expandAll = () => columns.filter((c) => c.collapsed).forEach((c) => changeColumn(c.id, { collapsed: false }));

  const onSettingsSaved = (saved: Settings) => {
    setSettings(saved);
    setPreview(null);
    setSettingsOpen(false);
    void api.readBoard().then(accept).catch((e) => setReadError(errorText(e)));
  };

  const selectCard = (card: Card) => setSelectedId((id) => (id === card.id ? null : card.id));
  const connectionKey = settings ? `${settings.hcSession}|${settings.hcSocket}|${settings.terminalLabel}` : "";
  const chatSource = view?.source ?? (settings?.home.trim() ? "firstmate" : "fathom");
  const chatAgent = initialAgent(chatSource, pickedAgent ?? settings?.chatAgent ?? null);
  const chatName = chatTitle(chatSource, chatTerminal, chatAgent);

  return (
    <div className="app">
      <header className="top">
        <Brand />
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
        <button className="btn btn-header" onClick={() => changeWindow({ theme: otherTheme(theme) })} disabled={!settings}>
          {themeToggleLabel(theme)}
        </button>
        <button className="btn btn-header" onClick={() => setSettingsOpen(true)} disabled={!settings}>
          Settings
        </button>
        <button
          className={`btn btn-header bosun-button${bosunOpen ? " on" : ""}`}
          onClick={() => setBosunOpen((o) => !o)}
          disabled={!settings}
          aria-expanded={bosunOpen}
          title={`${summaryOf(bosunState)} (${SHORTCUT})`}
        >
          <span className={`bosun-dot ${dotOf(bosunState)}`} aria-hidden="true" />
          {BOSUN}
        </button>
        <button className="btn btn-dark" onClick={() => changeWindow({ chatOpen: !chatOpen })} disabled={!settings}>
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
      <main className="main" ref={mainRef}>
        <div className="board-column" ref={boardColumnRef}>
          {projectFilter.length > 0 && (
            <div className="filter-strip" role="status">
              <span>{filterText(projectFilter)}</span>
              <button className="mini" onClick={showAllProjects}>
                Show all
              </button>
            </div>
          )}
          {view ? (
            view.columns.length > 0 ? (
              <Board
                cards={cards}
                source={view.source}
                columns={columns}
                overlay={overlay}
                workers={workerByTask}
                rowNames={rowNames}
                selectedId={selectedId}
                onSelect={selectCard}
                onColumnChange={changeColumn}
                onColumnRename={renameColumn}
                onColumnMove={moveColumn}
                onColumnAdd={projectFilter.length > 0 ? undefined : (name) => void replaceColumns(api.addColumn(name))}
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
          {settings && (
            <BosunDrawer
              open={bosunOpen}
              height={bosunHeight}
              helper={helper}
              helperStarted={settings.helperStarted}
              mac={MAC}
              shortcut={SHORTCUT}
              fontFamily={chatFontStack(appearance ?? appearanceOf(settings))}
              fontSize={(appearance ?? settings).chatFontSize}
              theme={theme}
              connectionKey={connectionKey}
              onHeight={setBosunHeight}
              onToggle={() => setBosunOpen((o) => !o)}
              onState={setBosunState}
            />
          )}
        </div>
        {selected && (
          <>
            <div
              className="panel-handle"
              role="separator"
              aria-label="Resize card panel"
              onPointerDown={(e) => {
                const width = resizer(detailWidth, panelRoom(detailWidth), DETAIL_WIDTH);
                startDrag(
                  e,
                  (dx) => setDetailDrag(width(-dx)),
                  (dx) => {
                    setDetailDrag(null);
                    changeWindow({ detailWidth: width(-dx) });
                  },
                );
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
                const width = resizer(chatWidth, panelRoom(chatWidth), CHAT_WIDTH);
                startDrag(
                  e,
                  (dx) => setChatDrag(width(-dx)),
                  (dx) => {
                    setChatDrag(null);
                    changeWindow({ chatWidth: width(-dx) });
                  },
                );
              }}
            >
              <span />
            </div>
            <ChatPanel
              width={chatWidth}
              label={settings.terminalLabel}
              source={chatSource}
              agent={chatAgent}
              agentFolder={chatAgent === "firstmate" ? settings.home : settings.agentFolder}
              onAgent={setPickedAgent}
              fontFamily={chatFontStack(appearance ?? appearanceOf(settings))}
              fontSize={(appearance ?? settings).chatFontSize}
              theme={theme}
              connectionKey={connectionKey}
              onTerminal={setChatTerminal}
              onCollapse={() => changeWindow({ chatOpen: false })}
            />
          </div>
        )}
        {settings && !chatOpen && (
          <button className="chat-rail" onClick={() => changeWindow({ chatOpen: true })} aria-label={`Open ${chatName} chat`}>
            <ChevronLeft />
            <span className="vname">{chatName}</span>
          </button>
        )}
      </main>
      {watched && settings && (
        <WorkerTerminal
          key={watched.terminal}
          watched={watched}
          source={chatSource}
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
