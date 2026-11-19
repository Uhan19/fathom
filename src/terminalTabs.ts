import type { ShellTab, Terminal, View } from "./api";

export const CHAT_TAB = "chat";
export const LAUNCHER_WIDTH = 360;
const LAUNCHER_MARGIN = 8;
const HOME = "~";

type ShortcutKey = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export const shellView = (terminal: string): View => `shell:${terminal}`;

export function launcherShortcutLabel(mac: boolean): string {
  return mac ? "⌘T" : "Ctrl+Shift+T";
}

export function isLauncherShortcut(e: ShortcutKey, mac: boolean): boolean {
  const isT = e.code === "KeyT" || e.key.toLowerCase() === "t";
  const modifier = mac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey;
  return isT && modifier && !e.altKey;
}

export function tabStep(e: ShortcutKey): -1 | 0 | 1 {
  if (e.key !== "Tab" || !e.ctrlKey || e.metaKey || e.altKey) return 0;
  return e.shiftKey ? -1 : 1;
}

export interface TabKeyActions {
  openLauncher: () => void;
  cycle: (step: -1 | 1) => void;
}

export function tabKeyHandler(mac: boolean, actions: TabKeyActions) {
  return (e: ShortcutKey & Pick<KeyboardEvent, "preventDefault" | "stopPropagation">) => {
    const step = tabStep(e);
    const launch = isLauncherShortcut(e, mac);
    if (!launch && step === 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (launch) actions.openLauncher();
    else actions.cycle(step as -1 | 1);
  };
}

export function listenForTabKeys(target: Pick<Window, "addEventListener" | "removeEventListener">, mac: boolean, actions: TabKeyActions) {
  const handler = tabKeyHandler(mac, actions);
  target.addEventListener("keydown", handler, true);
  return () => target.removeEventListener("keydown", handler, true);
}

export const tabKeys = (tabs: ShellTab[]): string[] => [CHAT_TAB, ...tabs.map((tab) => tab.terminal)];

export function cycleTab(keys: string[], active: string, step: -1 | 1): string {
  const at = Math.max(0, keys.indexOf(active));
  return keys[(at + step + keys.length) % keys.length];
}

export function withTab(tabs: ShellTab[], tab: ShellTab): ShellTab[] {
  return tabs.some((t) => t.terminal === tab.terminal) ? tabs.map((t) => (t.terminal === tab.terminal ? tab : t)) : [...tabs, tab];
}

export function closeTab(tabs: ShellTab[], active: string, terminal: string): { tabs: ShellTab[]; active: string } {
  const at = tabs.findIndex((t) => t.terminal === terminal);
  const rest = tabs.filter((t) => t.terminal !== terminal);
  if (active !== terminal) return { tabs: rest, active };
  const next = rest[at] ?? rest[at - 1];
  return { tabs: rest, active: next ? next.terminal : CHAT_TAB };
}

export function attachChoices(terminals: Terminal[], tabs: ShellTab[], chatTerminal: string | null): Terminal[] {
  const open = new Set(tabs.map((t) => t.terminal));
  return terminals.filter((t) => !open.has(t.address) && t.address !== chatTerminal);
}

export const attachName = (terminal: Terminal): string => terminal.agent || terminal.name || terminal.address;

export function shortPath(path: string, home: string): string {
  if (!home) return path;
  if (path === home) return HOME;
  return path.startsWith(`${home}/`) ? HOME + path.slice(home.length) : path;
}

export function launcherLeft(anchorLeft: number, panelWidth: number): number {
  return Math.max(LAUNCHER_MARGIN, Math.min(anchorLeft, panelWidth - LAUNCHER_WIDTH - LAUNCHER_MARGIN));
}

export function revealTab(strip: HTMLElement, tab: HTMLElement) {
  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  if (left < strip.scrollLeft) strip.scrollLeft = left;
  else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
}

type Scrollable = Pick<HTMLElement, "scrollLeft" | "scrollWidth" | "clientWidth">;

export function stripEdges(strip: Scrollable): { left: boolean; right: boolean } {
  const hidden = strip.scrollWidth - strip.clientWidth;
  return { left: strip.scrollLeft > 1, right: strip.scrollLeft < hidden - 1 };
}

export function stripClass(edges: { left: boolean; right: boolean }): string {
  return ["tab-strip", edges.left && "more-left", edges.right && "more-right"].filter(Boolean).join(" ");
}
