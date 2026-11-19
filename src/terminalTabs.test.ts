import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ShellTab, Terminal } from "./api";
import {
  attachChoices,
  attachName,
  CHAT_TAB,
  closeTab,
  cycleTab,
  isLauncherShortcut,
  launcherLeft,
  launcherShortcutLabel,
  listenForTabKeys,
  shortPath,
  stripClass,
  stripEdges,
  tabKeys,
  withTab,
} from "./terminalTabs";

const tab = (terminal: string, name = `zsh · ${terminal}`): ShellTab => ({ terminal, name, folder: `/home/demo/${terminal}` });
const terminal = (address: string, agent = "", name = ""): Terminal => ({
  address,
  name,
  title: "",
  state: "idle",
  cwd: "/home/demo/projects/atlas-api",
  agent,
  labels: {},
  cols: 80,
  rows: 24,
});

const key = (init: Partial<KeyboardEvent>) => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

const T = { key: "t", code: "KeyT" };

describe("launcher shortcut", () => {
  it("is Cmd+T on macOS", () => {
    expect(isLauncherShortcut(key({ ...T, metaKey: true }), true)).toBe(true);
    expect(isLauncherShortcut(key({ ...T, metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isLauncherShortcut(key({ ...T, ctrlKey: true, shiftKey: true }), true)).toBe(false);
    expect(isLauncherShortcut(key({ ...T, metaKey: true, altKey: true }), true)).toBe(false);
  });

  it("is Ctrl+Shift+T on Linux", () => {
    expect(isLauncherShortcut(key({ key: "T", code: "KeyT", ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(isLauncherShortcut(key({ ...T, ctrlKey: true }), false)).toBe(false);
    expect(isLauncherShortcut(key({ ...T, metaKey: true }), false)).toBe(false);
  });

  it("matches the physical T key on other layouts", () => {
    expect(isLauncherShortcut(key({ key: "е", code: "KeyT", metaKey: true }), true)).toBe(true);
  });

  it("names the platform's real shortcut", () => {
    expect(launcherShortcutLabel(true)).toBe("⌘T");
    expect(launcherShortcutLabel(false)).toBe("Ctrl+Shift+T");
  });
});

type Listener = (e: ReturnType<typeof keyEvent>) => void;

function fakeWindow() {
  const listeners: { type: string; fn: Listener; capture: unknown }[] = [];
  return {
    listeners,
    addEventListener: (type: string, fn: Listener, capture?: unknown) => listeners.push({ type, fn, capture }),
    removeEventListener: (type: string, fn: Listener) => listeners.splice(listeners.findIndex((l) => l.type === type && l.fn === fn), 1),
  };
}

function keyEvent(init: Partial<KeyboardEvent>) {
  return { ...key(init), target: { className: "xterm-helper-textarea" }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

function press(platformMac: boolean, init: Partial<KeyboardEvent>) {
  const win = fakeWindow();
  const actions = { openLauncher: vi.fn(), cycle: vi.fn() };
  const unlisten = listenForTabKeys(win as unknown as Window, platformMac, actions);
  const event = keyEvent(init);
  win.listeners[0].fn(event);
  return { win, actions, event, unlisten };
}

describe("tab keys while a terminal has focus", () => {
  it("listen in the capture phase so xterm never sees them", () => {
    const { win, unlisten } = press(true, {});
    expect(win.listeners).toHaveLength(1);
    expect(win.listeners[0]).toMatchObject({ type: "keydown", capture: true });
    unlisten();
    expect(win.listeners).toHaveLength(0);
  });

  for (const [platform, mac, init] of [
    ["macOS", true, { ...T, metaKey: true }],
    ["Linux", false, { key: "T", code: "KeyT", ctrlKey: true, shiftKey: true }],
  ] as const) {
    it(`open the launcher on ${platform} and stop the key`, () => {
      const { actions, event } = press(mac, init);
      expect(actions.openLauncher).toHaveBeenCalledOnce();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it(`cycle with Ctrl+Tab and Ctrl+Shift+Tab on ${platform}`, () => {
      const next = press(mac, { key: "Tab", ctrlKey: true });
      expect(next.actions.cycle).toHaveBeenCalledWith(1);
      expect(next.event.stopPropagation).toHaveBeenCalled();
      const back = press(mac, { key: "Tab", ctrlKey: true, shiftKey: true });
      expect(back.actions.cycle).toHaveBeenCalledWith(-1);
    });
  }

  it("leave other keys to the terminal", () => {
    for (const init of [{ key: "Tab" }, { ...T, ctrlKey: true }, { key: "w", code: "KeyW", metaKey: true }, { key: "Tab", ctrlKey: true, metaKey: true }]) {
      const { actions, event } = press(true, init);
      expect(actions.openLauncher).not.toHaveBeenCalled();
      expect(actions.cycle).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
  });
});

describe("tabs", () => {
  const tabs = [tab("t11"), tab("t12"), tab("t13")];

  it("put the chat first, then shells in opening order", () => {
    expect(tabKeys(tabs)).toEqual([CHAT_TAB, "t11", "t12", "t13"]);
    expect(tabKeys(withTab(tabs, tab("t20")))).toEqual([CHAT_TAB, "t11", "t12", "t13", "t20"]);
    expect(withTab(tabs, tab("t12", "renamed")).map((t) => t.name)).toEqual(["zsh · t11", "renamed", "zsh · t13"]);
  });

  it("cycle through every tab including the chat and wrap", () => {
    const keys = tabKeys(tabs);
    expect(cycleTab(keys, CHAT_TAB, 1)).toBe("t11");
    expect(cycleTab(keys, "t13", 1)).toBe(CHAT_TAB);
    expect(cycleTab(keys, CHAT_TAB, -1)).toBe("t13");
  });

  it("move to the right neighbour, then the left, then the chat when the active tab closes", () => {
    expect(closeTab(tabs, "t12", "t12")).toEqual({ tabs: [tabs[0], tabs[2]], active: "t13" });
    expect(closeTab(tabs, "t13", "t13").active).toBe("t12");
    expect(closeTab([tabs[0]], "t11", "t11").active).toBe(CHAT_TAB);
    expect(closeTab(tabs, CHAT_TAB, "t12").active).toBe(CHAT_TAB);
  });

  it("offer a closed tab's shell again under attach because it keeps running", () => {
    const running = [terminal("t1"), terminal("t11"), terminal("t12"), terminal("t13")];
    expect(attachChoices(running, tabs, "t1")).toEqual([]);
    const { tabs: left } = closeTab(tabs, CHAT_TAB, "t12");
    expect(attachChoices(running, left, "t1").map((t) => t.address)).toEqual(["t12"]);
  });
});

describe("launcher", () => {
  it("leaves out the chat terminal and open tabs", () => {
    const running = [terminal("t1", "claude"), terminal("t2"), terminal("t11")];
    expect(attachChoices(running, [tab("t11")], "t1").map((t) => t.address)).toEqual(["t2"]);
    expect(attachChoices(running, [], null).map((t) => t.address)).toEqual(["t1", "t2", "t11"]);
  });

  it("names a running terminal by agent, then name, then address", () => {
    expect(attachName(terminal("t2", "codex", "work"))).toBe("codex");
    expect(attachName(terminal("t2", "", "work"))).toBe("work");
    expect(attachName(terminal("t2"))).toBe("t2");
  });

  it("shortens paths under home", () => {
    expect(shortPath("/home/demo", "/home/demo")).toBe("~");
    expect(shortPath("/home/demo/projects/a", "/home/demo")).toBe("~/projects/a");
    expect(shortPath("/home/demonstration", "/home/demo")).toBe("/home/demonstration");
    expect(shortPath("/srv/a", "")).toBe("/srv/a");
  });

  it("sits under the + and stays inside the panel", () => {
    expect(launcherLeft(100, 800)).toBe(100);
    expect(launcherLeft(700, 800)).toBe(800 - 360 - 8);
    expect(launcherLeft(-20, 300)).toBe(8);
  });
});

describe("tab strip overflow", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  it("scrolls sideways and never wraps", () => {
    const rule = css.match(/\.tab-strip \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/flex-wrap: nowrap/);
    expect(rule).toMatch(/overflow-x: auto/);
    expect(css.match(/\.tab \{[^}]*\}/)?.[0]).toMatch(/white-space: nowrap/);
  });

  it("fades the edges that have more tabs behind them", () => {
    expect(stripClass(stripEdges({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 }))).toBe("tab-strip");
    expect(stripClass(stripEdges({ scrollLeft: 0, scrollWidth: 900, clientWidth: 400 }))).toBe("tab-strip more-right");
    expect(stripClass(stripEdges({ scrollLeft: 250, scrollWidth: 900, clientWidth: 400 }))).toBe("tab-strip more-left more-right");
    expect(stripClass(stripEdges({ scrollLeft: 500, scrollWidth: 900, clientWidth: 400 }))).toBe("tab-strip more-left");
  });
});
