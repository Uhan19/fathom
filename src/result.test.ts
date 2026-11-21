import { describe, expect, it } from "vitest";
import type { FileEntry, PrStatus, StatusEntry } from "./api";
import {
  buildResult,
  callAnswer,
  counterpart,
  doneLine,
  leadSection,
  parseCall,
  pickShot,
  reportEntry,
  reportFile,
  shotSet,
  shotTags,
  stepShot,
  stripStates,
  toShots,
  type ResultInput,
} from "./result";

const PR = "https://github.com/acme/web/pull/12";

function image(name: string, folder = "/home/demo/Documents/screenshots", size = 1000): FileEntry {
  return { path: `${folder}/${name}`, name, folder, kind: "file", preview: "image", size, modifiedMs: null, inTaskFolder: false, mentions: [] };
}

function entry(state: string, text: string, atMs = 1_000): StatusEntry {
  return { state, text, atMs, key: null };
}

function input(overrides: Partial<ResultInput> = {}): ResultInput {
  return {
    card: { id: "web-7", kind: "task", state: "queued", holdKind: "", holdReason: "" },
    activity: [],
    report: null,
    prBody: null,
    prs: [],
    prStatuses: new Map(),
    images: [],
    theme: "light",
    ...overrides,
  };
}

const REPORT = [
  "# Price feed check",
  "",
  "## Short answer",
  "",
  "The feed is safe to use. It has tracked the reference price within 0.2% for 30 days.",
  "",
  "- No stale rounds in the window.",
  "- Two short gaps during the October upgrade.",
  "",
  "## Method",
  "",
  "Pulled every round.",
].join("\n");

describe("the lead of a report", () => {
  it("takes the first answer-like section and drops subheads, tables and fences", () => {
    const text = ["# Title", "", "## Context", "", "Why.", "", "## Verdict", "", "**Short form**", "", "| a | b |", "```", "code", "```", "- Ship it today."].join("\n");
    expect(leadSection(text)).toEqual({ heading: "Verdict", items: ["Ship it today."] });
  });

  it("keeps a bold list item that reads like a subhead", () => {
    expect(leadSection("## Summary\n\n**Changes**\n\n- **Bosun is gone from the header.**\n- Rows fold.")?.items).toEqual(["**Bosun is gone from the header.**", "Rows fold."]);
  });

  it("stops before a list introduced later in the section, but keeps one the section opens with", () => {
    expect(leadSection("## Summary\n\nAdds a setup sheet.\n\nThe sheet tells the agent to:\n\n- ask once;\n- install it.")?.items).toEqual(["Adds a setup sheet."]);
    expect(leadSection("## Result\n\nThree things changed in the header:\n\n- rows fold\n- chat hides")?.items).toEqual(["Three things changed in the header:", "rows fold", "chat hides"]);
  });

  it("skips link-only metadata lines and short labels", () => {
    expect(leadSection("Linear: [ENG-5036](https://linear.app/x/issue/ENG-5036)\n\nENG-5207.\n\nBottom line:\n\n- Adds a minimum deposit.\n\n## More")?.items).toEqual(["Adds a minimum deposit."]);
  });

  it("prefers the opening paragraph when the report starts with prose", () => {
    expect(leadSection("CI is slow because of the cold cache.\n\n## Detail\n\nMore.")).toEqual({ heading: null, items: ["CI is slow because of the cold cache."] });
  });

  it("finds nothing when no section reads like an answer", () => {
    expect(leadSection("# Plan\n\n## Steps\n\n- one")).toBeNull();
  });

  it("counts sections and lines for the footer", () => {
    expect(reportFile("data/web-7/report.md", REPORT)).toMatchObject({ sections: 2, lines: 12 });
  });
});

describe("the done line", () => {
  it("uses the newest done entry and lets its PR link name itself", () => {
    expect(doneLine([entry("done", "Settings page redesigned with a dark theme PR " + PR), entry("done", "older")])).toBe(
      "Settings page redesigned with a dark theme " + PR,
    );
  });

  it("is skipped when it is mostly links, paths and figures", () => {
    expect(doneLine([entry("done", `PR ${PR}`)])).toBeNull();
    expect(doneLine([entry("done", `PR ${PR} - model qwen3.5:9b (~7.6 GB); screenshots /tmp/a.png, /tmp/b.png`)])).toBeNull();
    expect(doneLine([entry("working", "Halfway through the settings page")])).toBeNull();
  });
});

describe("parsing a captain call", () => {
  it("splits lettered options and marks the recommended one", () => {
    expect(parseCall("There are 212 rows with no account. Options: (a) delete them; (b) archive them (recommended); (c) keep them.")).toEqual({
      intro: "There are 212 rows with no account.",
      questions: [
        {
          key: "",
          text: "",
          options: [
            { key: "A", text: "delete them", recommended: false },
            { key: "B", text: "archive them", recommended: true },
            { key: "C", text: "keep them", recommended: false },
          ],
        },
      ],
      outro: "",
    });
  });

  it("reads a) b) and bare capital letters", () => {
    expect(parseCall("Pick a host: a) Vercel, b) Fly, or c) a VPS")?.questions[0].options.map((o) => o.text)).toEqual(["Vercel", "Fly", "a VPS"]);
    expect(parseCall("Which vault: A the old one, B the new one")?.questions[0].options.map((o) => o.key)).toEqual(["A", "B"]);
  });

  it("keeps a trailing sentence after the last option as the outro", () => {
    const call = parseCall("Ship now? (a) yes (b) wait a week. I lean towards waiting for the audit.");
    expect(call?.questions[0].options[1].text).toBe("wait a week");
    expect(call?.outro).toBe("I lean towards waiting for the audit.");
  });

  it("splits numbered questions and keeps an unlettered one as text", () => {
    const call = parseCall("Three calls. (1) Name: (a) Fathom (b) Depth. (2) Color: (a) blue (b) green. (3) Anything else you want changed?");
    expect(call?.intro).toBe("Three calls");
    expect(call?.questions.map((q) => [q.key, q.text, q.options.map((o) => o.text)])).toEqual([
      ["1", "Name", ["Fathom", "Depth"]],
      ["2", "Color", ["blue", "green"]],
      ["3", "Anything else you want changed?", []],
    ]);
  });

  it("does not mistake prose for options", () => {
    expect(parseCall("Need your approval to rotate the deploy key.")).toBeNull();
    expect(parseCall("Plan A is fine with me")).toBeNull();
    expect(parseCall("")).toBeNull();
  });

  it("writes the answer as a letter, or one letter per question", () => {
    const call = parseCall("(1) x: (a) p (b) q (2) y: (a) r (b) s")!;
    expect(callAnswer(call.questions, new Map([["1", "B"]]))).toBe("1: B");
    expect(callAnswer(call.questions, new Map([["1", "B"], ["2", "A"]]))).toBe("1: B; 2: A");
    const single = parseCall("Go? (a) yes (b) no")!;
    expect(callAnswer(single.questions, new Map([["", "A"]]))).toBe("A");
  });
});

describe("tagging screenshots from their names", () => {
  it("reads phase, width, theme and state around the task id", () => {
    expect(shotTags("web-7-after-1280-dark-settings.png", "web-7")).toEqual({ phase: "after", width: 1280, theme: "dark", state: "settings" });
    expect(shotTags("web-7_390x844_empty-list.jpg", "web-7")).toEqual({ phase: null, width: 390, theme: null, state: "empty list" });
    expect(shotTags("03-hero.png", "web-7")).toEqual({ phase: null, width: null, theme: null, state: "hero" });
    expect(shotTags("before-light.png", "web-7")).toEqual({ phase: "before", width: null, theme: "light", state: "" });
  });

  it("does not read small or huge numbers as widths", () => {
    expect(shotTags("web-7-step-12-pool-9000.png", "web-7").width).toBeNull();
  });
});

const NAMES = [
  "web-7-before-1280-light-settings.png",
  "web-7-after-1280-light-settings.png",
  "web-7-before-1280-dark-settings.png",
  "web-7-after-1280-dark-settings.png",
  "web-7-after-390-light-settings.png",
  "web-7-after-1280-light-billing.png",
  "web-7-after-1280-light-team.png",
  "web-7-after-1280-light-profile.png",
  "web-7-after-1280-light-alerts.png",
];

const set = (theme: "light" | "dark" = "light") => shotSet(toShots(NAMES.map((n) => image(n)), "web-7"), theme)!;

describe("a set of screenshots", () => {
  it("keeps only axes with two or more values", () => {
    expect(set().axes).toEqual({ phase: ["before", "after"], width: [1280, 390], theme: ["light", "dark"] });
    expect(shotSet(toShots([image("web-7-a-dark.png"), image("web-7-b-dark.png")], "web-7"), "light")?.axes).toEqual({ phase: [], width: [], theme: [] });
  });

  it("leads with an after shot in the board's theme at the most common width", () => {
    expect(set().lead.name).toBe("web-7-after-1280-light-settings.png");
    expect(set("dark").lead.name).toBe("web-7-after-1280-dark-settings.png");
  });

  it("moves along one axis while keeping the others", () => {
    const shots = set().shots;
    const lead = shots.find((s) => s.name === "web-7-after-1280-light-settings.png")!;
    expect(pickShot(shots, lead, { theme: "dark" })?.name).toBe("web-7-after-1280-dark-settings.png");
    expect(pickShot(shots, lead, { width: 390 })?.name).toBe("web-7-after-390-light-settings.png");
    expect(pickShot(shots, lead, { state: "team" })?.name).toBe("web-7-after-1280-light-team.png");
    expect(pickShot(shots, lead, { state: "nowhere" })).toBeNull();
    expect(counterpart(shots, lead)?.name).toBe("web-7-before-1280-light-settings.png");
    expect(counterpart(shots, pickShot(shots, lead, { state: "team" })!)).toBeNull();
  });

  it("shows the lead's state in a short strip and wraps when stepping", () => {
    const shots = set();
    expect(stripStates(shots, 4)).toEqual(["settings", "alerts", "billing", "profile"]);
    expect(stepShot(shots.shots, shots.shots[shots.shots.length - 1], 1)).toBe(shots.shots[0]);
    expect(stepShot(shots.shots, shots.shots[0], -1)).toBe(shots.shots[shots.shots.length - 1]);
  });
});

describe("the Result for each kind of card", () => {
  it("answers an investigation from its report", () => {
    const model = buildResult(input({ card: { id: "web-7", kind: "scout", state: "done", holdKind: "", holdReason: "" }, report: reportFile("r.md", REPORT) }));
    expect(model).toMatchObject({
      label: "Answer",
      headline: "The feed is safe to use.",
      points: ["It has tracked the reference price within 0.2% for 30 days.", "No stale rounds in the window.", "Two short gaps during the October upgrade."],
      body: { kind: "none" },
      report: { path: "r.md", sections: 2, lines: 12 },
    });
  });

  it("shows screenshots and the PR for UI work", () => {
    const model = buildResult(input({ activity: [entry("done", `Settings page redesigned with a dark theme PR ${PR}`)], prs: [PR], images: [image("web-7-after-1280-light-settings.png")] }));
    expect(model?.label).toBe("Result");
    expect(model?.headline).toBe(`Settings page redesigned with a dark theme ${PR}`);
    expect(model?.body).toMatchObject({ kind: "shots", prs: [PR] });
  });

  it("never cuts the headline inside bold or code", () => {
    const report = reportFile("r.md", "## Short answer\n\n**No. The listing is not live yet.** It waits on review. Then `v1. 2` ships.");
    expect(buildResult(input({ report }))).toMatchObject({ headline: "**No. The listing is not live yet.**", points: ["It waits on review. Then `v1. 2` ships."] });
  });

  it("falls back from the done line to the PR body and then the PR title for code work", () => {
    const prBody = "## Summary\n\n- Adds retries to the price fetcher.\n- Logs each failure.";
    expect(buildResult(input({ prBody, prs: [PR] }))).toMatchObject({ headline: "Adds retries to the price fetcher.", points: ["Logs each failure."], body: { kind: "prs", prs: [PR] } });
    const statuses = new Map<string, PrStatus | null>([[PR, { url: PR, state: "open", checks: "passing", title: "Add retries to the fetcher", note: null }]]);
    expect(buildResult(input({ prs: [PR], prStatuses: statuses }))?.headline).toBe("Add retries to the fetcher");
  });

  it("turns a captain hold with options into a call and keeps plain holds out", () => {
    const call = buildResult(input({ card: { id: "web-7", kind: "task", state: "queued", holdKind: "captain", holdReason: "Go? (a) yes (b) no" }, report: reportFile("r.md", REPORT) }));
    expect(call).toMatchObject({ label: "Your call", headline: null, body: { kind: "call" }, report: { path: "r.md" } });
    expect(buildResult(input({ card: { id: "web-7", kind: "task", state: "queued", holdKind: "captain", holdReason: "Approve the key rotation?" } }))).toBeNull();
    const answered = buildResult(input({ card: { id: "web-7", kind: "captain", state: "done", holdKind: "captain", holdReason: "Go? (a) yes (b) no" }, report: reportFile("r.md", REPORT) }));
    expect(answered).toMatchObject({ label: "Answer", body: { kind: "none" } });
  });

  it("shows a watch's newest update with a tone", () => {
    const model = buildResult(input({ card: { id: "web-7", kind: "watch", state: "in_flight", holdKind: "", holdReason: "" }, activity: [entry("blocked", "RPC is down"), entry("working", "All clear")] }));
    expect(model).toMatchObject({ label: "Watch", headline: null, body: { kind: "watch", tone: "warn", entry: { text: "RPC is down" } } });
  });

  it("is absent when a card has nothing to show", () => {
    expect(buildResult(input())).toBeNull();
    expect(buildResult(input({ prs: [PR] }))).toBeNull();
    expect(buildResult(input({ activity: [entry("done", `PR ${PR}`)] }))).toBeNull();
  });
});

describe("finding the report", () => {
  const file = (name: string, folder: string, mentions: string[] = []): FileEntry => ({
    path: `/home/fm/${folder}/${name}`,
    name,
    folder,
    kind: "file",
    preview: "markdown",
    size: 10,
    modifiedMs: null,
    inTaskFolder: folder === "data/web-7",
    mentions,
  });

  it("prefers the linked report and otherwise uses report.md in the task folder", () => {
    const linked = file("findings.md", "data/other", ["data/other/findings.md"]);
    const local = file("report.md", "data/web-7");
    expect(reportEntry([{ kind: "report", target: "data/other/findings.md" }], [local, linked], "data/web-7")).toBe(linked);
    expect(reportEntry([], [local, linked], "data/web-7")).toBe(local);
    expect(reportEntry([], [linked], "data/web-7")).toBeNull();
  });
});
