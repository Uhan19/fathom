import { describe, expect, it } from "vitest";
import { CARD_LINKS, RECORDED_PR, cardLinkSources, describeUrl, findLinks, findPaths, groupLinks, splitText, topLinks, trimTrailing, type Linking } from "./links";

const LINKING: Linking = { linearWorkspace: "reef-co", ticketPrefixes: ["ENG", "OPS"] };

const labels = (text: string, linking?: Linking) =>
  splitText(text, linking).map((p) => (p.type === "link" ? `link:${p.link.label}` : p.type === "path" ? `path:${p.path}` : `text:${p.text}`));

describe("describeUrl", () => {
  it("labels GitHub pull requests, issues, commits and repositories", () => {
    expect(describeUrl("https://github.com/example/atlas-api/pull/418")).toMatchObject({
      kind: "pr",
      group: "code",
      label: "PR #418 · example/atlas-api",
      url: "https://github.com/example/atlas-api/pull/418",
    });
    expect(describeUrl("https://github.com/example/atlas-api/pull/418/files#diff-1")?.url).toBe("https://github.com/example/atlas-api/pull/418");
    expect(describeUrl("https://github.com/example/atlas-api/issues/7#issuecomment-1")?.label).toBe("Issue #7 · example/atlas-api");
    expect(describeUrl("https://github.com/example/atlas-api/commit/0123456789abcdef")?.label).toBe("Commit 0123456 · example/atlas-api");
    expect(describeUrl("https://github.com/example/atlas-api")).toMatchObject({ kind: "repo", label: "example/atlas-api · GitHub" });
    expect(describeUrl("https://github.com/example/atlas-api.git")?.label).toBe("example/atlas-api · GitHub");
    expect(describeUrl("https://github.com/example/atlas-api/blob/main/docs/retry-budget.md")).toMatchObject({
      kind: "github",
      group: "other",
      label: "retry-budget.md · example/atlas-api",
    });
    expect(describeUrl("https://github.com/example")?.label).toBe("example · GitHub");
  });

  it("labels Linear tickets and projects", () => {
    expect(describeUrl("https://linear.app/reef-co/issue/eng-1234/fix-the-retries")).toMatchObject({
      kind: "ticket",
      group: "tickets",
      label: "ENG-1234 · Linear",
      url: "https://linear.app/reef-co/issue/ENG-1234",
    });
    expect(describeUrl("https://linear.app/reef-co/project/payments-cleanup-0a1b2c3d4e5f")?.label).toBe("Payments cleanup · Linear project");
  });

  it("labels Slack threads, messages and channels", () => {
    expect(describeUrl("https://reef-co.slack.com/archives/C0123ABCD/p1795100000123456?thread_ts=1795099000.000100&cid=C0123ABCD")).toMatchObject({
      kind: "slack",
      group: "conversations",
      label: "Slack thread · reef-co",
      url: "https://reef-co.slack.com/archives/C0123ABCD/p1795100000123456?thread_ts=1795099000.000100",
    });
    expect(describeUrl("https://reef-co.slack.com/archives/C0123ABCD/p1795100000123456")?.label).toBe("Slack message · reef-co");
    expect(describeUrl("https://reef-co.slack.com/archives/C0123ABCD")?.label).toBe("Slack channel · reef-co");
  });

  it("names other pages by their last meaningful path segment and host", () => {
    expect(describeUrl("https://docs.example.com/api-reference/rate_limits")).toMatchObject({ kind: "web", label: "Rate limits · docs.example.com" });
    expect(describeUrl("https://www.example.com/")?.label).toBe("example.com");
    expect(describeUrl("https://example.com/runs/1234567")?.label).toBe("Runs · example.com");
    expect(describeUrl("http://127.0.0.1:4387/session/559f789bb4c68a4f")?.label).toBe("Local page · 127.0.0.1:4387");
    expect(describeUrl("ftp://example.com/x")).toBeNull();
    expect(describeUrl("not a url")).toBeNull();
  });

  it("never uses a raw URL as a label", () => {
    const urls = [
      "https://github.com/example/atlas-api/pull/418",
      "https://linear.app/reef-co/issue/ENG-1",
      "https://reef-co.slack.com/archives/C1/p1",
      "https://docs.example.com/guide",
      "http://localhost:3000/",
    ];
    for (const url of urls) expect(describeUrl(url)?.label).not.toMatch(/^https?:/);
  });
});

describe("splitText", () => {
  it("keeps trailing punctuation, brackets and backticks out of URLs", () => {
    const url = "https://github.com/example/atlas-api/pull/418";
    for (const text of [`See ${url}.`, `(${url})`, `<${url}>`, `\`${url}\``, `"${url}",`, `**${url}**`, `${url}:`]) {
      const link = splitText(text).find((p) => p.type === "link");
      expect(link?.type === "link" && link.text, text).toBe(url);
    }
    expect(trimTrailing("https://en.example.org/wiki/Reef_(biology))")).toBe("https://en.example.org/wiki/Reef_(biology)");
  });

  it("reads Markdown links and keeps their label", () => {
    const pieces = splitText("Read [the plan](https://github.com/example/atlas-api/pull/418) and [notes](data/atl-12/notes.md).");
    expect(pieces).toMatchObject([
      { type: "text", text: "Read " },
      { type: "link", label: "the plan", link: { kind: "pr" } },
      { type: "text", text: " and " },
      { type: "path", label: "notes", path: "data/atl-12/notes.md" },
      { type: "text", text: "." },
    ]);
  });

  it("finds absolute, home and Firstmate-relative paths but not prose slashes", () => {
    expect(labels("Wrote ~/exports/review.md, /tmp/shots/after.png and data/atl-03/report.md.")).toEqual([
      "text:Wrote ",
      "path:~/exports/review.md",
      "text:, ",
      "path:/tmp/shots/after.png",
      "text: and ",
      "path:data/atl-03/report.md",
      "text:.",
    ]);
    expect(labels("the task folder data/atl-03/ holds it")).toContain("path:data/atl-03/");
    expect(labels("read and/or write 1/2 of the 2026/11/20 batch")).toEqual(["text:read and/or write 1/2 of the 2026/11/20 batch"]);
    expect(labels("see src/App.tsx:42")).toContain("path:src/App.tsx");
  });

  it("does not find paths inside URLs", () => {
    expect(labels("https://docs.example.com/guide/setup.md")).toEqual(["link:setup.md · docs.example.com"]);
  });

  it("links bare ticket ids only with a Linear workspace and a known prefix", () => {
    expect(labels("Tracked in ENG-1234; UTF-8 and OPS-7.", LINKING)).toEqual([
      "text:Tracked in ",
      "link:ENG-1234 · Linear",
      "text:; UTF-8 and ",
      "link:OPS-7 · Linear",
      "text:.",
    ]);
    expect(labels("Tracked in ENG-1234")).toEqual(["text:Tracked in ENG-1234"]);
    expect(labels("Tracked in ENG-1234", { linearWorkspace: "", ticketPrefixes: ["ENG"] })).toEqual(["text:Tracked in ENG-1234"]);
    expect(labels("Tracked in XENG-1234 and ENG-12-3", LINKING)).toEqual(["text:Tracked in XENG-1234 and ENG-12-3"]);
  });
});

describe("findLinks", () => {
  const pr = "https://github.com/example/atlas-api/pull/418";

  it("de-duplicates links across sources and remembers where each was found", () => {
    const links = findLinks(
      [
        { name: RECORDED_PR, text: pr },
        { name: "Note", text: `Opened ${pr}/files and https://reef-co.slack.com/archives/C1/p1795100000123456` },
        { name: "Activity", text: `PR ready ${pr}. Tracked in ENG-12` },
        { name: "Hold reason", text: "Docs at https://docs.example.com/retries and issue https://github.com/example/atlas-api/issues/3" },
      ],
      LINKING,
    );
    expect(links.map((l) => l.label)).toEqual([
      "PR #418 · example/atlas-api",
      "Issue #3 · example/atlas-api",
      "ENG-12 · Linear",
      "Slack message · reef-co",
      "Retries · docs.example.com",
    ]);
    expect(links[0].sources).toEqual([RECORDED_PR, "Note", "Activity"]);
  });

  it("groups links in the order the Links tab shows them", () => {
    const links = findLinks([{ name: "Note", text: "https://docs.example.com/a https://reef-co.slack.com/archives/C1 https://linear.app/reef-co/issue/ENG-1 https://github.com/example/atlas-api/pull/1" }]);
    expect(groupLinks(links).map((g) => [g.title, g.links.length])).toEqual([
      ["Pull requests and issues", 1],
      ["Tickets", 1],
      ["Conversations", 1],
      ["Other links", 1],
    ]);
  });

  it("puts the recorded pull request first among at most three top links", () => {
    const links = findLinks([
      { name: "Note", text: "https://docs.example.com/a https://github.com/example/atlas-api/issues/2 https://github.com/example/atlas-api/pull/1" },
      { name: CARD_LINKS, text: "https://reef-co.slack.com/archives/C1/p1" },
      { name: RECORDED_PR, text: "https://github.com/example/atlas-api/pull/9" },
    ]);
    expect(topLinks(links).map((l) => l.label)).toEqual(["PR #9 · example/atlas-api", "PR #1 · example/atlas-api", "Slack message · reef-co"]);
  });
});

describe("findPaths", () => {
  it("collects each local path once, including card link targets", () => {
    const sources = [
      { name: "Note", text: "Report in data/atl-03/report.md and ~/exports/review.md" },
      ...cardLinkSources([
        { kind: "report", target: "data/atl-03/report.md" },
        { kind: "pr", target: "https://github.com/example/atlas-api/pull/1" },
      ]),
      { name: "Activity", text: "screenshot at /tmp/fm-atl-03/after.png" },
    ];
    expect(findPaths(sources)).toEqual(["data/atl-03/report.md", "~/exports/review.md", "/tmp/fm-atl-03/after.png"]);
  });

  it("ignores closing tags and single-segment roots", () => {
    const sources = [{ name: "Note", text: "Raw <script>alert(1)</script> stays text; /tmp alone is not a file but ~/notes is" }];
    expect(findPaths(sources)).toEqual(["~/notes"]);
  });
});
