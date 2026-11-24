import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LauncherFolders, ShellTab, Terminal } from "./api";
import { ShellNotice, type ShellPhase } from "./components/ShellPane";
import { ChatRail, TabStrip } from "./components/TabStrip";
import { LauncherMenu } from "./components/TerminalLauncher";
import { FIXTURE_ATTACHABLE, FIXTURE_HOME, FIXTURE_SHELL_TABS } from "./preview/fixture";
import { CHAT_TAB } from "./terminalTabs";

const ignore = () => undefined;
const TABS = FIXTURE_SHELL_TABS.slice(0, 3);

function strip(active: string, tabs: ShellTab[] = TABS) {
  return renderToStaticMarkup(
    createElement(TabStrip, {
      title: "Firstmate",
      chip: "t1",
      canChange: true,
      tabs,
      active,
      launcherOpen: false,
      shortcut: "⌘T",
      hideTitle: "Hide chat (⌘B)",
      stripRef: { current: null },
      onActivate: ignore,
      onCloseTab: ignore,
      onLauncher: ignore,
      onChange: ignore,
      onCollapse: ignore,
    }),
  );
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const order = (html: string, needles: string[]) => needles.map((n) => html.indexOf(n));

describe("tab strip", () => {
  it("shows the chat, each shell, the + and the hide chevron in order", () => {
    const html = strip(CHAT_TAB);
    const at = order(html, ['data-tab="chat"', ...TABS.map((t) => `data-tab="${t.terminal}"`), 'aria-label="Open a terminal"', 'aria-label="Hide chat"']);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("names the hide chevron with its shortcut", () => {
    expect(strip(CHAT_TAB)).toContain('aria-label="Hide chat" title="Hide chat (⌘B)"');
  });

  it("gives every shell a close button but not the chat", () => {
    const html = strip(CHAT_TAB);
    expect(html.match(/class="tab-close"/g)).toHaveLength(TABS.length);
    for (const t of TABS) expect(html).toContain(`aria-label="Close ${t.name}"`);
    expect(html).not.toContain('aria-label="Close Firstmate"');
  });

  it("shows the terminal chip and Change only while the chat tab is active", () => {
    const chat = strip(CHAT_TAB);
    expect(chat).toContain("terminal-chip");
    expect(textOf(chat)).toContain("Change");
    const shell = strip(TABS[1].terminal);
    expect(shell).not.toContain("terminal-chip");
    expect(textOf(shell)).not.toContain("Change");
  });

  it("marks only the active tab", () => {
    const html = strip(TABS[1].terminal);
    expect(html.match(/class="tab on"/g)).toHaveLength(1);
    expect(html).toContain(`class="tab on" data-part="tab" data-state="active" data-key="${TABS[1].terminal}" data-tab="${TABS[1].terminal}"`);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  it("names the shortcut on the + button", () => {
    expect(strip(CHAT_TAB)).toContain('title="Open a terminal (⌘T)"');
  });
});

describe("hidden panel rail", () => {
  it("shows the active tab name", () => {
    const html = renderToStaticMarkup(createElement(ChatRail, { name: "zsh · atlas-api", title: "Show chat (⌘B)", onOpen: ignore }));
    expect(html).toContain('<span class="vname" data-part="chat-rail-name">zsh · atlas-api</span>');
    expect(html).toContain('aria-label="Show chat: zsh · atlas-api"');
    expect(html).toContain('title="Show chat (⌘B)"');
  });
});

function notice(phase: ShellPhase) {
  return renderToStaticMarkup(createElement(ShellNotice, { name: "zsh · ~", phase, onReattach: ignore, onClose: ignore }));
}

describe("shell tab states", () => {
  it("offers Reattach and Close tab once the shell has ended", () => {
    const text = textOf(notice({ kind: "ended" }));
    expect(text).toContain("Detached from zsh · ~.");
    expect(text).toContain("Reattach");
    expect(text).toContain("Close tab");
  });

  it("says the terminal is gone when Reattach finds nothing", () => {
    const text = textOf(notice({ kind: "gone" }));
    expect(text).toContain("zsh · ~ is gone");
    expect(text).not.toContain("Reattach");
    expect(text).toContain("Close tab");
  });

  it("shows nothing over a live shell", () => {
    expect(notice({ kind: "attached" })).toBe("");
  });
});

const FOLDERS: LauncherFolders = {
  home: FIXTURE_HOME,
  projects: [
    { column: 1, name: "atlas-api", path: `${FIXTURE_HOME}/projects/atlas-api` },
    { column: 2, name: "Ideas", path: null },
  ],
};

function menu(terminals: Terminal[] | null, shortcut = "⌘T", busy: string | null = null) {
  return renderToStaticMarkup(
    createElement(LauncherMenu, {
      folders: FOLDERS,
      folderError: null,
      terminals,
      terminalError: null,
      busy,
      error: null,
      shortcut,
      onProject: ignore,
      onHome: ignore,
      onOther: ignore,
      onAttach: ignore,
    }),
  );
}

describe("launcher menu", () => {
  it("lists project folders, then Home, then Other folder", () => {
    const text = textOf(menu(FIXTURE_ATTACHABLE));
    const at = order(text, ["Open a terminal in", "atlas-api ~/projects/atlas-api", "Ideas Choose folder…", "Home ~", "Other folder…", "Or attach a running terminal"]);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("lists running terminals by name, address and folder", () => {
    const text = textOf(menu(FIXTURE_ATTACHABLE));
    expect(text).toContain("codex t14 · ~/projects/keel-cli");
    expect(text).toContain("zsh t2 · ~");
  });

  it("says when there is nothing to attach", () => {
    expect(textOf(menu([]))).toContain("No other terminals are running.");
  });

  it("shows the platform's shortcut in the footer", () => {
    expect(textOf(menu([]))).toContain("⌘T opens this from anywhere");
    expect(textOf(menu([], "Ctrl+Shift+T"))).toContain("Ctrl+Shift+T opens this from anywhere");
  });

  it("disables every item while one is opening", () => {
    const html = menu([], "⌘T", "home");
    expect(textOf(html)).toContain("Home Opening…");
    expect(html.match(/<button[^>]*disabled/g)?.length).toBe(4);
  });
});
