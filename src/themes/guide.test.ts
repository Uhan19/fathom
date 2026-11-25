import { readFileSync } from "node:fs";
import { parse } from "postcss";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { ROW_ORDER, type RowKey, type Settings } from "../api";
import { Board } from "../components/Board";
import { BosunDrawer } from "../components/BosunDrawer";
import { CardDetail } from "../components/CardDetail";
import { ChatPanel } from "../components/ChatPanel";
import { SettingsDialog } from "../components/SettingsDialog";
import { NO_LINKING } from "../links";
import { FIXTURE_COLUMNS, FIXTURE_CARDS, FIXTURE_REQUESTS, FIXTURE_TERMINALS, FIXTURE_WAITS, FIXTURE_WORKERS, fixtureMemory, fixtureUpdates } from "../preview/fixture";
import { badgesByTask } from "../memory";
import { defaultShortcuts } from "../shortcuts";
import { LookContext } from "./context";
import { lookOf, NAUTICAL_LOOK } from "./look";

const GUIDE = readFileSync(new URL("../../docs/themes.md", import.meta.url), "utf8");
const STYLES = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const ignore = () => undefined;
const reject = () => Promise.reject(new Error("not in this test"));
const rowNames = Object.fromEntries(ROW_ORDER.map((row) => [row, row])) as Record<RowKey, string>;
const workers = Object.fromEntries(FIXTURE_WORKERS.map((w) => [w.taskId, w]));
const columns = FIXTURE_COLUMNS.map((c, i) => (i === 1 ? { ...c, collapsed: true } : c));
const lanes = lookOf({ id: "lanes", version: "1", base: "/t/", manifest: { fathomTheme: 1, name: "Lanes", layout: { board: "lanes", detail: "overlay" } } });

const settings: Settings = {
  home: "/home/demo/firstmate",
  terminalLabel: "",
  hcSession: "",
  hcSocket: "",
  chatFont: "sf-mono",
  chatFontSize: 13,
  boardFont: "default",
  boardFontSize: 14,
  chatAddedFonts: [],
  boardAddedFonts: [],
  agentFolder: "/home/demo",
  chatAgent: null,
  theme: "light",
  themeId: "nautical",
  chatOpen: true,
  chatWidth: 600,
  detailWidth: 460,
  projectFilter: [],
  agentFilter: "all",
  focus: [],
  helperStarted: true,
  shortcuts: defaultShortcuts(true),
  linearWorkspace: "reef-co",
  ticketPrefixes: ["ATL"],
  memoryBadgeMb: 1024,
};

const board = (collapsedRows: RowKey[]) =>
  createElement(Board, {
    cards: FIXTURE_CARDS,
    source: "firstmate",
    columns,
    overlay: { places: [], requests: FIXTURE_REQUESTS },
    waits: FIXTURE_WAITS.tasks,
    workers,
    memory: badgesByTask(fixtureMemory(FIXTURE_WORKERS), 1024),
    updates: fixtureUpdates(true),
    rowNames,
    collapsedRows,
    agentFilter: "all",
    focus: [],
    projectsFiltered: false,
    selectedId: FIXTURE_CARDS[0].id,
    onSelect: ignore,
    onColumnChange: ignore,
    onRowCollapse: ignore,
    onShowEveryCard: ignore,
    onClearFocus: ignore,
    onColumnRename: ignore,
    onColumnMove: ignore,
    onColumnAdd: ignore,
    onColumnDelete: reject,
    onPlace: ignore,
    onWatch: ignore,
  });

const VIEWS: ReactElement[] = [
  createElement(App),
  board(["landed"]),
  createElement(CardDetail, {
    card: FIXTURE_CARDS[2],
    source: "firstmate",
    rowNames,
    request: null,
    waits: [],
    people: {},
    width: 460,
    chatTerminal: FIXTURE_TERMINALS[0],
    worker: FIXTURE_WORKERS[0],
    fontFamily: "monospace",
    fontSize: 13,
    theme: "light",
    linking: NO_LINKING,
    mark: "",
    onClose: ignore,
    onOpenCard: ignore,
    onResend: ignore,
    onDismiss: ignore,
  }),
  createElement(BosunDrawer, {
    open: true,
    height: 330,
    helper: { terminal: null, status: "", asking: false },
    helperStarted: false,
    mac: true,
    shortcut: "⌘J",
    fontFamily: "monospace",
    fontSize: 13,
    theme: "light",
    connectionKey: "",
    onHeight: ignore,
    onToggle: ignore,
  }),
  createElement(ChatPanel, {
    width: 600,
    label: "firstmate.role=primary",
    source: "firstmate",
    agent: "firstmate",
    agentFolder: "/home/demo",
    onAgent: ignore,
    fontFamily: "monospace",
    fontSize: 13,
    theme: "light",
    connectionKey: "",
    mac: true,
    hideTitle: "Hide chat",
    open: true,
    onTerminal: ignore,
    onActiveTab: ignore,
    onShow: ignore,
    onCollapse: ignore,
  }),
  createElement(SettingsDialog, {
    settings,
    mac: true,
    rowNames,
    look: NAUTICAL_LOOK,
    onPreview: ignore,
    onPreviewTheme: ignore,
    onSaved: ignore,
    onClose: ignore,
  }),
];

const rendered = [
  ...VIEWS.map((view) => renderToStaticMarkup(view)),
  renderToStaticMarkup(createElement(LookContext.Provider, { value: lanes }, board([]))),
].join("\n");

const attributeValues = (name: string) => new Set([...rendered.matchAll(new RegExp(`${name}="([a-z0-9-]+)"`, "g"))].map((m) => m[1]));

function rootTokens(css: string): Set<string> {
  const names = new Set<string>();
  parse(css).walkRules((rule) => {
    if (!rule.selectors.every((s) => s.startsWith(":root"))) return;
    rule.each((node) => {
      if (node.type === "decl" && node.prop.startsWith("--")) names.add(node.prop);
    });
  });
  return names;
}

const listed = (heading: string): Set<string> => {
  const start = GUIDE.indexOf(`### ${heading}`);
  const open = GUIDE.indexOf("```text", start) + 7;
  return new Set(GUIDE.slice(open, GUIDE.indexOf("```", open)).split(/\s+/).filter(Boolean));
};

describe("the theme guide", () => {
  it("lists every named part the board, detail, helper, chat and Settings render", () => {
    const parts = attributeValues("data-part");
    expect(parts.size).toBeGreaterThan(60);
    expect([...parts].filter((p) => !listed("Part names").has(p))).toEqual([]);
  });

  it("lists every control id they render", () => {
    const controls = attributeValues("data-control");
    expect(controls.size).toBeGreaterThan(25);
    expect([...controls].filter((c) => !listed("Control ids").has(c))).toEqual([]);
  });

  it("lists every token the app's root rules define", () => {
    const tokens = rootTokens(STYLES);
    expect(tokens.size).toBeGreaterThan(40);
    expect([...tokens].filter((t) => !listed("Token names").has(t))).toEqual([]);
  });
});
