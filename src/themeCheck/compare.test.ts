import { describe, expect, it } from "vitest";
import { compareView, expectedLabel, type Allowances } from "./compare";
import type { ControlScan, ViewScan } from "./scan";

const control = (key: string, over: Partial<ControlScan> = {}): ControlScan => ({ key, control: key.split("@")[0], state: "ok", name: key, text: "", ...over });
const view = (controls: ControlScan[], texts: ViewScan["texts"] = []): ViewScan => ({ view: "board", controls, texts, missingIds: [] });
const NONE: Allowances = { singleMode: false, lanes: false, overlay: false, helper: "Bosun" };
const WHERE = { mode: "light" as const, size: "desktop" };

describe("compareView", () => {
  it("passes a theme that keeps every control usable", () => {
    const baseline = view([control("open-settings", { text: "Settings" }), control("card-open@id=atl-12")]);
    const themed = view([control("open-settings", { text: "[ settings ]" }), control("card-open@id=atl-12")]);
    expect(compareView(baseline, themed, NONE, WHERE)).toEqual([]);
  });

  it("reports a hidden, covered or relabelled control by its id", () => {
    const baseline = view([control("open-settings", { text: "Settings" }), control("row-toggle@row=deep"), control("resize-chat")]);
    const themed = view([control("open-settings", { text: "Gear" }), control("row-toggle@row=deep", { state: "covered" })]);
    const findings = compareView(baseline, themed, NONE, WHERE);
    expect(findings.map((f) => [f.control, f.problem])).toEqual([
      ["open-settings", 'open-settings no longer shows its label "Settings"; it reads "Gear"'],
      ["row-toggle", "row-toggle@row=deep is covered by another element, so a click does not reach it"],
      ["resize-chat", "resize-chat is missing"],
    ]);
    expect(findings[0]).toMatchObject({ view: "board", mode: "light", size: "desktop" });
  });

  it("lets only declared options remove a control", () => {
    const baseline = view([control("toggle-dark-mode"), control("column-resize@column=1"), control("resize-card-panel")]);
    const themed = view([]);
    expect(compareView(baseline, themed, NONE, WHERE)).toHaveLength(3);
    expect(compareView(baseline, themed, { ...NONE, singleMode: true, lanes: true, overlay: true }, WHERE)).toEqual([]);
  });

  it("ignores controls the built-in theme itself does not show", () => {
    const baseline = view([control("column-delete@column=1", { state: "faint" })]);
    expect(compareView(baseline, view([]), NONE, WHERE)).toEqual([]);
  });

  it("follows the helper's name in labels", () => {
    expect(expectedLabel("Open Bosun", "Sysop")).toBe("Open Sysop");
    expect(expectedLabel("BOSUN is ready", "Sysop")).toBe("Sysop is ready");
    const baseline = view([control("helper-open", { text: "Bosun Bosun is ready" })]);
    const themed = view([control("helper-open", { text: "SYSOP Sysop is ready" })]);
    expect(compareView(baseline, themed, { ...NONE, helper: "Sysop" }, WHERE)).toEqual([]);
  });

  it("never lets text get less readable than in Nautical, and holds readable text to 3:1", () => {
    const baseline = view([], [
      { key: "card-note|Until 2026", part: "card-note", ratio: 2.5 },
      { key: "phrase|Ship dark mode", part: "phrase", ratio: 12 },
      { key: "row-count|10", part: "row-count", ratio: 2.5 },
    ]);
    const themed = view([], [
      { key: "card-note|Until 2026", part: "card-note", ratio: 1.1 },
      { key: "phrase|Ship dark mode", part: "phrase", ratio: 2.9 },
      { key: "row-count|10", part: "row-count", ratio: 2.6 },
      { key: "brand-name|KELP", part: "brand-name", ratio: 4.5 },
    ]);
    expect(compareView(baseline, themed, NONE, WHERE)).toEqual([
      { view: "board", mode: "light", size: "desktop", part: "card-note", problem: 'the text "Until 2026" has a contrast of 1.1:1, below 2.5:1' },
      { view: "board", mode: "light", size: "desktop", part: "phrase", problem: 'the text "Ship dark mode" has a contrast of 2.9:1, below 3:1' },
    ]);
  });

  it("reports a control whose box no longer shows anything, as under an opaque layer that lets clicks through", () => {
    const baseline = view([control("open-settings", { ink: 9 }), control("column-resize@column=1", { ink: 1 })]);
    const themed = view([control("open-settings", { ink: 1.02 }), control("column-resize@column=1", { ink: 1 })]);
    expect(compareView(baseline, themed, NONE, WHERE).map((f) => f.control)).toEqual(["open-settings"]);
  });
});
