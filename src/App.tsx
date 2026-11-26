import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  type MemoryGroup,
  type MemorySample,
  type QuotaReport,
  type TokenReport,
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
import { appearanceOf, boardStyle, terminalFontStack, type Appearance } from "./appearance";
import { oneColumnWidth, oneLaneWidth, placeLocally, rowCounts, shownRequest } from "./board";
import { emptyBoardText } from "./source";
import { moveTo } from "./columnOrder";
import { startDrag } from "./drag";
import { Board } from "./components/Board";
import { Dashboard, ViewSwitch } from "./components/Dashboard";
import { Machine, type StopState } from "./components/Machine";
import { QuotaCard } from "./components/QuotaCard";
import { Tokens } from "./components/Tokens";
import { withPoint, type Point } from "./machine";
import { AgentFilterToggle } from "./components/AgentFilterToggle";
import { TicketSearch } from "./components/TicketSearch";
import { boardTickets } from "./ticketSearch";
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
import { boardRoomOf, chatResizer, detailResizer, fitPanels, keptAfterDetailDrag, keptWidth } from "./windowSettings";
import { isUnseen, leftCard, NO_UPDATES, seenLocally, type CardUpdates } from "./updates";
import { waitsOf } from "./waits";
import { applyLook } from "./themes/apply";
import { LookContext } from "./themes/context";
import { isSingleMode, lookOf, NAUTICAL_LOOK, shownMode, type Look } from "./themes/look";
import { previewRequests } from "./themes/previews";
import { RESET_EVENT } from "./themes/reset";
import { useDetailEscape } from "./overlayDetail";
import { states } from "./parts";
import { badgesByTask } from "./memory";

const NO_HELPER: HelperStatus = { terminal: null, status: "", asking: false };
const NO_WAITS: Waits = { tasks: {}, people: {} };

interface Folded {
  columns: number[];
  rows: RowKey[];
}
const MAC = isMac(navigator.platform);
const SHORTCUT = shortcutLabel(MAC);

const withShortcut = (text: string, combo: string | undefined) => (combo ? `${text} (${comboLabel(combo, MAC)})` : text);

export default function App({ initialLook = NAUTICAL_LOOK }: { initialLook?: Look }) {
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
  const [memory, setMemory] = useState<MemorySample | null>(null);
  const [memoryHistory, setMemoryHistory] = useState<Point[]>([]);
  const [tokenReport, setTokenReport] = useState<TokenReport | null>(null);
  const [quotaReport, setQuotaReport] = useState<QuotaReport | null>(null);
  const [stops, setStops] = useState<Record<string, StopState>>({});
  const [updates, setUpdates] = useState<CardUpdates>(NO_UPDATES);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [columnError, setColumnError] = useState<string | null>(null);
  const [watched, setWatched] = useState<Watched | null>(null);
  const [helper, setHelper] = useState<HelperStatus>(NO_HELPER);
  const [bosunOpen, setBosunOpen] = useState(false);
  const [bosunHeight, setBosunHeight] = useState(DRAWER_HEIGHT.initial);
  const [activeTabName, setActiveTabName] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<Folded | null>(null);
  const [look, setLook] = useState<Look>(initialLook);
  const [lookPreview, setLookPreview] = useState<Look | null>(null);
  const [themesChanged, setThemesChanged] = useState(0);
  const launchLogged = useRef(false);
  const shortcutActions = useRef<Record<ShortcutAction, () => void> | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const boardColumnRef = useRef<HTMLDivElement>(null);
  const [panelBudget, setPanelBudget] = useState<number | null>(null);

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
      events.themes(() => alive && setThemesChanged((n) => n + 1)),
      events.memory((m) => {
        if (!alive) return;
        setMemory(m);
        setMemoryHistory((h) => withPoint(h, m));
      }),
      events.tokens((r) => alive && setTokenReport(r)),
      events.quota((r) => alive && setQuotaReport(r)),
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
    api
      .tokenReport()
      .then((r) => alive && r && setTokenReport(r))
      .catch(() => undefined);
    api
      .quotaReport()
      .then((r) => alive && setQuotaReport(r))
      .catch(() => undefined);
    return () => {
      alive = false;
      unlisten.forEach((p) => void p.then((fn) => fn()));
    };
  }, [accept]);

  const appearance = useMemo(() => preview ?? (settings ? appearanceOf(settings) : null), [preview, settings]);
  const shownLook = lookPreview ?? look;
  const themeId = settings?.themeId;

  const [previews] = useState(previewRequests);
  const endPreview = () => {
    previews.end();
    setLookPreview(null);
  };

  useEffect(() => {
    if (themeId === undefined) return;
    let alive = true;
    void api
      .activeTheme()
      .then(lookOf)
      .catch(() => NAUTICAL_LOOK)
      .then(async (next) => {
        if (!alive) return;
        const shown = !previews.open;
        if (shown) await applyLook(next);
        if (!alive) return;
        setLook(next);
        if (shown && !previews.open) setLookPreview(null);
      });
    return () => {
      alive = false;
    };
  }, [themeId, themesChanged]);

  useEffect(() => {
    const reset = (e: Event) => {
      endPreview();
      setLook(NAUTICAL_LOOK);
      setPreview(null);
      setSettingsOpen(false);
      const saved = (e as CustomEvent<Settings>).detail;
      if (saved) setSettings(saved);
    };
    window.addEventListener(RESET_EVENT, reset);
    return () => window.removeEventListener(RESET_EVENT, reset);
  }, []);

  const previewLook = (id: string | null) => {
    if (id === null) {
      previews.end();
      void applyLook(look).then(() => {
        if (!previews.open) setLookPreview(null);
      });
      return;
    }
    const current = previews.start();
    void api
      .activeTheme(id)
      .then(lookOf)
      .catch(() => NAUTICAL_LOOK)
      .then(async (next) => {
        if (!current()) return;
        await applyLook(next);
        if (current()) setLookPreview(next);
      });
  };

  useEffect(() => {
    if (!appearance) return;
    const root = document.documentElement.style;
    Object.entries(boardStyle(appearance)).forEach(([name, value]) => root.setProperty(name, value));
  }, [appearance]);

  const singleMode = isSingleMode(shownLook);
  const theme = shownMode(shownLook, settings?.theme ?? DEFAULT_THEME);
  const chatFont = (from: Appearance) => terminalFontStack(from, shownLook.fonts.terminal);
  const overlayDetail = shownLook.layout.detail === "overlay";
  const chatOpen = settings?.chatOpen ?? true;
  const projectFilter = settings?.projectFilter ?? [];
  const agentFilter = settings?.agentFilter ?? "all";
  const focus = settings?.focus ?? [];

  const oneVisibleWidth = () => {
    const { rowLabelWidth: rowLabel, collapsedWidth: collapsed, laneWidth: lane, board } = shownLook.layout;
    const geometry = { rowLabel, collapsed, lane };
    return board === "lanes" ? oneLaneWidth(geometry) : oneColumnWidth(columns, geometry);
  };

  const boardRoom = () => {
    const main = mainRef.current;
    const board = boardColumnRef.current;
    if (!main || !board) return { shown: 0, min: 0 };
    const scroll = board.querySelector(".board-scroll");
    const scrollbar = scroll ? scroll.getBoundingClientRect().width - scroll.clientWidth : 0;
    return boardRoomOf(board.getBoundingClientRect().width - (main.scrollWidth - main.clientWidth), oneVisibleWidth() + scrollbar);
  };

  useLayoutEffect(() => {
    document.documentElement.dataset.mode = theme;
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
    toggleTheme: () => {
      if (!singleMode) changeWindow({ theme: otherTheme(theme) });
    },
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
  const tab = settings?.view ?? "board";
  const onDashboard = tab === "dashboard";
  const selected = cards.find((c) => c.id === selectedId) ?? null;
  const detailShown = selected !== null && appearance !== null && !onDashboard;

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
  const stopWorker = (group: MemoryGroup) => {
    const taskId = group.taskId;
    if (!taskId) return;
    setStops((s) => ({ ...s, [taskId]: { kind: "sending" } }));
    api
      .stopWorker(taskId, group.name)
      .then((outcome) => setStops((s) => ({ ...s, [taskId]: { kind: outcome.kind === "asked" ? "asked" : "sending" } })))
      .catch((e) => setStops((s) => ({ ...s, [taskId]: { kind: "failed", error: errorText(e) } })));
  };
  const settingsLoaded = settings !== null;
  useEffect(() => {
    if (!settingsLoaded) return;
    void api.setMetricsDemand({ dashboard: onDashboard, badges: !onDashboard }).catch(() => undefined);
  }, [settingsLoaded, onDashboard]);
  const memoryBadgeMb = settings?.memoryBadgeMb;
  const badges = useMemo(() => (memoryBadgeMb ? badgesByTask(memory, memoryBadgeMb) : {}), [memory, memoryBadgeMb]);
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
  const tickets = view ? boardTickets(view) : [];
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
    if (lookPreview) setLook(lookPreview);
    endPreview();
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
  const detailAsOverlay = detailShown && overlayDetail;
  const appRef = useRef<HTMLDivElement>(null);
  useDetailEscape(appRef, detailShown, overlayDetail, () => openCard(null));
  const sideDetail = detailShown && !overlayDetail;
  const stored = { chat: settings?.chatWidth ?? 0, detail: settings?.detailWidth ?? 0 };
  const fitted = fitPanels({ chat: chatOpen ? stored.chat : null, detail: sideDetail ? stored.detail : null }, panelBudget);
  const chatWidth = chatDrag ?? fitted.chat ?? stored.chat;
  const detailWidth = detailDrag ?? fitted.detail ?? stored.detail;

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const measure = () => {
      const { shown, min } = boardRoom();
      const panel = (part: string) => main.querySelector(`[data-part="${part}"]`)?.getBoundingClientRect().width ?? 0;
      const budget = Math.round(shown + panel("chat") + (sideDetail ? panel("detail") : 0) - min);
      setPanelBudget((was) => (was === budget ? was : budget));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    return () => observer.disconnect();
  });

  const chatSide = shownLook.layout.chatSide === "left" ? 1 : -1;

  return (
    <LookContext.Provider value={shownLook}>
    <div className="app" data-part="app" ref={appRef}>
      <header className="top" data-part="header" inert={detailAsOverlay}>
        <Brand />
        <ViewSwitch view={tab} onChange={(view) => changeWindow({ view })} />
        <TicketSearch
          tickets={tickets}
          onOpen={(id) => {
            if (onDashboard) changeWindow({ view: "board" });
            openCard(id);
          }}
        />
        <span className="count" data-part="count" data-kind="surface">
          <span className="count-label" data-part="count-label">
            <span className="count-lead" data-part="count-lead">{shownLook.text.surfaceLead}</span>surface
          </span>
          <b className="count-surface" data-part="count-value">{counts.surface}</b>
        </span>
        <span className="count" data-part="count" data-kind="shallows">
          <span className="count-label" data-part="count-label">
            <span className="count-lead" data-part="count-lead">{shownLook.text.shallowsLead}</span>shallows
          </span>
          <b className="count-shallows" data-part="count-value">{counts.shallows}</b>
        </span>
        <span
          className={`herdr-dot${herdr.connected ? " up" : ""}`}
          data-part="herdr-dot"
          data-state={states({ up: herdr.connected })}
          title={herdr.connected ? "herdr-core connected" : herdr.message}
        >
          <span className="herdr-label" data-part="herdr-label">herdr-core</span>
        </span>
        <div className="header-toggles" data-part="header-toggles">
          <AgentFilterToggle filter={agentFilter} disabled={!settings} onChange={changeAgentFilter} />
          {(anyCollapsed || unfolded) && (
            <Switch
              control="expand-all"
              label="Expand all"
              checked={!anyCollapsed}
              title={anyCollapsed ? "Open every folded column and collapsed row" : "Fold back what Expand all opened"}
              onChange={expandAll}
            />
          )}
          {!singleMode && (
            <Switch
              control="toggle-dark-mode"
              label="Dark mode"
              checked={theme === "dark"}
              disabled={!settings}
              title={withShortcut("Switch light and dark", shortcuts?.toggleTheme)}
              onChange={(dark) => changeWindow({ theme: dark ? "dark" : "light" })}
            />
          )}
        </div>
        <button
          className="btn btn-header"
          data-part="button"
          data-kind="header"
          data-control="open-settings"
          onClick={() => setSettingsOpen(true)}
          disabled={!settings}
          title={withShortcut("Settings", shortcuts?.openSettings)}
        >
          Settings
        </button>
      </header>
      {readError && (
        <div className="banner" data-part="banner" role="status" inert={detailAsOverlay}>
          Could not read tasks: {readError}
        </div>
      )}
      {moveError && (
        <div className="banner" data-part="banner" role="status" inert={detailAsOverlay}>
          Could not save the move: {moveError}
        </div>
      )}
      {columnError && (
        <div className="banner" data-part="banner" role="status" inert={detailAsOverlay}>
          Could not change the columns: {columnError}
        </div>
      )}
      <main className="main" data-part="main" ref={mainRef}>
        <div className="board-column" data-part="board-column" ref={boardColumnRef} inert={detailAsOverlay}>
          {onDashboard && (
            <Dashboard
              mac={MAC}
              tokens={<Tokens report={tokenReport} mode={settings?.tokenMode ?? "raw"} onMode={(tokenMode) => changeWindow({ tokenMode })} quota={<QuotaCard report={quotaReport} />} />}
              machine={
              <Machine
                sample={memory}
                history={memoryHistory}
                workers={workers}
                source={view?.source ?? "firstmate"}
                herdr={herdr}
                thresholdMb={settings?.memoryBadgeMb ?? 1024}
                mac={MAC}
                stops={stops}
                onStop={stopWorker}
              />
              }
            />
          )}
          {!onDashboard && (focus.length > 0 || projectFilter.length > 0 || agentFilter !== "all") && (
            <div className="filter-strip" data-part="filter-strip" role="status">
              {focus.length > 0 && (
                <div className="filter-part" data-part="filter-part">
                  <span>{focusText(focus)}</span>
                  <button className="mini" data-part="mini-button" data-control="clear-focus" onClick={clearFocus}>
                    Clear focus
                  </button>
                </div>
              )}
              {projectFilter.length > 0 && (
                <div className="filter-part" data-part="filter-part">
                  <span>{filterText(projectFilter)}</span>
                  <button className="mini" data-part="mini-button" data-control="show-all-projects" onClick={showAllProjects}>
                    Show all
                  </button>
                </div>
              )}
              {agentFilter !== "all" && (
                <div className="filter-part" data-part="filter-part">
                  <span>{agentFilterText(agentFilter)}</span>
                  <button className="mini" data-part="mini-button" data-control="show-every-card" onClick={() => changeAgentFilter("all")}>
                    Show every card
                  </button>
                </div>
              )}
            </div>
          )}
          {onDashboard ? null : view ? (
            view.columns.length > 0 ? (
              <Board
                cards={cards}
                source={view.source}
                columns={columns}
                overlay={overlay}
                waits={waits.tasks}
                workers={workerByTask}
                memory={badges}
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
              <div className="board-empty" data-part="board-empty">{emptyBoardText(view.source, view.home)}</div>
            )
          ) : (
            <div className="board-empty" data-part="board-empty">{readError ? "" : "Reading tasks…"}</div>
          )}
          {settings && (
            <BosunDrawer
              open={bosunOpen}
              height={bosunHeight}
              helper={helper}
              helperStarted={settings.helperStarted}
              mac={MAC}
              shortcut={SHORTCUT}
              fontFamily={chatFont(appearance ?? appearanceOf(settings))}
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
            {detailAsOverlay ? (
              <div className="detail-scrim" data-part="detail-scrim" data-control="close-detail-scrim" aria-hidden="true" onClick={() => openCard(null)} />
            ) : (
            <div
              className="panel-handle"
              data-part="panel-handle"
              data-control="resize-card-panel"
              role="separator"
              aria-label="Resize card panel"
              onPointerDown={(e) => {
                const width = detailResizer(detailWidth, boardRoom());
                startDrag(
                  e,
                  (dx) => setDetailDrag(width(-dx)),
                  (dx) => {
                    setDetailDrag(null);
                    const kept = keptAfterDetailDrag(stored, chatWidth, width(0), width(-dx));
                    changeWindow({ chatWidth: kept.chat, detailWidth: kept.detail });
                  },
                );
              }}
            >
              <span />
            </div>
            )}
            <CardDetail
              overlay={detailAsOverlay}
              card={selected}
              source={view?.source ?? "firstmate"}
              rowNames={rowNames}
              request={shownRequest(selected.id, overlay.requests)}
              waits={waitsOf(waits.tasks, selected.id)}
              people={waits.people}
              width={detailWidth}
              chatTerminal={chatTerminal}
              worker={workerByTask[selected.id] ?? null}
              fontFamily={chatFont(appearance)}
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
          <div className={chatOpen ? "chat-wrap" : "chat-wrap closed"} data-part="chat-wrap" data-state={states({ closed: !chatOpen })} inert={detailAsOverlay}>
            <div
              className="panel-handle"
              data-part="panel-handle"
              data-control="resize-chat"
              role="separator"
              aria-label="Resize chat"
              onPointerDown={(e) => {
                const widths = chatResizer({ chat: chatWidth, detail: sideDetail ? detailWidth : null }, boardRoom());
                const startChat = widths(0).chat;
                startDrag(
                  e,
                  (dx) => {
                    const next = widths(chatSide * dx);
                    setChatDrag(next.chat);
                    setDetailDrag(next.detail);
                  },
                  (dx) => {
                    const next = widths(chatSide * dx);
                    setChatDrag(null);
                    setDetailDrag(null);
                    const chat = keptWidth(stored.chat, startChat, next.chat);
                    changeWindow(next.detail === null ? { chatWidth: chat } : { chatWidth: chat, detailWidth: keptWidth(stored.detail, detailWidth, next.detail) });
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
              fontFamily={chatFont(appearance ?? appearanceOf(settings))}
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
        {settings && !chatOpen && <ChatRail name={activeTabName ?? chatName} title={withShortcut("Show chat", shortcuts?.toggleChat)} inert={detailAsOverlay} onOpen={() => changeWindow({ chatOpen: true })} />}
      </main>
      {watched && settings && (
        <WorkerTerminal
          key={watched.terminal}
          watched={watched}
          source={chatSource}
          status={watchedWorker?.status ?? null}
          fontFamily={chatFont(appearance ?? appearanceOf(settings))}
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
          look={shownLook}
          onPreview={setPreview}
          onPreviewTheme={previewLook}
          onSaved={onSettingsSaved}
          onClose={() => {
            setPreview(null);
            previewLook(null);
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
    </LookContext.Provider>
  );
}
