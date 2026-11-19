import { describe, expect, it } from "vitest";
import type { HelperStatus } from "./api";
import {
  DRAWER_HEIGHT,
  bosunState,
  clampDrawer,
  dotOf,
  hintOf,
  isMac,
  isToggleShortcut,
  shortcutLabel,
  summaryOf,
  type BosunPhase,
  type BosunState,
} from "./bosun";
import { FIXTURE_HELPER } from "./preview/fixture";

const terminal = FIXTURE_HELPER;
const running = (signIn: "signedIn" | "signedOut" | null = "signedIn"): BosunPhase => ({ kind: "running", terminal, signIn });
const helper = (over: Partial<HelperStatus> = {}): HelperStatus => ({ terminal: terminal.address, status: "idle", asking: false, ...over });
const NONE: HelperStatus = { terminal: null, status: "", asking: false };

const key = (over: Partial<KeyboardEvent>) => ({ key: "j", code: "KeyJ", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe("bosunState", () => {
  it("passes through every phase that is not running", () => {
    const phases: BosunPhase[] = [
      { kind: "finding" },
      { kind: "notStarted" },
      { kind: "dormant" },
      { kind: "starting" },
      { kind: "stopped", terminal },
      { kind: "missing" },
      { kind: "failed", error: "no server" },
    ];
    expect(phases.map((phase) => bosunState(phase, helper()))).toEqual(["finding", "notStarted", "dormant", "starting", "stopped", "missing", "failed"]);
  });

  it("reads ready, working and asking from the helper status", () => {
    expect(bosunState(running(), helper())).toBe("ready");
    expect(bosunState(running(), helper({ status: "working" }))).toBe("working");
    expect(bosunState(running(), helper({ asking: true }))).toBe("asking");
    expect(bosunState(running(), helper({ status: "working", asking: true }))).toBe("asking");
  });

  it("stays starting until the helper reports a status", () => {
    expect(bosunState(running(), helper({ status: "" }))).toBe("starting");
    expect(bosunState(running(), NONE)).toBe("starting");
  });

  it("ignores a status reported for another terminal", () => {
    expect(bosunState(running(), helper({ terminal: "t4", asking: true }))).toBe("starting");
  });

  it("shows signed out until Claude Code works or asks", () => {
    expect(bosunState(running("signedOut"), helper())).toBe("signedOut");
    expect(bosunState(running("signedOut"), helper({ status: "working" }))).toBe("working");
    expect(bosunState(running("signedOut"), helper({ asking: true }))).toBe("asking");
  });
});

describe("drawer copy", () => {
  const states: BosunState[] = ["finding", "notStarted", "dormant", "starting", "signedOut", "ready", "working", "asking", "stopped", "missing", "failed"];

  it("gives every state a dot and a summary", () => {
    for (const state of states) {
      expect(dotOf(state)).toBeTruthy();
      expect(summaryOf(state)).toBeTruthy();
    }
  });

  it("turns the dot yellow only while Claude Code asks", () => {
    expect(states.filter((state) => dotOf(state) === "asking")).toEqual(["asking"]);
    expect(dotOf("ready")).toBe("ready");
    expect(dotOf("missing")).toBe("problem");
    expect(dotOf("stopped")).toBe("off");
  });

  it("hints at the folder question, the sign-in and the permission question", () => {
    expect(hintOf("starting")).toMatch(/trust this folder/);
    expect(hintOf("signedOut")).toMatch(/sign/);
    expect(hintOf("asking")).toMatch(/asking/);
    expect(states.filter((state) => hintOf(state) !== null)).toEqual(["starting", "signedOut", "asking"]);
  });
});

describe("shortcut", () => {
  it("uses Command J on macOS", () => {
    expect(isMac("MacIntel")).toBe(true);
    expect(shortcutLabel(true)).toBe("⌘J");
    expect(isToggleShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isToggleShortcut(key({ ctrlKey: true }), true)).toBe(false);
  });

  it("uses Ctrl J on Linux", () => {
    expect(isMac("Linux x86_64")).toBe(false);
    expect(shortcutLabel(false)).toBe("Ctrl+J");
    expect(isToggleShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isToggleShortcut(key({ metaKey: true }), false)).toBe(false);
  });

  it("ignores other keys and extra modifiers", () => {
    expect(isToggleShortcut(key({ key: "k", code: "KeyK", metaKey: true }), true)).toBe(false);
    expect(isToggleShortcut(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isToggleShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isToggleShortcut(key({}), true)).toBe(false);
  });

  it("matches the J key on other keyboard layouts by its code", () => {
    expect(isToggleShortcut(key({ key: "∆", metaKey: true }), true)).toBe(true);
  });
});

describe("clampDrawer", () => {
  it("keeps the drawer between its smallest and largest height", () => {
    expect(clampDrawer(DRAWER_HEIGHT.initial)).toBe(330);
    expect(clampDrawer(20)).toBe(DRAWER_HEIGHT.min);
    expect(clampDrawer(5000)).toBe(DRAWER_HEIGHT.max);
  });
});
