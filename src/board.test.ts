import { describe, expect, it } from "vitest";
import type { Card, Column, MoveRequest, Overlay } from "./api";
import {
  cardMessage,
  cardNote,
  columnTemplate,
  formatBytes,
  groupCards,
  holdHeading,
  insertAt,
  linkLabel,
  placeLocally,
  rowCounts,
  shownRequest,
} from "./board";

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

const request = (over: Partial<MoveRequest>): MoveRequest => ({
  requestId: "fathom-move-a-1",
  cardId: "a",
  title: "A",
  fromRow: "seabed",
  toRow: "shallows",
  createdMs: 1,
  status: "asked",
  noteId: "n-1",
  answer: null,
  error: null,
  ...over,
});

const ids = (cells: ReturnType<typeof groupCards>, project: string, row: Card["row"]) =>
  cells.get(project)?.get(row)?.map((c) => c.id);

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

describe("card places and move requests", () => {
  const columns = [column("harbor"), column("reef")];
  const cards = [card({ id: "a" }), card({ id: "b" }), card({ id: "c" }), card({ id: "d", project: "reef" })];

  it("orders placed cards after unplaced ones in their saved order", () => {
    const overlay: Overlay = {
      places: [
        { cardId: "a", project: null, row: "seabed", position: 1 },
        { cardId: "b", project: null, row: "seabed", position: 0 },
      ],
      requests: [],
    };
    expect(ids(groupCards(cards, columns, overlay), "harbor", "seabed")).toEqual(["c", "b", "a"]);
  });

  it("moves a card to its chosen column and ignores unknown columns", () => {
    const overlay: Overlay = {
      places: [
        { cardId: "a", project: "reef", row: "seabed", position: 0 },
        { cardId: "b", project: "gone", row: "seabed", position: 0 },
      ],
      requests: [],
    };
    const cells = groupCards(cards, columns, overlay);
    expect(ids(cells, "reef", "seabed")).toEqual(["d", "a"]);
    expect(ids(cells, "harbor", "seabed")).toEqual(["c", "b"]);
    expect(cells.get("reef")?.get("seabed")?.[1].project).toBe("reef");
  });

  it("shows a card in the asked row until the request settles", () => {
    for (const status of ["sending", "asked", "failed"] as const) {
      const cells = groupCards(cards, columns, { places: [], requests: [request({ status })] });
      expect(ids(cells, "harbor", "shallows")).toEqual(["a"]);
      expect(cells.get("harbor")?.get("shallows")?.[0].row).toBe("shallows");
    }
    for (const status of ["answered", "landed", "dismissed"] as const) {
      const cells = groupCards(cards, columns, { places: [], requests: [request({ status })] });
      expect(ids(cells, "harbor", "shallows")).toEqual([]);
    }
  });

  it("finds the request a card shows", () => {
    const requests = [request({ status: "superseded" }), request({ requestId: "r2", status: "answered", answer: "No." })];
    expect(shownRequest("a", requests)?.requestId).toBe("r2");
    expect(shownRequest("a", [request({ status: "landed" })])).toBeNull();
    expect(shownRequest("b", requests)).toBeNull();
  });

  it("places a card locally and adds a sending request when the row changes", () => {
    const start: Overlay = { places: [{ cardId: "b", project: "reef", row: "seabed", position: 3 }], requests: [request({})] };
    const placement = { cardId: "a", title: "A", project: "harbor", fromRow: "seabed" as const, toRow: "deep" as const, order: ["b", "a"] };
    const next = placeLocally(start, placement, 9);
    expect(next.places).toEqual([
      { cardId: "b", project: "reef", row: "deep", position: 0 },
      { cardId: "a", project: "harbor", row: "deep", position: 1 },
    ]);
    expect(next.requests.map((r) => [r.cardId, r.toRow, r.status])).toEqual([["a", "deep", "sending"]]);
    const same = placeLocally(start, { ...placement, toRow: "seabed" }, 9);
    expect(same.requests).toEqual(start.requests);
  });

  it("inserts an id at a clamped index", () => {
    expect(insertAt(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(insertAt(["a", "b"], "x", 0)).toEqual(["x", "a", "b"]);
    expect(insertAt(["a", "b"], "x", 9)).toEqual(["a", "b", "x"]);
  });
});
