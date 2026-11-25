import { describe, expect, it } from "vitest";
import type { Column, SourceKind } from "./api";
import { FIXTURE_CARDS, FIXTURE_COLUMNS } from "./preview/fixture";
import { shownColumns } from "./projectFilter";
import { boardTickets, listPlace, matchTickets, searchKey, type ListPlace } from "./ticketSearch";

const board = (columns: Column[] = FIXTURE_COLUMNS, source: SourceKind = "firstmate") => ({ cards: FIXTURE_CARDS, columns, places: [], requests: [], source });
const tickets = boardTickets(board());
const ids = (query: string) => matchTickets(tickets, query).map((t) => t.card.id);

describe("boardTickets", () => {
  it("lists every card on the board, including folded columns, in board order", () => {
    const folded = FIXTURE_COLUMNS.map((c) => ({ ...c, collapsed: true }));
    const all = boardTickets(board(folded));
    expect(all).toHaveLength(FIXTURE_CARDS.length);
    expect(all.slice(0, 3).map((t) => t.card.id)).toEqual(["atl-12", "atl-15", "atl-09"]);
  });

  it("shows the ticket id the way the card does", () => {
    expect(tickets.find((t) => t.card.id === "atl-12")?.ref).toBe("#40 atl-12");
    const fathom = boardTickets(board(FIXTURE_COLUMNS, "fathom"));
    expect(fathom.find((t) => t.card.id === "atl-12")?.ref).toBe("#40");
  });

  it("lists every card of a project with a column, and none from projects without one", () => {
    const [column] = FIXTURE_COLUMNS;
    const projectCards = FIXTURE_CARDS.filter((c) => c.project === column.project).map((c) => c.id);
    const listed = boardTickets(board([column])).map((t) => t.card.id);
    expect(projectCards.length).toBeGreaterThan(0);
    expect([...listed].sort()).toEqual([...projectCards].sort());
  });

  it("finds a ticket by its id in a project the board's project filter hides", () => {
    const view = board();
    expect(shownColumns(view.columns, ["atlas-api"]).map((c) => c.project)).not.toContain("harbor-web");
    expect(matchTickets(boardTickets(view), "hrb-17").map((t) => t.card.id)).toEqual(["hrb-17"]);
  });
});

describe("matchTickets", () => {
  it("matches nothing for an empty query", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
  });

  it("matches the board title without regard to case", () => {
    expect(ids("DARK MODE")).toEqual(["hrb-11"]);
  });

  it("matches the ticket id with or without its prefix", () => {
    expect(ids("hrb-17")).toEqual(["hrb-17"]);
    expect(ids("HRB-17")).toEqual(["hrb-17"]);
    expect(ids("#49")).toEqual(["hrb-17"]);
    expect(ids("49")).toEqual(["hrb-17"]);
  });

  it("narrows the list with every character typed", () => {
    const steps = ["r", "re", "ret", "retr", "retry"].map((q) => ids(q));
    steps.slice(1).forEach((step, i) => {
      expect(step.length).toBeLessThanOrEqual(steps[i].length);
      expect(step.every((id) => steps[i].includes(id))).toBe(true);
    });
    expect(steps[0].length).toBeGreaterThan(steps[4].length);
    expect(steps[4]).toEqual(["atl-12"]);
  });
});

describe("searchKey", () => {
  it("moves through the results with the arrow keys and wraps at the ends", () => {
    expect(searchKey("ArrowDown", 0, 3)).toEqual({ type: "move", active: 1 });
    expect(searchKey("ArrowDown", 2, 3)).toEqual({ type: "move", active: 0 });
    expect(searchKey("ArrowUp", 0, 3)).toEqual({ type: "move", active: 2 });
  });

  it("picks the active result with Enter", () => {
    expect(searchKey("Enter", 1, 3)).toEqual({ type: "pick", index: 1 });
  });

  it("does nothing on Enter or arrows when nothing matches", () => {
    expect(searchKey("Enter", 0, 0)).toBeNull();
    expect(searchKey("ArrowDown", 0, 0)).toBeNull();
  });

  it("closes the list with Escape and ignores other keys", () => {
    expect(searchKey("Escape", 0, 3)).toEqual({ type: "close" });
    expect(searchKey("a", 0, 3)).toBeNull();
  });
});

describe("listPlace", () => {
  type Viewport = { width: number; height: number };
  const viewport = { width: 1600, height: 1000 };

  const edges = (place: ListPlace, view: Viewport) => {
    const bottom = place.top !== undefined ? place.top + place.maxHeight : view.height - (place.bottom ?? 0);
    return { top: bottom - place.maxHeight, bottom, left: place.left, right: place.left + place.width };
  };

  const expectInside = (place: ListPlace, view: Viewport) => {
    const box = edges(place, view);
    expect(place.maxHeight).toBeGreaterThan(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(view.height);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(view.width);
  };

  it("opens the list under a field in a top header, at least as wide as the field", () => {
    const field = { left: 300, top: 18, bottom: 48, width: 360 };
    const place = listPlace(field, viewport);
    expect(place.top).toBeDefined();
    expect(edges(place, viewport).top).toBeGreaterThanOrEqual(field.bottom);
    expect(place.width).toBeGreaterThanOrEqual(field.width);
    expectInside(place, viewport);
  });

  it("opens the list above a field in a bottom header", () => {
    const field = { left: 300, top: 960, bottom: 990, width: 360 };
    const place = listPlace(field, viewport);
    expect(place.bottom).toBeDefined();
    expect(edges(place, viewport).bottom).toBeLessThanOrEqual(field.top);
    expectInside(place, viewport);
  });

  it("keeps the list inside a narrow, short window", () => {
    const view = { width: 960, height: 400 };
    const field = { left: 600, top: 18, bottom: 48, width: 300 };
    const place = listPlace(field, view);
    expect(edges(place, view).top).toBeGreaterThanOrEqual(field.bottom);
    expect(place.width).toBeGreaterThanOrEqual(field.width);
    expectInside(place, view);
  });
});
