import { useCallback, useEffect, useRef, useState } from "react";
import { chatTitle, findingText, launchErrorText, type AgentKey } from "../agents";
import { api, errorText, events, type ShellTab, type SourceKind, type Terminal } from "../api";
import { droppedPathsText } from "../fileDrop";
import { useLiveTerminal } from "../liveTerminal";
import { CHAT_TAB, closeTab, cycleTab, launcherShortcutLabel, listenForTabKeys, revealTab, tabKeys, withTab } from "../terminalTabs";
import type { Theme } from "../theme";
import { OpenTerminal } from "./OpenTerminal";
import { ShellPane } from "./ShellPane";
import { TabStrip } from "./TabStrip";
import { TerminalLauncher } from "./TerminalLauncher";

type Phase =
  | { kind: "finding" }
  | { kind: "picking"; terminals: Terminal[] | null; error: string | null; reason: string; offerOpen: boolean }
  | { kind: "attached"; terminal: Terminal }
  | { kind: "ended"; terminal: Terminal }
  | { kind: "failed"; error: string };

interface ChatPanelProps {
  width: number;
  label: string;
  source: SourceKind;
  agent: AgentKey;
  agentFolder: string;
  onAgent: (agent: AgentKey) => void;
  fontFamily: string;
  fontSize: number;
  theme: Theme;
  connectionKey: string;
  mac: boolean;
  open: boolean;
  onTerminal: (terminal: Terminal | null) => void;
  onActiveTab: (name: string | null) => void;
  onShow: () => void;
  onCollapse: () => void;
}

export function ChatPanel(props: ChatPanelProps) {
  const { width, label, source, agent, agentFolder, onAgent, fontFamily, fontSize, theme, connectionKey, mac, open, onTerminal, onActiveTab, onShow, onCollapse } = props;
  const [phase, setPhase] = useState<Phase>({ kind: "finding" });
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const picks = useRef(0);
  const { hostRef, scrollRef, attach: attachLive, release, focus, paste, fit } = useLiveTerminal("chat", fontFamily, fontSize, theme);
  const panelRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [tabs, setTabs] = useState<ShellTab[]>([]);
  const [active, setActive] = useState(CHAT_TAB);
  const [launcher, setLauncher] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const chatActive = active === CHAT_TAB;
  const keysRef = useRef<string[]>([CHAT_TAB]);
  keysRef.current = tabKeys(tabs);
  const showRef = useRef(onShow);
  showRef.current = open ? () => undefined : onShow;

  const pick = useCallback(async (reason: string, offerOpen = false) => {
    const current = ++picks.current;
    setPhase({ kind: "picking", terminals: null, error: null, reason, offerOpen });
    try {
      const terminals = await api.listTerminals();
      if (current === picks.current) setPhase({ kind: "picking", terminals, error: null, reason, offerOpen });
    } catch (e) {
      if (current === picks.current) setPhase({ kind: "picking", terminals: [], error: errorText(e), reason, offerOpen });
    }
  }, []);

  const attach = useCallback(
    async (terminal: Terminal) => {
      try {
        if (!(await attachLive(terminal.address))) return;
        picks.current++;
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
      else await pick(`No terminal carries the label ${label}.`, true);
    } catch (e) {
      setPhase({ kind: "failed", error: errorText(e) });
    }
  }, [attach, label, onTerminal, pick]);

  const openAgent = useCallback(async () => {
    setOpening(true);
    setOpenError(null);
    try {
      await attach(await api.openChatTerminal(agent));
    } catch (e) {
      setOpenError(launchErrorText(e));
    } finally {
      setOpening(false);
    }
  }, [agent, attach]);

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
        if (phase.kind === "picking" && !opening) void pick(phase.reason, phase.offerOpen);
      }),
    ];
    return () => unlisten.forEach((p) => void p.then((fn) => fn()));
  }, [phase, pick, onTerminal, opening]);

  const attached = phase.kind === "attached";
  useEffect(() => {
    if (!attached || !chatActive) return;
    fit();
    focus();
  }, [attached, chatActive, focusTick, fit, focus]);

  useEffect(() => {
    let alive = true;
    setTabs([]);
    setActive(CHAT_TAB);
    api
      .shellTabs()
      .then((restored) => alive && setTabs(restored))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [connectionKey]);

  useEffect(
    () =>
      listenForTabKeys(window, mac, {
        openLauncher: () => {
          showRef.current();
          setLauncher(true);
        },
        cycle: (step) => setActive((current) => cycleTab(keysRef.current, current, step)),
      }),
    [mac],
  );

  const activeName = tabs.find((tab) => tab.terminal === active)?.name ?? null;
  useEffect(() => onActiveTab(activeName), [activeName, onActiveTab]);

  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(active)}"]`);
    if (strip && tab) revealTab(strip, tab);
  }, [active, tabs]);

  const openedTab = useCallback((tab: ShellTab) => {
    setTabs((current) => withTab(current, tab));
    setActive(tab.terminal);
    setLauncher(false);
  }, []);

  const closeLauncher = useCallback((refocus: boolean) => {
    setLauncher(false);
    if (refocus) setFocusTick((tick) => tick + 1);
  }, []);

  const closeShell = (tab: ShellTab) => {
    const next = closeTab(tabs, active, tab.terminal);
    setTabs(next.tabs);
    setActive(next.active);
    void api.closeShellTab(tab.terminal).catch(() => undefined);
  };

  useEffect(() => {
    if (!attached || !chatActive) return;
    const unlisten = events.fileDrop((paths, at) => {
      const hit = document.elementFromPoint(at.x, at.y);
      if (hit && panelRef.current?.contains(hit)) paste(droppedPathsText(paths));
    });
    return () => void unlisten.then((fn) => fn());
  }, [attached, chatActive, paste]);

  const shown = phase.kind === "attached" || phase.kind === "ended" ? phase.terminal : null;
  const attachedName = shown ? shown.name || shown.address : null;
  const title = chatTitle(source, shown, agent);

  return (
    <aside ref={panelRef} className="chat" style={{ width }} aria-label={`${title} chat`}>
      <TabStrip
        title={title}
        chip={attachedName}
        canChange={phase.kind === "attached" || phase.kind === "ended"}
        tabs={tabs}
        active={active}
        launcherOpen={launcher}
        shortcut={launcherShortcutLabel(mac)}
        stripRef={stripRef}
        addRef={addRef}
        onActivate={setActive}
        onCloseTab={closeShell}
        onLauncher={() => setLauncher((isOpen) => !isOpen)}
        onChange={() => void pick("Choose the terminal to show here.")}
        onCollapse={onCollapse}
      />
      {launcher && (
        <TerminalLauncher
          mac={mac}
          tabs={tabs}
          chatTerminal={shown?.address ?? null}
          anchorRef={addRef}
          onOpened={openedTab}
          onClose={closeLauncher}
        />
      )}
      <div className="chat-body">
        <div className={chatActive ? "tab-pane" : "tab-pane hidden"} role="tabpanel" aria-label={title}>
          <div
            ref={scrollRef}
            className={`terminal-scroll${phase.kind === "attached" || phase.kind === "ended" ? "" : " hidden"}`}
            onClick={focus}
          >
            <div ref={hostRef} className="terminal-host" />
          </div>
          {phase.kind === "finding" && <p className="chat-status">{findingText(source, label)}</p>}
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
              {phase.offerOpen && (
                <OpenTerminal
                  source={source}
                  agent={agent}
                  folder={agentFolder}
                  opening={opening}
                  error={openError}
                  onAgent={(next) => {
                    setOpenError(null);
                    onAgent(next);
                  }}
                  onOpen={() => void openAgent()}
                />
              )}
              <span className="sech">{phase.offerOpen ? "Or pick a running terminal" : "Pick a herdr-core terminal"}</span>
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
        {tabs.map((tab) => (
          <ShellPane
            key={tab.terminal}
            tab={tab}
            active={tab.terminal === active}
            focusTick={focusTick}
            fontFamily={fontFamily}
            fontSize={fontSize}
            theme={theme}
            panelRef={panelRef}
            onClose={() => closeShell(tab)}
          />
        ))}
      </div>
    </aside>
  );
}
