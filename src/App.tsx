import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  errorText,
  events,
  ROW_ORDER,
  type AgentFilter,
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
  type Waits,
  type WindowChange,
  type Worker,
} from "./api";
import { appearanceOf, boardStyle, chatFontStack, type Appearance } from "./appearance";
import { oneColumnWidth, placeLocally, rowCounts, shownRequest } from "./board";
import { emptyBoardText } from "./source";
import { moveTo } from "./columnOrder";
import { startDrag } from "./drag";
import { Board } from "./components/Board";
import { AgentFilterToggle } from "./components/AgentFilterToggle";
import { Switch } from "./components/Switch";
import { agentFilterText } from "./agentFilter";
import { Brand } from "./components/Brand";
import { CardDetail } from "./components/CardDetail";
import { ChatPanel } from "./components/ChatPanel";
import { chatTitle, initialAgent, type AgentKey } from "./agents";
import { WorkerTerminal, type Watched } from "./components/WorkerTerminal";
import { ChatRail } from "./components/TabStrip";
import { SettingsDialog } from "./components/SettingsDialog";
import { BosunDrawer } from "./components/BosunDrawer";
import { DRAWER_HEIGHT, isMac, isToggleShortcut, shortcutLabel } from "./bosun";
import { filterText, indexAmongAll, shownColumns } from "./projectFilter";
import { focusText } from "./taskRef";
import { DEFAULT_THEME, otherTheme } from "./theme";
import { comboLabel, listenForShortcuts, type ShortcutAction } from "./shortcuts";
import { chatResizer, detailResizer } from "./windowSettings";
import { isUnseen, leftCard, NO_UPDATES, seenLocally, type CardUpdates } from "./updates";
import { waitsOf } from "./waits";

const NO_HELPER: HelperStatus = { terminal: null, status: "", asking: false };
const NO_WAITS: Waits = { tasks: {}, people: {} };

interface Folded {
  columns: number[];
  rows: RowKey[];
}
const MAC = isMac(navigator.platform);
const SHORTCUT = shortcutLabel(MAC);

const withShortcut = (text: string, combo: string | undefined) => (combo ? `${text} (${comboLabel(combo, MAC)})` : text);

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
  const [updates, setUpdates] = useState<CardUpdates>(NO_UPDATES);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [columnError, setColumnError] = useState<string | null>(null);
  const [watched, setWatched] = useState<Watched | null>(null);
  const [helper, setHelper] = useState<HelperStatus>(NO_HELPER);
  const [bosunOpen, setBosunOpen] = useState(false);
  const [bosunHeight, setBosunHeight] = useState(DRAWER_HEIGHT.initial);
  const [activeTabName, setActiveTabName] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<Folded | null>(null);
  const launchLogged = useRef(false);
  const shortcutActions = useRef<Record<ShortcutAction, () => void> | null>(null);
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
      events.updates((u) => alive && setUpdates(u)),
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
    api
      .cardUpdates()
      .then((u) => alive && setUpdates(u))
      .catch(() => undefined);
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
  const agentFilter = settings?.agentFilter ?? "all";
  const focus = settings?.focus ?? [];

  const boardRoom = () => {
    const main = mainRef.current;
    const board = boardColumnRef.current;
    if (!main || !board) return { shown: 0, min: 0 };
    const scroll = board.querySelector(".board-scroll");
    const scrollbar = scroll ? scroll.getBoundingClientRect().width - scroll.clientWidth : 0;
    return {
      shown: board.getBoundingClientRect().width - (main.scrollWidth - main.clientWidth),
      min: oneColumnWidth(columns) + scrollbar,
    };
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

  shortcutActions.current = {
    toggleChat: () => changeWindow({ chatOpen: !chatOpen }),
    toggleTheme: () => changeWindow({ theme: otherTheme(theme) }),
    openSettings: () => setSettingsOpen(true),
  };

  const shortcuts = settings?.shortcuts;
  useEffect(() => {
    if (!shortcuts) return;
    return listenForShortcuts(window, shortcuts, (action) => shortcutActions.current?.[action]());
  }, [shortcuts]);

  const showAllProjects = () => {
    setSettings((s) => s && { ...s, projectFilter: [] });
    void api
      .showAllProjects()
      .then(setSettings)
      .catch(() => api.getSettings().then(setSettings));
  };

  const clearFocus = () => {
    setSettings((s) => s && { ...s, focus: [] });
    void api
      .clearFocus()
      .then(setSettings)
      .catch(() => api.getSettings().then(setSettings));
  };

  const changeAgentFilter = (filter: AgentFilter) => {
    setSettings((s) => s && { ...s, agentFilter: filter });
    void api
      .setAgentFilter(filter)
      .then(setSettings)
      .catch(() => api.getSettings().then(setSettings));
  };

  const rowNames = useMemo(() => {
    const names = Object.fromEntries(ROW_ORDER.map((r) => [r, r])) as Record<RowKey, string>;
    view?.rows.forEach((r) => (names[r.row] = r.name));
    return names;
  }, [view]);
  const linking = useMemo(
    () => ({ linearWorkspace: settings?.linearWorkspace ?? "", ticketPrefixes: settings?.ticketPrefixes ?? [] }),
    [settings?.linearWorkspace, settings?.ticketPrefixes],
  );
  const collapsedRows = useMemo(() => (view?.rows ?? []).filter((r) => r.collapsed).map((r) => r.row), [view]);

  const cards = view?.cards ?? [];
  const counts = rowCounts(cards);
  const selected = cards.find((c) => c.id === selectedId) ?? null;
  const detailShown = selected !== null && appearance !== null;

  const changeColumn = (id: number, change: { width?: number; collapsed?: boolean }) => {
    setView((v) => v && { ...v, columns: v.columns.map((c) => (c.id === id ? { ...c, ...change } : c)) });
    void api.updateColumn(id, change);
  };

  const collapseRows = (rows: RowKey[], collapsed: boolean) => {
    setView((v) => v && { ...v, rows: v.rows.map((r) => (rows.includes(r.row) ? { ...r, collapsed } : r)) });
    void api.setRowsCollapsed(rows, collapsed);
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

  const moveColumn = (id: number, shownIndex: number, shown: Column[]) => {
    if (!view) return;
    const index = indexAmongAll(view.columns, shown, id, shownIndex);
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
  const waits = view?.waits ?? NO_WAITS;
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
  const anyCollapsed = columns.some((c) => c.collapsed) || collapsedRows.length > 0;
  useEffect(() => {
    if (anyCollapsed) setUnfolded(null);
  }, [anyCollapsed]);
  const fold = (folded: Folded, collapsed: boolean) => {
    folded.columns.forEach((id) => changeColumn(id, { collapsed }));
    if (folded.rows.length > 0) collapseRows(folded.rows, collapsed);
  };
  const expandAll = (expand: boolean) => {
    if (!expand) {
      if (unfolded) fold(unfolded, true);
      return;
    }
    const folded = { columns: columns.filter((c) => c.collapsed).map((c) => c.id), rows: collapsedRows };
    fold(folded, false);
    setUnfolded(folded);
  };

  const onSettingsSaved = (saved: Settings) => {
    setSettings(saved);
    setPreview(null);
    setSettingsOpen(false);
    void api.readBoard().then(accept).catch((e) => setReadError(errorText(e)));
  };

  const markSeen = (cardId: string) => {
    if (!isUnseen(updates, cardId)) return;
    const mark = updates.marks[cardId];
    setUpdates((u) => seenLocally(u, cardId));
    void api.markSeen(cardId, mark);
  };

  const openCard = (next: string | null) => {
    const left = leftCard(selectedId, next);
    if (left !== null) markSeen(left);
    setSelectedId(next);
  };

  const selectCard = (card: Card) => openCard(selectedId === card.id ? null : card.id);
  const connectionKey = settings ? `${settings.hcSession}|${settings.hcSocket}|${settings.terminalLabel}` : "";
  const chatSource = view?.source ?? (settings?.home.trim() ? "firstmate" : "fathom");
  const chatAgent = initialAgent(chatSource, pickedAgent ?? settings?.chatAgent ?? null);
  const chatName = chatTitle(chatSource, chatTerminal, chatAgent);

  return (
    <div className="app">
      <header className="top">
        <Brand />
        <span className="count">
          <span className="count-label">
            <span className="count-lead">At the </span>surface
          </span>
          <b className="count-surface">{counts.surface}</b>
        </span>
        <span className="count">
          <span className="count-label">
            <span className="count-lead">In the </span>shallows
          </span>
          <b className="count-shallows">{counts.shallows}</b>
        </span>
        <span className={`herdr-dot${herdr.connected ? " up" : ""}`} title={herdr.connected ? "herdr-core connected" : herdr.message}>
          <span className="herdr-label">herdr-core</span>
        </span>
        <div className="header-toggles">
          <AgentFilterToggle filter={agentFilter} disabled={!settings} onChange={changeAgentFilter} />
          {(anyCollapsed || unfolded) && (
            <Switch
              label="Expand all"
              checked={!anyCollapsed}
              title={anyCollapsed ? "Open every folded column and collapsed row" : "Fold back what Expand all opened"}
              onChange={expandAll}
            />
          )}
          <Switch
            label="Dark mode"
            checked={theme === "dark"}
            disabled={!settings}
            title={withShortcut("Switch light and dark", shortcuts?.toggleTheme)}
            onChange={(dark) => changeWindow({ theme: dark ? "dark" : "light" })}
          />
        </div>
        <button className="btn btn-header" onClick={() => setSettingsOpen(true)} disabled={!settings} title={withShortcut("Settings", shortcuts?.openSettings)}>
          Settings
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
          {(focus.length > 0 || projectFilter.length > 0 || agentFilter !== "all") && (
            <div className="filter-strip" role="status">
              {focus.length > 0 && (
                <div className="filter-part">
                  <span>{focusText(focus)}</span>
                  <button className="mini" onClick={clearFocus}>
                    Clear focus
                  </button>
                </div>
              )}
              {projectFilter.length > 0 && (
                <div className="filter-part">
                  <span>{filterText(projectFilter)}</span>
                  <button className="mini" onClick={showAllProjects}>
                    Show all
                  </button>
                </div>
              )}
              {agentFilter !== "all" && (
                <div className="filter-part">
                  <span>{agentFilterText(agentFilter)}</span>
                  <button className="mini" onClick={() => changeAgentFilter("all")}>
                    Show every card
                  </button>
                </div>
              )}
            </div>
          )}
          {view ? (
            view.columns.length > 0 ? (
              <Board
                cards={cards}
                source={view.source}
                columns={columns}
                overlay={overlay}
                waits={waits.tasks}
                workers={workerByTask}
                updates={updates}
                rowNames={rowNames}
                collapsedRows={collapsedRows}
                agentFilter={agentFilter}
                focus={focus}
                projectsFiltered={projectFilter.length > 0}
                selectedId={selectedId}
                onSelect={selectCard}
                onColumnChange={changeColumn}
                onRowCollapse={(row, collapsed) => collapseRows([row], collapsed)}
                onShowEveryCard={() => changeAgentFilter("all")}
                onClearFocus={clearFocus}
                onColumnRename={renameColumn}
                onColumnMove={moveColumn}
                onColumnAdd={projectFilter.length > 0 || focus.length > 0 ? undefined : (name) => void replaceColumns(api.addColumn(name))}
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
            />
          )}
        </div>
        {detailShown && (
          <>
            <div
              className="panel-handle"
              role="separator"
              aria-label="Resize card panel"
              onPointerDown={(e) => {
                const width = detailResizer(detailWidth, boardRoom());
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
              waits={waitsOf(waits.tasks, selected.id)}
              people={waits.people}
              width={detailWidth}
              chatTerminal={chatTerminal}
              worker={workerByTask[selected.id] ?? null}
              fontFamily={chatFontStack(appearance)}
              fontSize={appearance.chatFontSize}
              theme={theme}
              linking={linking}
              mark={updates.marks[selected.id] ?? ""}
              onClose={() => openCard(null)}
              onOpenCard={(id) => cards.some((c) => c.id === id) && openCard(id)}
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
                const widths = chatResizer({ chat: chatWidth, detail: detailShown ? detailWidth : null }, boardRoom());
                startDrag(
                  e,
                  (dx) => {
                    const next = widths(-dx);
                    setChatDrag(next.chat);
                    setDetailDrag(next.detail);
                  },
                  (dx) => {
                    const next = widths(-dx);
                    setChatDrag(null);
                    setDetailDrag(null);
                    changeWindow(next.detail === null ? { chatWidth: next.chat } : { chatWidth: next.chat, detailWidth: next.detail });
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
              mac={MAC}
              hideTitle={withShortcut("Hide chat", shortcuts?.toggleChat)}
              open={chatOpen}
              onTerminal={setChatTerminal}
              onActiveTab={setActiveTabName}
              onShow={() => changeWindow({ chatOpen: true })}
              onCollapse={() => changeWindow({ chatOpen: false })}
            />
          </div>
        )}
        {settings && !chatOpen && <ChatRail name={activeTabName ?? chatName} title={withShortcut("Show chat", shortcuts?.toggleChat)} onOpen={() => changeWindow({ chatOpen: true })} />}
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
          mac={MAC}
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
