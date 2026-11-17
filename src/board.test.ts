import { describe, expect, it } from "vitest";
import type { Card, Column } from "./api";
import { cardMessage, cardNote, columnTemplate, formatBytes, groupCards, holdHeading, linkLabel, rowCounts } from "./board";

const card = (over: Partial<Card>): Card => ({
  id: "harbor-lights",
  title: "Fix the harbor lights",
  state: "queued",
  kind: "ship",
  project: "harbor",
  row: "seabed",
  holdKind: "",
  holdUntil: "",
  holdReason: "",
  blockedBy: [],
  links: [],
  closed: "",
  ...over,
});

const column = (project: string, over: Partial<Column> = {}): Column => ({
  project,
  name: project,
  position: 0,
  width: 280,
  collapsed: false,
  ...over,
});

describe("board helpers", () => {
  it("groups cards into project and row cells, newest landed first", () => {
    const cells = groupCards(
      [
        card({ id: "a", row: "landed", closed: "2026-10-01" }),
        card({ id: "b", row: "landed", closed: "2026-11-01" }),
        card({ id: "c", project: "reef", row: "surface" }),
        card({ id: "d", project: "unknown" }),
      ],
      [column("harbor"), column("reef")],
    );
    expect(cells.get("harbor")?.get("landed")?.map((c) => c.id)).toEqual(["b", "a"]);
    expect(cells.get("reef")?.get("surface")?.map((c) => c.id)).toEqual(["c"]);
    expect(cells.has("unknown")).toBe(false);
  });

  it("counts cards per row", () => {
    const counts = rowCounts([card({ row: "surface" }), card({ row: "surface" }), card({ row: "deep" })]);
    expect(counts).toEqual({ surface: 2, shallows: 0, deep: 1, seabed: 0, landed: 0 });
  });

  it("builds the grid template with collapsed columns", () => {
    expect(columnTemplate([column("a"), column("b", { collapsed: true })])).toBe("150px 280px 44px");
  });

  it("notes what a queued card waits for and a deferred date", () => {
    expect(cardNote(card({ blockedBy: ["tide-gauge"] }))).toBe("Waits for tide-gauge");
    expect(cardNote(card({ row: "deep", holdKind: "captain", holdUntil: "2026-12-01" }))).toBe("Until 2026-12-01");
    expect(cardNote(card({ row: "shallows" }))).toBeNull();
  });

  it("names holds", () => {
    expect(holdHeading(card({ holdKind: "captain" }))).toBe("Question for you");
    expect(holdHeading(card({ holdKind: "parked" }))).toBe("Parked");
    expect(holdHeading(card({}))).toBeNull();
  });

  it("labels links", () => {
    expect(linkLabel({ kind: "pr", target: "https://github.com/acme/harbor/pull/12" })).toBe("PR #12 on GitHub");
    expect(linkLabel({ kind: "report", target: "data/harbor-lights/report.md" })).toBe("Report: report.md");
  });

  it("formats the message sent to firstmate", () => {
    expect(cardMessage(card({}), "  is this blocked?  ")).toBe("Fix the harbor lights (harbor-lights): is this blocked?");
  });

  it("formats data sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
