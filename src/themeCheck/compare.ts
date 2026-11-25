import type { Theme as Mode } from "../theme";
import type { ControlScan, ControlState, ViewScan } from "./scan";

export interface Finding {
  problem: string;
  control?: string;
  part?: string;
  view?: string;
  mode?: Mode;
  size?: string;
  screenshot?: string;
}

export interface Allowances {
  singleMode: boolean;
  lanes: boolean;
  overlay: boolean;
  helper: string;
}

export interface Where {
  mode: Mode;
  size: string;
}

export const BUILT_IN_HELPER = "Bosun";
export const MIN_CONTRAST = 3;
const INK_SEEN = 1.5;
const INK_GONE = 1.15;
const ROUNDING = 0.01;

const DECLARED_ABSENCES: [keyof Pick<Allowances, "singleMode" | "lanes" | "overlay">, string][] = [
  ["singleMode", "toggle-dark-mode"],
  ["lanes", "column-resize"],
  ["overlay", "resize-card-panel"],
];

const PROBLEMS: Record<Exclude<ControlState, "ok">, string> = {
  hidden: "is hidden: it has no size, display: none or visibility: hidden",
  tiny: "is smaller than 4 pixels",
  faint: "is almost transparent: its opacity is below 0.3",
  offscreen: "cannot be scrolled into view",
  covered: "is covered by another element, so a click does not reach it",
  unlabelled: "has no accessible name",
};

const normal = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

export function expectedLabel(baseline: string, helper: string): string {
  return baseline.replace(new RegExp(BUILT_IN_HELPER, "gi"), helper);
}

function declaredAbsent(control: string, allow: Allowances): boolean {
  return DECLARED_ABSENCES.some(([option, id]) => allow[option] && control === id);
}

const inkLost = (before: number | undefined, after: number | undefined) =>
  before !== undefined && after !== undefined && before >= INK_SEEN && after < INK_GONE;

function controlFinding(base: ControlScan, themed: ControlScan | undefined, allow: Allowances): string | null {
  if (!themed) return declaredAbsent(base.control, allow) ? null : "is missing";
  if (themed.state === "ok" && inkLost(base.ink, themed.ink)) return "is painted over: nothing in its box shows, so something covers it";
  if (themed.state === "covered" && themed.cover) return `is covered by ${themed.cover}, so a click does not reach it`;
  if (themed.state !== "ok") return PROBLEMS[themed.state];
  const wanted = normal(expectedLabel(base.text, allow.helper));
  if (wanted && !normal(themed.text).includes(wanted)) return `no longer shows its label "${expectedLabel(base.text, allow.helper)}"; it reads "${themed.text}"`;
  return null;
}

export function compareView(baseline: ViewScan, themed: ViewScan, allow: Allowances, where: Where): Finding[] {
  const place = { view: themed.view, mode: where.mode, size: where.size };
  const found = new Map(themed.controls.map((c) => [c.key, c]));
  const findings: Finding[] = [];
  for (const base of baseline.controls) {
    if (base.state !== "ok") continue;
    const problem = controlFinding(base, found.get(base.key), allow);
    if (problem) findings.push({ ...place, control: base.control, problem: `${base.name || base.control} ${problem}` });
  }
  const nautical = new Map(baseline.texts.map((t) => [t.key, t]));
  for (const text of themed.texts) {
    const words = text.key.slice(text.part.length + 1);
    if (text.unreadable) {
      findings.push({ ...place, part: text.part, problem: `the text "${words}" has the color ${text.unreadable}, which the check cannot read; use an sRGB color` });
      continue;
    }
    const base = nautical.get(text.key);
    if (inkLost(base?.ink, text.ink)) {
      findings.push({ ...place, part: text.part, problem: `the text "${words}" does not show: none of its letters are painted` });
      continue;
    }
    if (text.ratio === undefined) continue;
    const needed = Math.min(MIN_CONTRAST, base?.ratio ?? MIN_CONTRAST);
    if (text.ratio + ROUNDING >= needed) continue;
    findings.push({ ...place, part: text.part, problem: `the text "${words}" has a contrast of ${text.ratio}:1, below ${Math.round(needed * 100) / 100}:1` });
  }
  for (const missing of baseline.missingIds) {
    findings.push({ ...place, problem: `Fathom bug: the control ${missing} has no data-control id` });
  }
  return findings;
}
