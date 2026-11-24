import { describe, expect, it } from "vitest";
import { compareView, expectedLabel, type Allowances } from "./compare";
import type { ControlScan, ViewScan } from "./scan";

const control = (key: string, over: Partial<ControlScan> = {}): ControlScan => ({ key, control: key.split("@")[0], state: "ok", name: key, text: "", ...over });
const view = (controls: ControlScan[], lowContrast: ViewScan["lowContrast"] = []): ViewScan => ({ view: "board", controls, lowContrast, missingIds: [] });
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

  it("reports text that drops below 3:1 only where the built-in theme was readable", () => {
    const baseline = view([], [{ key: "card-note|Until 2026", part: "card-note", ratio: 2.5 }]);
    const themed = view([], [
      { key: "card-note|Until 2026", part: "card-note", ratio: 1.1 },
      { key: "phrase|Ship dark mode", part: "phrase", ratio: 1 },
    ]);
    expect(compareView(baseline, themed, NONE, WHERE)).toEqual([
      { view: "board", mode: "light", size: "desktop", part: "phrase", problem: 'the text "Ship dark mode" has a contrast of 1:1, below 3:1' },
    ]);
  });
});
