import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { api, errorText, events, type Size, type Terminal } from "../api";
import { ChevronRight } from "./Icons";

const FALLBACK_SIZE = { cols: 80, rows: 24 };
const RESIZE_DEBOUNCE_MS = 80;
const USER_INPUT_WINDOW_MS = 150;
const USER_INPUT_EVENTS = ["keydown", "paste", "compositionend"] as const;

type Phase =
  | { kind: "finding" }
  | { kind: "picking"; terminals: Terminal[] | null; error: string | null; reason: string }
  | { kind: "attached"; terminal: Terminal }
  | { kind: "ended"; terminal: Terminal }
  | { kind: "failed"; error: string };

interface ChatPanelProps {
  width: number;
  label: string;
  fontFamily: string;
  fontSize: number;
  connectionKey: string;
  onTerminal: (terminal: Terminal | null) => void;
  onCollapse: () => void;
}

const LIGHT_THEME = {
  background: "#FFFFFF",
  foreground: "#0F2533",
  cursor: "#0F2533",
  cursorAccent: "#FFFFFF",
  selectionBackground: "#BBD3E3",
  black: "#0F2533",
  red: "#B42318",
  green: "#166534",
  yellow: "#92400E",
  blue: "#1D4ED8",
  magenta: "#86198F",
  cyan: "#0E7490",
  white: "#9DB0BD",
  brightBlack: "#5B7A8E",
  brightRed: "#D92D20",
  brightGreen: "#15803D",
  brightYellow: "#B45309",
  brightBlue: "#2563EB",
  brightMagenta: "#A21CAF",
  brightCyan: "#0891B2",
  brightWhite: "#C9D6DF",
};

export function ChatPanel({ width, label, fontFamily, fontSize, connectionKey, onTerminal, onCollapse }: ChatPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "finding" });
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wantedRef = useRef<Size>(FALLBACK_SIZE);
  const resizeTimer = useRef<number | undefined>(undefined);
  const lastUserInput = useRef(0);
  const fontRef = useRef({ fontFamily, fontSize });
  fontRef.current = { fontFamily, fontSize };

  const measure = useCallback((): Size | null => {
    const dims = fitRef.current?.proposeDimensions();
    return dims && Number.isFinite(dims.cols) && Number.isFinite(dims.rows) ? dims : null;
  }, []);

  const syncSize = useCallback(() => {
    const term = xtermRef.current;
    const size = measure();
    if (!term || !size) return;
    const wanted = wantedRef.current;
    if (size.cols === wanted.cols && size.rows === wanted.rows) return;
    wantedRef.current = size;
    term.resize(size.cols, size.rows);
    window.clearTimeout(resizeTimer.current);
    resizeTimer.current = window.setTimeout(() => void api.resizeChat(size).catch(() => undefined), RESIZE_DEBOUNCE_MS);
  }, [measure]);

  const takeSize = useCallback(() => {
    const term = xtermRef.current;
    const wanted = wantedRef.current;
    if (!term || (term.cols === wanted.cols && term.rows === wanted.rows)) return;
    window.clearTimeout(resizeTimer.current);
    term.resize(wanted.cols, wanted.rows);
    void api.resizeChat(wanted).catch(() => undefined);
  }, []);

  const followCursor = useCallback(() => {
    const term = xtermRef.current;
    const scroll = scrollRef.current;
    const screen = hostRef.current?.querySelector<HTMLElement>(".xterm-screen");
    if (!term || !scroll || !screen || (scroll.scrollWidth <= scroll.clientWidth && scroll.scrollHeight <= scroll.clientHeight)) return;
    const rowHeight = screen.offsetHeight / term.rows;
    const cursorTop = screen.offsetTop + term.buffer.active.cursorY * rowHeight;
    if (cursorTop < scroll.scrollTop || cursorTop + rowHeight > scroll.scrollTop + scroll.clientHeight) {
      scroll.scrollTop = Math.max(0, cursorTop - scroll.clientHeight + rowHeight * 3);
    }
    const colWidth = screen.offsetWidth / term.cols;
    const cursorLeft = screen.offsetLeft + term.buffer.active.cursorX * colWidth;
    if (cursorLeft < scroll.scrollLeft || cursorLeft + colWidth > scroll.scrollLeft + scroll.clientWidth) {
      scroll.scrollLeft = Math.max(0, cursorLeft - scroll.clientWidth + colWidth * 8);
    }
  }, []);

  const disposeTerminal = useCallback(() => {
    window.clearTimeout(resizeTimer.current);
    xtermRef.current?.dispose();
    xtermRef.current = null;
    fitRef.current = null;
  }, []);

  const pick = useCallback(async (reason: string) => {
    setPhase({ kind: "picking", terminals: null, error: null, reason });
    try {
      const terminals = await api.listTerminals();
      setPhase({ kind: "picking", terminals, error: null, reason });
    } catch (e) {
      setPhase({ kind: "picking", terminals: [], error: errorText(e), reason });
    }
  }, []);

  const attach = useCallback(
    async (terminal: Terminal) => {
      disposeTerminal();
      const host = hostRef.current;
      if (!host) return;
      const term = new XTerm({
        ...fontRef.current,
        lineHeight: 1.15,
        scrollback: 0,
        cursorBlink: true,
        allowProposedApi: true,
        theme: LIGHT_THEME,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
      xtermRef.current = term;
      fitRef.current = fitAddon;
      host.replaceChildren();
      term.open(host);
      term.attachCustomWheelEventHandler(() => false);
      term.onData((data) => {
        if (performance.now() - lastUserInput.current < USER_INPUT_WINDOW_MS) takeSize();
        void api.chatInput(data).catch(() => undefined);
      });
      const size = measure() ?? FALLBACK_SIZE;
      wantedRef.current = size;
      term.resize(size.cols, size.rows);
      try {
        await api.attachChat(
          terminal.address,
          size,
          (bytes) => term.write(bytes, followCursor),
          (next) => {
            term.resize(next.cols, next.rows);
            followCursor();
          },
        );
        if (xtermRef.current !== term) return;
        term.focus();
        setPhase({ kind: "attached", terminal });
        onTerminal(terminal);
      } catch (e) {
        disposeTerminal();
        setPhase({ kind: "failed", error: errorText(e) });
        onTerminal(null);
      }
    },
    [disposeTerminal, measure, takeSize, followCursor, onTerminal],
  );

  const find = useCallback(async () => {
    setPhase({ kind: "finding" });
    onTerminal(null);
    try {
      const found = await api.findChatTerminal();
      if (found) await attach(found);
      else await pick(`No terminal carries the label ${label}.`);
    } catch (e) {
      setPhase({ kind: "failed", error: errorText(e) });
    }
  }, [attach, label, onTerminal, pick]);

  useEffect(() => {
    void find();
    return () => {
      void api.detachChat();
      disposeTerminal();
    };
  }, [find, connectionKey, disposeTerminal]);

  useEffect(() => {
    const unlisten = [
      events.chatEnded((terminal) => {
        if (phase.kind === "attached" && terminal === phase.terminal.address) {
          setPhase({ kind: "ended", terminal: phase.terminal });
          onTerminal(null);
        }
      }),
      events.terminals(() => {
        if (phase.kind === "picking") void pick(phase.reason);
      }),
    ];
    return () => unlisten.forEach((p) => void p.then((fn) => fn()));
  }, [phase, pick, onTerminal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mark = () => {
      lastUserInput.current = performance.now();
    };
    USER_INPUT_EVENTS.forEach((type) => host.addEventListener(type, mark, true));
    return () => USER_INPUT_EVENTS.forEach((type) => host.removeEventListener(type, mark, true));
  }, []);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => syncSize());
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [syncSize]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    const frame = requestAnimationFrame(syncSize);
    return () => cancelAnimationFrame(frame);
  }, [fontFamily, fontSize, syncSize]);

  const attachedName = phase.kind === "attached" || phase.kind === "ended" ? phase.terminal.name || phase.terminal.address : null;

  return (
    <aside className="chat" style={{ width }} aria-label="Firstmate chat">
      <div className="chat-head">
        <span className="chat-title">Firstmate</span>
        {attachedName && <span className="terminal-chip">{attachedName}</span>}
        <span className="spacer" />
        {(phase.kind === "attached" || phase.kind === "ended") && (
          <button className="mini" onClick={() => void pick("Choose the terminal to show here.")}>
            Change
          </button>
        )}
        <button className="ico" onClick={onCollapse} aria-label="Collapse chat" title="Collapse chat">
          <ChevronRight />
        </button>
      </div>
      <div className="chat-body">
        <div
          ref={scrollRef}
          className={`terminal-scroll${phase.kind === "attached" || phase.kind === "ended" ? "" : " hidden"}`}
          onClick={() => xtermRef.current?.focus()}
        >
          <div ref={hostRef} className="terminal-host" />
        </div>
        {phase.kind === "finding" && <p className="chat-status">Looking for Firstmate's terminal ({label})…</p>}
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
            <span className="sech">Pick a herdr-core terminal</span>
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
    </aside>
  );
}
