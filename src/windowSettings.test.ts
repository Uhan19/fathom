import { describe, expect, it } from "vitest";
import type { Settings } from "./api";
import { defaultShortcuts } from "./shortcuts";
import { withLatestWindow } from "./windowSettings";

const settings = (over: Partial<Settings> = {}): Settings => ({
  home: "/home/demo/firstmate",
  terminalLabel: "",
  hcSession: "",
  hcSocket: "",
  chatFont: "JetBrains Mono",
  chatFontSize: 13,
  boardFont: "Inter",
  boardFontSize: 14,
  chatAddedFonts: [],
  boardAddedFonts: [],
  agentFolder: "",
  chatAgent: null,
  theme: "light",
  chatOpen: true,
  chatWidth: 600,
  detailWidth: 460,
  projectFilter: [],
  agentFilter: "all",
  helperStarted: false,
  shortcuts: defaultShortcuts(true),
  linearWorkspace: "",
  ticketPrefixes: [],
  ...over,
});

describe("withLatestWindow", () => {
  it("keeps what Bosun wrote while the settings dialog was open", () => {
    const opened = settings();
    const draft = { ...opened, chatFontSize: 15 };
    const latest = settings({ theme: "dark", projectFilter: ["keel-cli"], agentFilter: "withActiveAgent", chatOpen: false, chatWidth: 720, detailWidth: 500, helperStarted: true });
    expect(withLatestWindow(draft, latest)).toEqual({ ...latest, chatFontSize: 15 });
  });

  it("keeps the dialog's own fields over the latest ones", () => {
    const latest = settings({ boardFont: "Saira", theme: "dark" });
    const draft = settings({ boardFont: "Inter", home: "/home/demo/other", shortcuts: { ...defaultShortcuts(true), toggleChat: "" } });
    const saved = withLatestWindow(draft, latest);
    expect(saved.boardFont).toBe("Inter");
    expect(saved.shortcuts.toggleChat).toBe("");
    expect(saved.home).toBe("/home/demo/other");
    expect(saved.theme).toBe("dark");
  });
});
