import { describe, expect, it } from "vitest";
import { FIXTURE_CARDS, FIXTURE_COLUMNS } from "./preview/fixture";
import { boardTickets, listPlace, matchTickets, searchKey } from "./ticketSearch";

const NO_OVERLAY = { places: [], requests: [] };
const tickets = boardTickets(FIXTURE_CARDS, FIXTURE_COLUMNS, NO_OVERLAY, "firstmate");
const ids = (query: string) => matchTickets(tickets, query).map((t) => t.card.id);

describe("boardTickets", () => {
  it("lists every card on the board, including folded columns, in board order", () => {
    const folded = FIXTURE_COLUMNS.map((c) => ({ ...c, collapsed: true }));
    const all = boardTickets(FIXTURE_CARDS, folded, NO_OVERLAY, "firstmate");
    expect(all).toHaveLength(FIXTURE_CARDS.length);
    expect(all.slice(0, 3).map((t) => t.card.id)).toEqual(["atl-12", "atl-15", "atl-09"]);
  });

  it("shows the ticket id the way the card does", () => {
    expect(tickets.find((t) => t.card.id === "atl-12")?.ref).toBe("#40 atl-12");
    const fathom = boardTickets(FIXTURE_CARDS, FIXTURE_COLUMNS, NO_OVERLAY, "fathom");
    expect(fathom.find((t) => t.card.id === "atl-12")?.ref).toBe("#40");
  });

  it("leaves out cards whose project has no column on the board", () => {
    const one = boardTickets(FIXTURE_CARDS, FIXTURE_COLUMNS.slice(0, 1), NO_OVERLAY, "firstmate");
    expect(one.every((t) => t.card.project === FIXTURE_COLUMNS[0].project)).toBe(true);
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

  it("lists id matches before title matches", () => {
    const [first, second] = FIXTURE_CARDS;
    const mixed = [
      { card: { ...first, title: "Retire the v80 client" }, ref: "#40 atl-12" },
      { card: second, ref: "#80 atl-15" },
    ];
    expect(matchTickets(mixed, "80").map((t) => t.card.id)).toEqual(["atl-15", "atl-12"]);
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
  const viewport = { width: 1600, height: 1000 };

  it("opens the list under a field in a top header, at least as wide as a result line", () => {
    expect(listPlace({ left: 300, top: 18, bottom: 48, width: 360 }, viewport)).toEqual({ left: 300, width: 440, maxHeight: 420, top: 54 });
  });

  it("opens the list above a field in a bottom header", () => {
    expect(listPlace({ left: 300, top: 960, bottom: 990, width: 360 }, viewport)).toEqual({ left: 300, width: 440, maxHeight: 420, bottom: 46 });
  });

  it("keeps the list inside a narrow window", () => {
    const place = listPlace({ left: 600, top: 18, bottom: 48, width: 300 }, { width: 960, height: 400 });
    expect(place.left + place.width).toBeLessThanOrEqual(960 - 12);
    expect(place.maxHeight).toBe(400 - 48 - 6 - 12);
  });
});
