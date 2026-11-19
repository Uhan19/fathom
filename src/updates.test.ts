import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROW_ORDER, type Card, type Column, type RowKey } from "./api";
import { groupCards } from "./board";
import { Board } from "./components/Board";
import { FIXTURE_CARDS, FIXTURE_COLUMNS, fixtureUpdates } from "./preview/fixture";
import { columnHasUnseen, isUnseen, leftCard, NO_UPDATES, rowHasUnseen, seenLocally, type CardUpdates } from "./updates";

const ignore = () => undefined;
const rowNames = Object.fromEntries(ROW_ORDER.map((row) => [row, row])) as Record<RowKey, string>;
const PILOT = FIXTURE_COLUMNS.find((c) => c.project === "pilot-infra")!;
const KEEL = FIXTURE_COLUMNS.find((c) => c.project === "keel-cli")!;

function board(updates: CardUpdates, folded: string[] = [], collapsedRows: RowKey[] = [], cards: Card[] = FIXTURE_CARDS) {
  const columns: Column[] = FIXTURE_COLUMNS.map((c) => ({ ...c, collapsed: folded.includes(c.name) }));
  return renderToStaticMarkup(
    createElement(Board, {
      cards,
      source: "firstmate",
      columns,
      overlay: { places: [], requests: [] },
      workers: {},
      updates,
      rowNames,
      collapsedRows,
      agentFilter: "all",
      projectsFiltered: false,
      selectedId: null,
      onSelect: ignore,
      onColumnChange: ignore,
      onRowCollapse: ignore,
      onShowEveryCard: ignore,
      onColumnRename: ignore,
      onColumnMove: ignore,
      onColumnAdd: ignore,
      onColumnDelete: async () => undefined,
      onPlace: ignore,
      onWatch: ignore,
    }),
  );
}

const litCards = (html: string) => [...html.matchAll(/<div class="card [^"]*\bunseen\b[^"]*" data-id="([^"]+)"/g)].map((m) => m[1]).sort();
const litRows = (html: string) => [...html.matchAll(/<section class="row row-(\w+) row-collapsed unseen/g)].map((m) => m[1]);
const litHeads = (html: string) => [...html.matchAll(/<div class="column-head collapsed unseen[^"]*" data-column="(\d+)"/g)].map((m) => Number(m[1]));

describe("isUnseen", () => {
  it("lights a card whose latest update differs from the one last seen", () => {
    const updates: CardUpdates = { marks: { a: "2 done", b: "1 working", c: "3 blocked" }, seen: { a: "1 working", b: "1 working" } };
    expect(["a", "b", "c", "d"].map((id) => isUnseen(updates, id))).toEqual([true, false, true, false]);
  });

  it("lights nothing when every update is already seen, as after the first launch", () => {
    const baseline = fixtureUpdates(false);
    expect(Object.keys(baseline.marks).length).toBeGreaterThan(0);
    expect(Object.keys(baseline.marks).filter((id) => isUnseen(baseline, id))).toEqual([]);
    expect(litCards(board(baseline))).toEqual([]);
  });
});

describe("seenLocally", () => {
  it("records the current update as seen and leaves the rest lit", () => {
    const updates = fixtureUpdates(true);
    const after = seenLocally(updates, "hrb-18");
    expect(isUnseen(after, "hrb-18")).toBe(false);
    expect(isUnseen(after, "pil-08")).toBe(true);
    expect(seenLocally(after, "hrb-18")).toBe(after);
    expect(seenLocally(after, "atl-09")).toBe(after);
  });

  it("lights the card again when a newer update arrives", () => {
    const seen = seenLocally(fixtureUpdates(true), "hrb-18");
    const newer = { ...seen, marks: { ...seen.marks, "hrb-18": "5 working [at=1795101000]: kept the old date picker" } };
    expect(isUnseen(newer, "hrb-18")).toBe(true);
  });
});

describe("leftCard", () => {
  it("names the card whose detail closed or was swapped for another", () => {
    expect(leftCard("a", null)).toBe("a");
    expect(leftCard("a", "b")).toBe("a");
    expect(leftCard("a", "a")).toBeNull();
    expect(leftCard(null, "a")).toBeNull();
  });
});

describe("the board", () => {
  it("lights only the cards with an unseen update", () => {
    expect(litCards(board(fixtureUpdates(true)))).toEqual(["atl-04", "atl-15", "hrb-18", "lan-31", "pil-08"]);
    expect(litCards(board(NO_UPDATES))).toEqual([]);
  });

  it("marks a lit card for screen readers", () => {
    const html = board(fixtureUpdates(true));
    const card = html.match(/<div class="card [^"]*" data-id="pil-08".*?<\/button>/)?.[0] ?? "";
    expect(card).toContain('<span class="sr-only">New update</span>');
  });

  it("lights a collapsed column's header while it holds an unseen card", () => {
    const updates = fixtureUpdates(true);
    const html = board(updates, ["pilot-infra", "keel-cli"]);
    expect(litHeads(html)).toEqual([PILOT.id]);
    expect(html).toContain(`aria-label="Expand pilot-infra, it has a new update"`);
    expect(html).toContain(`aria-label="Expand keel-cli"`);
    expect(columnHasUnseen(groupCards(FIXTURE_CARDS, FIXTURE_COLUMNS), KEEL.id, updates)).toBe(false);
  });

  it("does not light an open column's header", () => {
    expect(litHeads(board(fixtureUpdates(true)))).toEqual([]);
  });

  it("turns the collapsed header dark once every unseen card in it is seen", () => {
    const harbor = FIXTURE_COLUMNS.find((c) => c.project === "harbor-web")!;
    const lan = FIXTURE_COLUMNS.find((c) => c.project === "lantern-docs")!;
    const updates = { ...fixtureUpdates(true), marks: { ...fixtureUpdates(true).marks, "hrb-16": "1 working [at=1795100900]: setup done" } };
    const folded = ["harbor-web", "lantern-docs"];
    expect(litHeads(board(updates, folded))).toEqual([harbor.id, lan.id]);
    const oneSeen = seenLocally(updates, "hrb-18");
    expect(litHeads(board(oneSeen, folded))).toEqual([harbor.id, lan.id]);
    const bothSeen = seenLocally(oneSeen, "hrb-16");
    expect(litHeads(board(bothSeen, folded))).toEqual([lan.id]);
    expect(litCards(board(bothSeen))).toEqual(["atl-04", "atl-15", "lan-31", "pil-08"]);
  });

  it("lights a collapsed row's band while it holds an unseen card", () => {
    const updates = fixtureUpdates(true);
    const html = board(updates, [], ["shallows", "landed"]);
    expect(litRows(html)).toEqual(["shallows"]);
    expect(html).toContain(`aria-label="Expand shallows, 6 cards, it has a new update"`);
    expect(html).toContain(`aria-label="Expand landed, 9 cards"`);
    expect(rowHasUnseen(groupCards(FIXTURE_CARDS, FIXTURE_COLUMNS), "landed", updates)).toBe(false);
  });

  it("does not light an open row", () => {
    expect(litRows(board(fixtureUpdates(true)))).toEqual([]);
  });

  it("counts a card in a collapsed column toward its collapsed row", () => {
    const html = board(fixtureUpdates(true), ["pilot-infra"], ["shallows"]);
    expect(litRows(html)).toEqual(["shallows"]);
    expect(litHeads(html)).toEqual([PILOT.id]);
  });

  it("turns the collapsed row's band dark once every unseen card in it is seen", () => {
    const rows: RowKey[] = ["shallows"];
    let updates = fixtureUpdates(true);
    for (const id of ["hrb-18", "lan-31"]) {
      updates = seenLocally(updates, id);
      expect(litRows(board(updates, [], rows))).toEqual(["shallows"]);
    }
    updates = seenLocally(updates, "pil-08");
    expect(litRows(board(updates, [], rows))).toEqual([]);
  });
});
