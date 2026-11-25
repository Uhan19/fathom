import { invoke } from "@tauri-apps/api/core";
import { defaultShortcuts, parseCombo } from "../shortcuts";
import type { Theme as Mode } from "../theme";
import type { ActiveTheme, ThemeManifest } from "../themes/contract";
import { resetShortcut } from "../themes/reset";
import { compareView, type Allowances, type Finding } from "./compare";
import {
  dragCard,
  edgeDragCard,
  overlayIsModal,
  reorderProjects,
  resetShortcutWorks,
  resizeChat,
  resizeDetail,
  resizeHelper,
  sideDetailClosesOnEscape,
  toggleMode,
  tolerateSyntheticPointers,
  type Frame,
  type Outcome,
} from "./interactions";
import { measurePaint, scanView, type Probe, type ViewName, type ViewScan } from "./scan";
import type { Pixels } from "./pixels";

type Size = "desktop" | "min";

interface Run {
  mode: Mode;
  size: Size;
  width: number;
  height: number;
}

interface Plan {
  job: "check" | "shot";
  theme: ActiveTheme;
  runs: Run[];
}

interface Report {
  findings: Finding[];
  shots: string[];
  incomplete?: boolean;
}

const APP_PAGE = "themecheck-app.html";
const READY_TIMEOUT_MS = 20000;
const POLL_MS = 50;
const SETTLE_MS = 300;
const OPEN_TIMEOUT_MS = 3000;
const AFTER_OPEN_MS = 50;
const QUIET_MS = 250;
const TERMINAL = '[data-part="terminal-host"]';
const FIXTURE_THEMES = "/fixtures/themes/";
const NAUTICAL = "nautical";
const MAC = navigator.platform.startsWith("Mac");

const inTauri = "__TAURI_INTERNALS__" in window;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const started = performance.now();

function log(text: string) {
  text = `${((performance.now() - started) / 1000).toFixed(1)}s ${text}`;
  if (inTauri) void invoke("check_log", { text });
  else console.info(text);
}

async function devPlan(): Promise<Plan> {
  const params = new URLSearchParams(location.search);
  const id = params.get("theme") ?? "phosphor";
  const base = `${FIXTURE_THEMES}${id}/`;
  const manifest = (await (await fetch(`${base}theme.json`)).json()) as ThemeManifest;
  const modes = (params.get("mode") ? [params.get("mode")] : (manifest.modes ?? ["light", "dark"])) as Mode[];
  const sizes = (params.get("size") ? [params.get("size")] : ["desktop"]) as Size[];
  const runs = modes.flatMap((mode) => sizes.map((size) => ({ mode, size, width: innerWidth, height: innerHeight })));
  return { job: params.get("job") === "shot" ? "shot" : "check", theme: { id, version: "dev", base, manifest }, runs };
}

function keysOf(combo: string): KeyboardEventInit {
  const parsed = parseCombo(combo);
  const flags = new Set(parsed?.modifiers ?? []);
  return { code: parsed?.code, key: parsed?.code.replace(/^(Key|Digit)/, "").toLowerCase(), ctrlKey: flags.has("Ctrl"), altKey: flags.has("Alt"), shiftKey: flags.has("Shift"), metaKey: flags.has("Meta") };
}

async function loadFrame(params: Record<string, string>): Promise<Frame> {
  document.querySelector("iframe")?.remove();
  const frame = document.createElement("iframe");
  frame.src = `${APP_PAGE}?${new URLSearchParams({ stress: "", tabs: "3", ...params })}`;
  document.body.append(frame);
  const started = Date.now();
  for (;;) {
    const doc = frame.contentDocument;
    const ready = doc?.querySelector('[data-part="board"], [data-part="board-empty"]:not(:empty)') && doc.documentElement.dataset.themeId && doc.querySelector('[data-part="chat"]');
    if (ready) break;
    if (Date.now() - started > READY_TIMEOUT_MS) throw new Error("the fixture board never finished loading");
    await wait(POLL_MS);
  }
  const win = frame.contentWindow as Frame["win"];
  await win.document.fonts.ready;
  tolerateSyntheticPointers(win);
  const loaded = { win, doc: win.document };
  await quiet(loaded, Date.now() + OPEN_TIMEOUT_MS);
  return loaded;
}

function quiet(frame: Frame, until: number): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0;
    const settle = () => {
      clearTimeout(timer);
      timer = window.setTimeout(done, QUIET_MS);
    };
    const observer = new frame.win.MutationObserver((records) => {
      if (records.some((r) => !(r.target instanceof frame.win.Element ? r.target : r.target.parentElement)?.closest(TERMINAL))) settle();
    });
    const deadline = window.setTimeout(() => done(), Math.max(0, until - Date.now()));
    function done() {
      clearTimeout(timer);
      clearTimeout(deadline);
      observer.disconnect();
      resolve();
    }
    observer.observe(frame.doc.body, { subtree: true, childList: true, attributes: true, characterData: true });
    settle();
  });
}

async function waitFor(frame: Frame, done: () => boolean) {
  const until = Date.now() + OPEN_TIMEOUT_MS;
  while (!done() && Date.now() < until) await wait(POLL_MS);
  await quiet(frame, until);
  await wait(AFTER_OPEN_MS);
}

const click = async (frame: Frame, selector: string, done?: string, gone?: string) => {
  frame.doc.querySelector<HTMLElement>(selector)?.click();
  await waitFor(frame, () => (done ? !!frame.doc.querySelector(done) : true) && (gone ? !frame.doc.querySelector(gone) : true));
};

const DETAIL = '[data-part="detail"]';
const DRAWER_OPEN = '[data-part="bosun"]:not([data-state~="closed"])';
const SETTINGS = '[data-part="settings-dialog"][open]';

const openCard = (frame: Frame) => click(frame, '[data-part="row"][data-kind="surface"] [data-control="card-open"]', DETAIL);

async function decodePixels(base64: string): Promise<Pixels> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, scale: bitmap.width / innerWidth, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

async function look(frame: Frame, view: ViewName, scope: Element): Promise<ViewScan> {
  const probe: Probe = { controls: new Map(), texts: new Map() };
  const scan = scanView(view, scope, frame.win, probe);
  if (!inTauri) return scan;
  const pixels = await decodePixels(await invoke<string>("check_pixels"));
  return measurePaint(scan, probe, pixels, frame.win);
}

async function scanAll(frame: Frame): Promise<ViewScan[]> {
  const { doc } = frame;
  const scans: ViewScan[] = [await look(frame, "board", doc.querySelector('[data-part="app"]')!)];
  await openCard(frame);
  const tabs = [...doc.querySelectorAll<HTMLElement>('[data-control="detail-tab"]')].map((t) => t.dataset.key ?? "");
  for (const tab of tabs) {
    await click(frame, `[data-control="detail-tab"][data-key="${tab}"]`, `[data-control="detail-tab"][data-key="${tab}"][aria-selected="true"]`);
    const detail = doc.querySelector('[data-part="detail"]');
    if (detail) scans.push(await look(frame, `detail:${tab}` as ViewName, detail));
  }
  await click(frame, '[data-control="close-detail"]', undefined, DETAIL);
  await click(frame, '[data-control="helper-open"]', DRAWER_OPEN);
  const drawer = doc.querySelector(DRAWER_OPEN);
  if (drawer) scans.push(await look(frame, "helper", drawer));
  await click(frame, '[data-control="helper-close"]', undefined, DRAWER_OPEN);
  await click(frame, '[data-control="open-settings"]', SETTINGS);
  const dialog = doc.querySelector(SETTINGS);
  if (dialog) scans.push(await look(frame, "settings", dialog));
  await click(frame, '[data-control="settings-cancel"]', undefined, SETTINGS);
  return scans;
}

async function scanEmpty(params: Record<string, string>): Promise<ViewScan> {
  const frame = await loadFrame({ ...params, empty: "" });
  return look(frame, "empty", frame.doc.querySelector('[data-part="app"]')!);
}

async function step<T>(name: string, work: Promise<T>): Promise<T> {
  const at = performance.now();
  const result = await work;
  log(`  ${name} took ${((performance.now() - at) / 1000).toFixed(1)}s`);
  return result;
}

async function interact(plan: Plan, run: Run, params: Record<string, string>): Promise<Outcome[]> {
  const layout = plan.theme.manifest.layout ?? {};
  const single = (plan.theme.manifest.modes ?? ["light", "dark"]).length === 1;
  const frame = await step("load", loadFrame(params));
  if (run.size === "min") return [await step("edge drag", edgeDragCard(frame))];
  const outcomes = [
    await step("drag", dragCard(frame)),
    ...(await step("reorder", reorderProjects(frame, layout.board === "lanes"))),
    await step("chat", resizeChat(frame, layout.chatSide === "left")),
  ];
  await openCard(frame);
  if (layout.detail === "overlay") outcomes.push(...(await overlayIsModal(frame, () => openCard(frame))));
  else {
    outcomes.push(await resizeDetail(frame));
    outcomes.push(await sideDetailClosesOnEscape(frame));
    await click(frame, '[data-control="close-detail"]', undefined, DETAIL);
  }
  await click(frame, '[data-control="helper-open"]', DRAWER_OPEN);
  outcomes.push(await resizeHelper(frame));
  await click(frame, '[data-control="helper-close"]', undefined, DRAWER_OPEN);
  outcomes.push(await toggleMode(frame, single, keysOf(defaultShortcuts(MAC).toggleTheme)));
  outcomes.push(await resetShortcutWorks(frame, keysOf(resetShortcut(MAC))));
  return outcomes;
}

async function snapshot(name: string): Promise<string | null> {
  if (!inTauri) return null;
  return invoke<string>("check_snapshot", { name });
}

function outline(frame: Frame, controls: string[]) {
  for (const control of controls) {
    for (const el of frame.doc.querySelectorAll(`[data-control="${control}"]`)) {
      const box = el.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      const mark = frame.doc.createElement("div");
      mark.dataset.checkOutline = "";
      Object.assign(mark.style, { position: "fixed", left: `${box.left - 3}px`, top: `${box.top - 3}px`, width: `${box.width + 6}px`, height: `${box.height + 6}px`, border: "3px solid red", zIndex: "2147483647", pointerEvents: "none" });
      frame.doc.body.append(mark);
    }
  }
}

async function showView(frame: Frame, view: string) {
  if (view.startsWith("detail")) {
    await openCard(frame);
    const tab = view.split(":")[1];
    if (tab) await click(frame, `[data-control="detail-tab"][data-key="${tab}"]`, `[data-control="detail-tab"][data-key="${tab}"][aria-selected="true"]`);
  } else if (view === "helper" || view === "chat") await click(frame, '[data-control="helper-open"]', DRAWER_OPEN);
  else if (view === "settings") await click(frame, '[data-control="open-settings"]', SETTINGS);
}

async function proveFindings(findings: Finding[], run: Run, params: Record<string, string>) {
  const views = [...new Set(findings.map((f) => f.view ?? "board"))];
  for (const view of views) {
    const frame = await loadFrame(view === "empty" ? { ...params, empty: "" } : params);
    await showView(frame, view.startsWith("interaction") ? "board" : view);
    const here = findings.filter((f) => (f.view ?? "board") === view);
    outline(frame, here.flatMap((f) => (f.control ? [f.control] : [])));
    const shot = await snapshot(`check/${run.mode}-${run.size}-${view.replace(/[^a-z0-9]+/g, "-")}`);
    if (shot) here.forEach((f) => (f.screenshot = shot));
  }
}

async function nauticalBaseline(run: Run, params: Record<string, string>): Promise<ViewScan[]> {
  const where = { mode: run.mode, size: run.size };
  const cached = inTauri ? await invoke<ViewScan[] | null>("check_baseline", where) : null;
  if (cached) return cached;
  log(`${run.mode} ${run.size}: scanning Nautical`);
  const scans = [...(await scanAll(await loadFrame(params))), await scanEmpty(params)];
  if (inTauri) await invoke("check_keep_baseline", { ...where, scans });
  return scans;
}

async function checkRun(plan: Plan, run: Run): Promise<Finding[]> {
  const where = { mode: run.mode, size: run.size };
  const manifest = plan.theme.manifest;
  const allow: Allowances = {
    singleMode: (manifest.modes ?? ["light", "dark"]).length === 1,
    lanes: manifest.layout?.board === "lanes",
    overlay: manifest.layout?.detail === "overlay",
    helper: manifest.text?.helper ?? "Bosun",
  };
  const themed = { theme: run.mode };
  const nautical = { ...themed, look: NAUTICAL };
  const baseline = await nauticalBaseline(run, nautical);
  log(`${run.mode} ${run.size}: scanning ${plan.theme.id}`);
  const scans = [...(await scanAll(await loadFrame(themed))), await scanEmpty(themed)];
  const findings = baseline.flatMap((base) => {
    const theirs = scans.find((s) => s.view === base.view);
    return theirs ? compareView(base, theirs, allow, where) : [{ ...where, view: base.view, problem: `the ${base.view} view did not open` }];
  });
  log(`${run.mode} ${run.size}: interactions`);
  const outcomes = await interact(plan, run, themed);
  findings.push(...outcomes.filter((o) => o.problem).map((o) => ({ ...where, view: "interaction", control: o.control, problem: `${o.check}: ${o.problem}` })));
  await proveFindings(findings, run, themed);
  return findings;
}

async function shotRun(run: Run): Promise<string[]> {
  const params = { theme: run.mode };
  const name = (view: string) => `${run.mode}-${run.size}-${view}`;
  const shots: string[] = [];
  const take = async (view: string) => {
    const shot = await snapshot(name(view));
    if (shot) shots.push(shot);
  };
  let frame = await loadFrame(params);
  await take("board");
  await openCard(frame);
  await take("detail");
  frame = await loadFrame(params);
  await click(frame, '[data-control="open-settings"]', SETTINGS);
  await take("settings");
  frame = await loadFrame(params);
  await click(frame, '[data-control="helper-open"]', DRAWER_OPEN);
  await take("chat");
  return shots;
}

async function main() {
  const plan = inTauri ? await invoke<Plan>("check_plan") : await devPlan();
  Object.assign(window, { fathomCheckTheme: plan.theme });
  const report: Report = { findings: [], shots: [] };
  try {
    for (const run of plan.runs) {
      if (inTauri) {
        await invoke("check_resize", { width: run.width, height: run.height });
        await wait(SETTLE_MS);
      }
      if (plan.job === "shot") report.shots.push(...(await shotRun(run)));
      else report.findings.push(...(await checkRun(plan, run)));
    }
  } catch (error) {
    report.findings.push({ problem: `the check could not finish: ${error instanceof Error ? error.message : String(error)}` });
    report.incomplete = true;
  }
  Object.assign(window, { fathomCheckReport: report });
  if (inTauri) await invoke("check_finish", { report });
  else log(JSON.stringify(report, null, 2));
}

void main();
