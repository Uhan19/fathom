import { describe, expect, it } from "vitest";
import { unknownPrStatus, type PrStatus, type Wait } from "./api";
import { needChip, personRows, prLinks, sinceMs, tagText, waitHeading, waitTitle, waitsOf } from "./waits";

const PR = "https://github.com/example/harbor-web/pull/812";

const wait = (fields: Partial<Wait>): Wait => ({
  kind: "other",
  what: "",
  who: [],
  need: "all",
  since: null,
  link: null,
  state: {},
  ...fields,
});

const review = wait({ kind: "pr-review", what: "Re-review of the cropper upgrade", who: ["Mira", "Tomas", "Priya"], need: 2, link: PR });
const phone = wait({ kind: "slack-reply", what: "Phone check of the photo upload", who: ["Tomas"], state: { Tomas: "asked" } });
const either = wait({ kind: "pr-review", who: ["Sana", "Ollie"], need: "any" });
const email = wait({ kind: "email-reply", what: "Confirmation of the domain transfer" });

const live = (fields: Partial<PrStatus>): PrStatus => ({ ...unknownPrStatus(PR, null), state: "open", checks: "passing", ...fields });

describe("the card tag", () => {
  it("names who the task waits on", () => {
    expect(tagText([wait({ who: ["Jun"] })])).toEqual({ names: "Jun", more: 0 });
    expect(tagText([wait({ who: ["Mira", "Jun"] })])).toEqual({ names: "Mira, Jun", more: 0 });
  });

  it("joins an either-of wait with or", () => {
    expect(tagText([either])).toEqual({ names: "Sana or Ollie", more: 0 });
    expect(tagText([wait({ who: ["Sana", "Ollie", "Jun"], need: 1 })])).toEqual({ names: "Sana, Ollie or Jun", more: 0 });
    expect(tagText([either, wait({ who: ["Jun"] })])).toEqual({ names: "Sana or Ollie, Jun", more: 0 });
  });

  it("shows two entries and counts everyone else once", () => {
    expect(tagText([review, phone])).toEqual({ names: "Mira, Tomas", more: 1 });
    expect(tagText([wait({ who: ["A", "B", "C", "D"] }), wait({ who: ["B", "E"] })])).toEqual({ names: "A, B", more: 3 });
  });

  it("stays without names when nobody is recorded", () => {
    expect(tagText([email])).toEqual({ names: "", more: 0 });
    expect(tagText([email, wait({ who: ["Jun"] })])).toEqual({ names: "Jun", more: 0 });
  });

  it("explains every wait in its tooltip", () => {
    expect(waitTitle([review, phone])).toBe(
      "Waiting on 2 of Mira, Tomas and Priya: Re-review of the cropper upgrade\nWaiting on Tomas: Phone check of the photo upload",
    );
    expect(waitTitle([either])).toBe("Waiting on Sana or Ollie for a PR review");
    expect(waitTitle([email])).toBe("Waiting on an email reply: Confirmation of the domain transfer");
    expect(waitTitle([wait({ kind: "slack-reply" })])).toBe("Waiting on a Slack reply");
  });
});

describe("the Overview heading", () => {
  it("names one person or counts several", () => {
    expect(waitHeading([phone])).toBe("Waiting on Tomas");
    expect(waitHeading([either])).toBe("Waiting on Sana or Ollie");
    expect(waitHeading([review, phone])).toBe("Waiting on 3 people");
    expect(waitHeading([wait({ who: ["Jun"] }), wait({ who: ["Jun"] })])).toBe("Waiting on Jun");
  });

  it("names what is awaited when nobody is recorded", () => {
    expect(waitHeading([email])).toBe("Waiting on an email reply");
    expect(waitHeading([email, email])).toBe("Waiting on 2 email replies");
    expect(waitHeading([phone, email])).toBe("Waiting on Tomas and an email reply");
    expect(waitHeading([wait({}), wait({ kind: "slack-reply" })])).toBe("Waiting on a reply and a Slack reply");
  });
});

describe("the need chip", () => {
  it("says how many answers are needed", () => {
    expect(needChip(review, null)).toEqual({ text: "needs 2 of 3", tone: "need" });
    expect(needChip(either, null)).toEqual({ text: "needs 1 of 2", tone: "need" });
    expect(needChip(wait({ who: ["Mira", "Jun"] }), null)).toEqual({ text: "needs all 2", tone: "need" });
    expect(needChip(wait({ who: ["Mira", "Jun"], need: 5 }), null)).toEqual({ text: "needs all 2", tone: "need" });
    expect(needChip(phone, null)).toBeNull();
    expect(needChip(email, null)).toBeNull();
  });

  it("follows GitHub's review decision for a review", () => {
    expect(needChip(review, live({ reviewDecision: "approved" }))).toEqual({ text: "approved", tone: "ok" });
    expect(needChip(review, live({ reviewDecision: "changesRequested" }))).toEqual({ text: "changes requested", tone: "warn" });
    expect(needChip(review, live({ reviewDecision: "reviewRequired" }))).toEqual({ text: "needs 2 of 3", tone: "need" });
  });
});

describe("each person's state", () => {
  const people = { Mira: { github: "mira-k" }, Tomas: { github: "tomas-r" }, Priya: { github: null } };

  it("merges live reviews through the people map", () => {
    const status = live({
      requested: ["Tomas-R"],
      reviews: [
        { login: "mira-k", state: "approved" },
        { login: "tomas-r", state: "dismissed" },
      ],
    });
    expect(personRows(review, people, status)).toEqual([
      { name: "Mira", initial: "M", said: "approved", tone: "ok" },
      { name: "Tomas", initial: "T", said: "re-review requested", tone: "quiet" },
      { name: "Priya", initial: "P", said: null, tone: "quiet" },
    ]);
  });

  it("matches a name that is itself a GitHub login", () => {
    const status = live({ requested: ["sana"], reviews: [{ login: "ollie", state: "changesRequested" }] });
    expect(personRows(wait({ kind: "pr-review", who: ["sana", "ollie"], link: PR }), {}, status).map((r) => [r.said, r.tone])).toEqual([
      ["review requested", "quiet"],
      ["changes requested", "warn"],
    ]);
  });

  it("falls back to the recorded state when GitHub is not reachable", () => {
    const recorded = { ...review, state: { Mira: "approved" } };
    expect(personRows(recorded, people, unknownPrStatus(PR, "the GitHub CLI is not signed in"))[0]).toMatchObject({ said: "approved", tone: "ok" });
    expect(personRows(recorded, people, null)[1]).toMatchObject({ said: null });
  });

  it("uses the recorded state for Slack and email", () => {
    expect(personRows(phone, people, live({ reviews: [{ login: "tomas-r", state: "approved" }] }))).toEqual([
      { name: "Tomas", initial: "T", said: "asked", tone: "quiet" },
    ]);
    expect(personRows({ ...phone, state: { Tomas: "replied" } }, people, null)[0]).toMatchObject({ said: "replied", tone: "ok" });
    expect(personRows(email, people, null)).toEqual([]);
  });
});

describe("wait records", () => {
  it("finds a task's waits without tripping on object keys", () => {
    expect(waitsOf({ "hrb-31": [phone] }, "hrb-31")).toEqual([phone]);
    expect(waitsOf({}, "constructor")).toEqual([]);
  });

  it("reads the start time and only real pull request links", () => {
    expect(sinceMs(wait({ since: "2026-11-20T09:30:00Z" }))).toBe(Date.UTC(2026, 10, 20, 9, 30));
    expect(sinceMs(wait({ since: "last week" }))).toBeNull();
    expect(sinceMs(email)).toBeNull();
    expect(prLinks([review, phone, { ...either, link: "https://example.com/review" }])).toEqual([PR]);
  });
});
