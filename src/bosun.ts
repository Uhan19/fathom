import type { HelperStatus, SignIn, Terminal } from "./api";

export const BOSUN = "Bosun";
export const DRAWER_HEIGHT = { initial: 330, min: 160, max: 900 };
export const BOARD_ABOVE_DRAWER = 96;
export const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";
export const BREW_COMMAND = "brew install --cask claude-code";
export const EXAMPLE_REQUESTS = [
  "Show me only the harbor-web tasks",
  "Rename the keel-cli column to Keel",
  "Collapse every column except atlas-api",
  "Switch to dark mode",
];

export type BosunPhase =
  | { kind: "finding" }
  | { kind: "notStarted" }
  | { kind: "dormant" }
  | { kind: "starting" }
  | { kind: "running"; terminal: Terminal; signIn: SignIn | null }
  | { kind: "stopped"; terminal: Terminal }
  | { kind: "missing" }
  | { kind: "failed"; error: string };

export type BosunState =
  | "finding"
  | "notStarted"
  | "dormant"
  | "starting"
  | "signedOut"
  | "ready"
  | "working"
  | "asking"
  | "stopped"
  | "missing"
  | "failed";

export type Dot = "off" | "starting" | "ready" | "working" | "asking" | "problem";

export function bosunState(phase: BosunPhase, helper: HelperStatus): BosunState {
  if (phase.kind !== "running") return phase.kind;
  const reported = helper.terminal === phase.terminal.address;
  if (reported && helper.asking) return "asking";
  if (reported && helper.status === "working") return "working";
  if (phase.signIn === "signedOut") return "signedOut";
  if (reported && helper.status === "idle") return "ready";
  return "starting";
}

const DOTS: Record<BosunState, Dot> = {
  finding: "off",
  notStarted: "off",
  dormant: "off",
  stopped: "off",
  starting: "starting",
  signedOut: "starting",
  ready: "ready",
  working: "working",
  asking: "asking",
  missing: "problem",
  failed: "problem",
};

export const dotOf = (state: BosunState): Dot => DOTS[state];

const SUMMARIES: Record<BosunState, string> = {
  finding: "Looking for Bosun",
  notStarted: "Bosun has not started yet",
  dormant: "Bosun starts when you open it",
  starting: "Bosun is starting",
  signedOut: "Claude Code is signed out",
  ready: "Bosun is ready",
  working: "Bosun is working",
  asking: "Bosun is asking before a change",
  stopped: "Bosun stopped",
  missing: "Claude Code is not installed",
  failed: "Bosun could not start",
};

export const summaryOf = (state: BosunState): string => SUMMARIES[state];

const HINTS: Partial<Record<BosunState, string>> = {
  starting: "If Claude Code asks whether to trust this folder, press Enter: it holds only Bosun's settings.",
  signedOut: "Claude Code is signed out. Pick the subscription sign-in and finish in your browser.",
  asking: "Claude Code is asking before a change. Answer below.",
};

export const hintOf = (state: BosunState): string | null => HINTS[state] ?? null;

export function shortcutLabel(mac: boolean): string {
  return mac ? "⌘J" : "Ctrl+J";
}

export function isToggleShortcut(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, mac: boolean): boolean {
  const isJ = e.code === "KeyJ" || e.key.toLowerCase() === "j";
  const modifier = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return isJ && modifier && !e.altKey && !e.shiftKey;
}

export function isMac(platform: string): boolean {
  return /mac/i.test(platform);
}

export const drawerRoom = (columnHeight: number): number => columnHeight - BOARD_ABOVE_DRAWER;
