import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unknownPrStatus, type FileEntry, type PrStatus } from "./api";
import { ResultSection } from "./components/DetailResult";
import { Markdown } from "./components/Markdown";
import { ViewerLayer } from "./components/ShotViewer";
import { NO_LINKING } from "./links";
import { buildResult, reportFile, shotSet, toShots, type ResultInput, type ResultModel } from "./result";

const ignore = () => undefined;
const PR = "https://github.com/acme/web/pull/12";

function image(name: string): FileEntry {
  const folder = "/home/demo/Documents/screenshots";
  return { path: `${folder}/${name}`, name, folder, kind: "file", preview: "image", size: 1000, modifiedMs: null, inTaskFolder: false, mentions: [] };
}

function model(overrides: Partial<ResultInput>): ResultModel {
  return buildResult({
    card: { id: "web-7", kind: "task", state: "queued", holdKind: "", holdReason: "" },
    activity: [],
    report: null,
    prBody: null,
    prs: [],
    prStatuses: new Map(),
    images: [],
    theme: "light",
    ...overrides,
  })!;
}

function section(result: ResultModel, statuses = new Map<string, PrStatus | null>()) {
  return renderToStaticMarkup(
    createElement(ResultSection, {
      model: result,
      cardId: "web-7",
      holdUntil: "",
      statuses,
      linking: NO_LINKING,
      onPath: () => null,
      onOpenReport: ignore,
      onAnswer: ignore,
    }),
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const SHOTS = ["before-1280-light-home", "after-1280-light-home", "after-1280-dark-home", "after-1280-light-billing", "after-1280-light-team", "after-1280-light-alerts", "after-1280-light-profile"].map(
  (name) => image(`web-7-${name}.png`),
);

describe("the Result section", () => {
  it("leads an investigation with its answer and links the full report", () => {
    const report = reportFile("data/web-7/report.md", "# Check\n\n## Answer\n\nYes, the feed is safe. It held within 0.2%.\n\n- No stale rounds.\n\n## Method\n\nRounds.");
    const html = section(model({ report }));
    expect(html).toContain('<span class="sech" data-part="sech">Answer</span>');
    expect(text(html)).toContain("Yes, the feed is safe.");
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(text(html)).toContain("Read the full report → 2 sections · 11 lines");
  });

  it("shows the lead screenshot with its switches and a strip of states for UI work", () => {
    const html = section(model({ images: SHOTS, activity: [{ state: "done", atMs: 1, key: null, text: "Home and billing pages redesigned" }] }));
    expect(html).toContain('class="shot-lead"');
    expect(html).toContain('aria-label="Before or after"');
    expect(html).toContain('aria-label="Theme"');
    expect(html).not.toContain('aria-label="Width"');
    expect([...html.matchAll(/class="shot-cell-label" data-part="shot-cell-label">([^<]+)</g)].map((m) => m[1])).toEqual(["Home", "Alerts", "Billing", "Profile", "Full window"]);
    expect(text(html)).toContain("All 7");
  });

  it("leaves out a switch the shown screenshot has no tag for", () => {
    const images = [image("web-7-home.png"), image("web-7-team-light.png"), image("web-7-team-dark.png")];
    const html = section(model({ images, theme: "dark", activity: [{ state: "done", atMs: 1, key: null, text: "Home and team pages redesigned" }] }));
    expect(html).toContain('aria-label="Theme"');
    const untagged = section(model({ images: [image("web-7-home.png"), image("web-7-team-1440.png"), image("web-7-team-390.png")], activity: [{ state: "done", atMs: 1, key: null, text: "Home and team pages redesigned" }] }));
    expect(untagged).not.toContain("shot-axes");
  });

  it("drops the switches and strip for a single screenshot", () => {
    const html = section(model({ images: [image("web-7-home.png")], activity: [{ state: "done", atMs: 1, key: null, text: "Home page redesigned for mobile" }] }));
    expect(html).toContain('class="shot-lead"');
    expect(html).not.toContain("shot-strip");
    expect(html).not.toContain("shot-axes");
  });

  it("lists the PR with its status for code work", () => {
    const statuses = new Map<string, PrStatus | null>([[PR, { ...unknownPrStatus(PR, null), state: "merged", checks: "passing", title: "Add retries" }]]);
    const html = section(model({ prs: [PR], prStatuses: statuses }), statuses);
    expect(text(html)).toContain("Add retries");
    expect(html).toContain("result-prs boxed");
    expect(text(html)).toContain("PR #12 · acme/web Merged");
  });

  it("offers a captain call as options to pick, with the recommended one tagged", () => {
    const html = section(model({ card: { id: "web-7", kind: "task", state: "queued", holdKind: "captain", holdReason: "212 rows have no account. Options: (a) delete them; (b) archive them (recommended); (c) keep them." } }));
    expect(html).toContain("result-call");
    expect(html).toContain('<span class="sech" data-part="sech">Your call</span>');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(text(html)).toContain("B) archive them Recommended");
    expect(html).not.toContain("call-progress");
  });

  it("opens one question at a time when a call has several", () => {
    const html = section(model({ card: { id: "web-7", kind: "task", state: "queued", holdKind: "captain", holdReason: "(1) Name: (a) Fathom (b) Depth (recommended) (2) Color: (a) blue (b) green" } }));
    expect(text(html)).toContain("0 of 2 picked");
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toContain('class="call-row"');
  });

  it("shows a watch's latest update with its state", () => {
    const html = section(model({ card: { id: "web-7", kind: "watch", state: "in_flight", holdKind: "", holdReason: "" }, activity: [{ state: "blocked", atMs: Date.now(), key: null, text: "RPC is down" }] }));
    expect(html).toContain("result-watch tone-warn");
    expect(text(html)).toContain("Blocked last update");
  });
});

describe("the full-window viewer", () => {
  afterEach(() => vi.unstubAllGlobals());

  function viewer(width: number, start = "web-7-after-1280-light-home.png") {
    vi.stubGlobal("window", { innerWidth: width });
    const set = shotSet(toShots(SHOTS, "web-7"), "light")!;
    return renderToStaticMarkup(createElement(ViewerLayer, { set, start: set.shots.find((s) => s.name === start)!, title: "web-7", onClose: ignore }));
  }

  it("is a modal dialog that names the task and the shot", () => {
    const html = viewer(1440);
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="Screenshots: web-7"');
    expect(text(html)).toContain("web-7 Home · After · 1280 · Light");
    expect(text(html)).toContain(`${toShots(SHOTS, "web-7").findIndex((s) => s.name === "web-7-after-1280-light-home.png") + 1} / 7`);
  });

  it("offers side by side only when the window is wide enough", () => {
    expect(text(viewer(1440))).toContain("Flip Slider Side by side");
    expect(text(viewer(900))).not.toContain("Side by side");
  });

  it("hides the compare modes for a shot with no before", () => {
    expect(viewer(1440, "web-7-after-1280-light-team.png")).not.toContain('aria-label="Compare"');
  });

  it("lays every state out against each theme and lists the variants of the current one", () => {
    const html = viewer(1440);
    expect(html).toContain("States × theme");
    expect(html.match(/<button[^>]*class="matrix-cell/g)).toHaveLength(6);
    expect(html.match(/matrix-cell empty/g)).toHaveLength(4);
    expect([...html.matchAll(/class="film-label" data-part="film-label">([^<]+)</g)].map((m) => m[1])).toEqual(["After 1280 Dark", "After 1280 Light", "Before 1280 Light"]);
  });
});

describe("content links", () => {
  it("name each link and file path by its target", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: `See ${PR} and data/web-7/report.md`, linking: NO_LINKING, onPath: () => ignore }));
    expect(html).toContain('data-part="markdown"');
    expect(html).toContain(`data-part="inline-link" data-control="content-link" data-key="${PR}"`);
    expect(html).toContain('data-part="path-link" data-control="content-path" data-key="data/web-7/report.md"');
  });
});
