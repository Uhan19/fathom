import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, type Size, type View } from "./api";
import { TERMINAL_OPTIONS, terminalPalette } from "./terminalOptions";
import { symbolsFontReady } from "./terminalSymbols";
import type { Theme } from "./theme";
import { forwardClipboardWrites, isShiftEnter, shiftEnterSequence, trackKittyKeyboard } from "./terminalInput";

const FALLBACK_SIZE = { cols: 80, rows: 24 };
const RESIZE_DEBOUNCE_MS = 80;
const USER_INPUT_WINDOW_MS = 150;
const USER_INPUT_EVENTS = ["keydown", "paste", "compositionend"] as const;

function pagePalette() {
  const style = getComputedStyle(document.documentElement);
  return terminalPalette((name) => style.getPropertyValue(name));
}

function copyText(text: string) {
  void writeText(text).catch(() => undefined);
}

export function useLiveTerminal(view: View, fontFamily: string, fontSize: number, theme: Theme) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wantedRef = useRef<Size>(FALLBACK_SIZE);
  const resizeTimer = useRef<number | undefined>(undefined);
  const lastUserInput = useRef(0);
  const selecting = useRef(false);
  const fontRef = useRef({ fontFamily, fontSize });
  fontRef.current = { fontFamily, fontSize };

  const measure = useCallback((): Size | null => {
    if (!scrollRef.current?.getClientRects().length) return null;
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
    resizeTimer.current = window.setTimeout(() => void api.resizeTerminal(view, size).catch(() => undefined), RESIZE_DEBOUNCE_MS);
  }, [measure, view]);

  const takeSize = useCallback(() => {
    const term = xtermRef.current;
    const wanted = wantedRef.current;
    if (!term || (term.cols === wanted.cols && term.rows === wanted.rows)) return;
    window.clearTimeout(resizeTimer.current);
    term.resize(wanted.cols, wanted.rows);
    void api.resizeTerminal(view, wanted).catch(() => undefined);
  }, [view]);

  const sendInput = useCallback(
    (data: string) => {
      if (performance.now() - lastUserInput.current < USER_INPUT_WINDOW_MS) takeSize();
      void api.terminalInput(view, data).catch(() => undefined);
    },
    [takeSize, view],
  );

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

  const dispose = useCallback(() => {
    window.clearTimeout(resizeTimer.current);
    xtermRef.current?.dispose();
    xtermRef.current = null;
    fitRef.current = null;
  }, []);

  const attach = useCallback(
    async (address: string): Promise<boolean> => {
      await symbolsFontReady();
      dispose();
      const host = hostRef.current;
      if (!host) return false;
      const term = new XTerm({
        ...fontRef.current,
        ...TERMINAL_OPTIONS,
        theme: pagePalette(),
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
      xtermRef.current = term;
      fitRef.current = fitAddon;
      host.replaceChildren();
      term.open(host);
      const kitty = trackKittyKeyboard(term);
      forwardClipboardWrites(term, copyText);
      term.attachCustomKeyEventHandler((e) => {
        if (!isShiftEnter(e)) return true;
        if (e.type === "keydown") {
          e.preventDefault();
          sendInput(shiftEnterSequence(kitty.flags()));
        }
        return false;
      });
      term.onData(sendInput);
      const size = measure() ?? FALLBACK_SIZE;
      wantedRef.current = size;
      term.resize(size.cols, size.rows);
      try {
        await api.attachTerminal(
          view,
          address,
          size,
          (bytes) => term.write(bytes, followCursor),
          (next) => {
            term.resize(next.cols, next.rows);
            followCursor();
          },
        );
      } catch (e) {
        if (xtermRef.current === term) dispose();
        throw e;
      }
      return xtermRef.current === term;
    },
    [dispose, measure, sendInput, followCursor, view],
  );

  const release = useCallback(() => {
    void api.detachTerminal(view).catch(() => undefined);
    dispose();
  }, [dispose, view]);

  const focus = useCallback(() => xtermRef.current?.focus(), []);

  const paste = useCallback((text: string) => {
    const term = xtermRef.current;
    if (!term) return;
    lastUserInput.current = performance.now();
    term.paste(text);
    term.focus();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mark = () => {
      lastUserInput.current = performance.now();
    };
    USER_INPUT_EVENTS.forEach((type) => host.addEventListener(type, mark, true));
    return () => USER_INPUT_EVENTS.forEach((type) => host.removeEventListener(type, mark, true));
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const start = () => {
      selecting.current = true;
    };
    const finish = () => {
      if (!selecting.current) return;
      selecting.current = false;
      const term = xtermRef.current;
      if (term?.hasSelection()) copyText(term.getSelection());
    };
    host.addEventListener("mousedown", start, true);
    window.addEventListener("mouseup", finish);
    return () => {
      host.removeEventListener("mousedown", start, true);
      window.removeEventListener("mouseup", finish);
    };
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

  useEffect(() => {
    const term = xtermRef.current;
    if (term) term.options.theme = pagePalette();
  }, [theme]);

  return { hostRef, scrollRef, attach, release, focus, paste, fit: syncSize };
}
