import { describe, expect, it } from "vitest";
import type { Card, Column, MoveRequest, Overlay } from "./api";
import {
  boardMinWidth,
  cardMessage,
  cardNote,
  cellCount,
  columnTemplate,
  formatBytes,
  groupCards,
  headTemplate,
  holdHeading,
  insertAt,
  linkLabel,
  outcomeTag,
  renamedColumn,
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

const ids = (cells: ReturnType<typeof groupCards>, column: number, row: Card["row"]) =>
  cells.get(column)?.get(row)?.map((c) => c.id);

const [HARBOR, REEF, LATER] = [1, 2, 3];

const column = (id: number, project: string | null, over: Partial<Column> = {}): Column => ({
  id,
  project,
  name: project ?? "Later",
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
      [column(HARBOR, "harbor"), column(REEF, "reef")],
    );
    expect(ids(cells, HARBOR, "landed")).toEqual(["b", "a"]);
    expect(ids(cells, REEF, "surface")).toEqual(["c"]);
    expect(cellCount(cells, HARBOR) + cellCount(cells, REEF)).toBe(3);
  });

  it("counts cards per row", () => {
    const counts = rowCounts([card({ row: "surface" }), card({ row: "surface" }), card({ row: "deep" })]);
    expect(counts).toEqual({ surface: 2, shallows: 0, deep: 1, seabed: 0, landed: 0 });
  });

  it("builds the grid template with collapsed columns", () => {
    const columns = [column(1, "a"), column(2, "b", { collapsed: true })];
    expect(columnTemplate(columns)).toBe("150px 280px 44px");
    expect(headTemplate(columns)).toBe("150px 280px 44px 180px");
    expect(boardMinWidth(columns)).toBe(150 + 180 + 10 + 32 + 290 + 54);
  });

  it("notes what a queued card waits for and a deferred date", () => {
    expect(cardNote(card({ blockedBy: ["tide-gauge"] }))).toBe("Waits for tide-gauge");
    expect(cardNote(card({ row: "deep", holdKind: "captain", holdUntil: "2026-12-01" }))).toBe("Until 2026-12-01");
    expect(cardNote(card({ row: "shallows" }))).toBeNull();
  });

  it("tags finished scouts as reported, not finished ships or open scouts", () => {
    expect(outcomeTag(card({ row: "landed", kind: "scout" }))).toBe("Reported");
    expect(outcomeTag(card({ row: "landed", kind: "ship" }))).toBeNull();
    expect(outcomeTag(card({ row: "shallows", kind: "scout" }))).toBeNull();
  });

  it("drops the reported tag while a finished scout is shown moving out of landed", () => {
    const scout = card({ id: "tide-survey", row: "landed", kind: "scout" });
    const request: MoveRequest = {
      requestId: "fathom-move-tide-survey-1",
      cardId: "tide-survey",
      title: scout.title,
      fromRow: "landed",
      toRow: "shallows",
      createdMs: 1,
      status: "asked",
      noteId: null,
      answer: null,
      error: null,
    };
    const shown = groupCards([scout], [column(HARBOR, "harbor")], { places: [], requests: [request] }).get(HARBOR)?.get("shallows")?.[0];
    expect(shown && outcomeTag(shown)).toBeNull();
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
  const columns = [column(HARBOR, "harbor"), column(REEF, "reef")];
  const cards = [card({ id: "a" }), card({ id: "b" }), card({ id: "c" }), card({ id: "d", project: "reef" })];

  it("orders placed cards after unplaced ones in their saved order", () => {
    const overlay: Overlay = {
      places: [
        { cardId: "a", column: null, row: "seabed", position: 1 },
        { cardId: "b", column: null, row: "seabed", position: 0 },
      ],
      requests: [],
    };
    expect(ids(groupCards(cards, columns, overlay), HARBOR, "seabed")).toEqual(["c", "b", "a"]);
  });

  it("moves a card to its chosen column and ignores unknown columns", () => {
    const overlay: Overlay = {
      places: [
        { cardId: "a", column: REEF, row: "seabed", position: 0 },
        { cardId: "b", column: 99, row: "seabed", position: 0 },
      ],
      requests: [],
    };
    const cells = groupCards(cards, columns, overlay);
    expect(ids(cells, REEF, "seabed")).toEqual(["d", "a"]);
    expect(ids(cells, HARBOR, "seabed")).toEqual(["c", "b"]);
    expect(cells.get(REEF)?.get("seabed")?.[1].project).toBe("harbor");
  });

  it("shows cards in an added column and sends them home once it is gone", () => {
    const overlay: Overlay = {
      places: [
        { cardId: "a", column: LATER, row: "seabed", position: 0 },
        { cardId: "d", column: LATER, row: "seabed", position: 1 },
      ],
      requests: [],
    };
    const withLater = groupCards(cards, [...columns, column(LATER, null)], overlay);
    expect(ids(withLater, LATER, "seabed")).toEqual(["a", "d"]);
    expect(cellCount(withLater, LATER)).toBe(2);
    expect(cellCount(withLater, REEF)).toBe(0);
    const without = groupCards(cards, columns, overlay);
    expect(ids(without, HARBOR, "seabed")).toEqual(["b", "c", "a"]);
    expect(ids(without, REEF, "seabed")).toEqual(["d"]);
  });

  it("leaves out a card whose project column was deleted until it comes back", () => {
    const cells = groupCards(cards, [column(HARBOR, "harbor"), column(LATER, null)]);
    expect(cellCount(cells, HARBOR)).toBe(3);
    expect(cellCount(cells, LATER)).toBe(0);
  });

  it("shows a card in the asked row until the request settles", () => {
    for (const status of ["sending", "asked", "failed"] as const) {
      const cells = groupCards(cards, columns, { places: [], requests: [request({ status })] });
      expect(ids(cells, HARBOR, "shallows")).toEqual(["a"]);
      expect(cells.get(HARBOR)?.get("shallows")?.[0].row).toBe("shallows");
    }
    for (const status of ["answered", "landed", "dismissed"] as const) {
      const cells = groupCards(cards, columns, { places: [], requests: [request({ status })] });
      expect(ids(cells, HARBOR, "shallows")).toEqual([]);
    }
  });

  it("finds the request a card shows", () => {
    const requests = [request({ status: "superseded" }), request({ requestId: "r2", status: "answered", answer: "No." })];
    expect(shownRequest("a", requests)?.requestId).toBe("r2");
    expect(shownRequest("a", [request({ status: "landed" })])).toBeNull();
    expect(shownRequest("b", requests)).toBeNull();
  });

  it("places a card locally and adds a sending request when the row changes", () => {
    const start: Overlay = { places: [{ cardId: "b", column: REEF, row: "seabed", position: 3 }], requests: [request({})] };
    const placement = { cardId: "a", title: "A", column: HARBOR, fromRow: "seabed" as const, toRow: "deep" as const, order: ["b", "a"] };
    const next = placeLocally(start, placement, 9);
    expect(next.places).toEqual([
      { cardId: "b", column: REEF, row: "deep", position: 0 },
      { cardId: "a", column: HARBOR, row: "deep", position: 1 },
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

describe("renaming a column", () => {
  const column = { project: "harbor-web", name: "harbor-web" };

  it("saves a trimmed new name", () => {
    expect(renamedColumn(column, "  Harbor web ")).toBe("Harbor web");
  });

  it("returns an empty name to the project's own name", () => {
    expect(renamedColumn({ ...column, name: "Harbor web" }, "   ")).toBe("harbor-web");
  });

  it("saves nothing when the name is unchanged", () => {
    expect(renamedColumn(column, "harbor-web ")).toBeNull();
    expect(renamedColumn(column, "")).toBeNull();
  });

  it("keeps an added column's name when the input is emptied", () => {
    const added = { project: null, name: "This week" };
    expect(renamedColumn(added, "  ")).toBeNull();
    expect(renamedColumn(added, " Next week ")).toBe("Next week");
  });

  it("names a column that has no name", () => {
    expect(renamedColumn({ project: "", name: "" }, " Odd jobs ")).toBe("Odd jobs");
    expect(renamedColumn({ project: null, name: "  " }, "Odd jobs")).toBe("Odd jobs");
    expect(renamedColumn({ project: "", name: "" }, "  ")).toBeNull();
  });
});
