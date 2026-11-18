import { describe, expect, it } from "vitest";
import type { Card, Column } from "./api";
import { rowCounts } from "./board";
import { moveTo } from "./columnOrder";
import { filterText, indexAmongAll, shownColumns } from "./projectFilter";

const column = (id: number, project: string | null): Column => ({ id, project, name: project ?? "Later", position: id, width: 260, collapsed: false });
const card = (id: string, project: string, row: Card["row"]): Card => ({
  id,
  title: id,
  state: "queued",
  kind: "ship",
  project,
  row,
  holdKind: "",
  holdUntil: "",
  holdReason: "",
  blockedBy: [],
  links: [],
  closed: "",
});

const HARBOR = column(1, "harbor-web");
const KEEL = column(2, "keel-cli");
const ATLAS = column(3, "atlas-api");
const LATER = column(4, null);
const ALL = [HARBOR, KEEL, ATLAS, LATER];

describe("shownColumns", () => {
  it("shows every column without a filter", () => {
    expect(shownColumns(ALL, [])).toBe(ALL);
  });

  it("shows only the chosen projects in board order", () => {
    expect(shownColumns(ALL, ["atlas-api", "harbor-web"]).map((c) => c.id)).toEqual([1, 3]);
  });

  it("hides the catch-all column while a filter is on", () => {
    expect(shownColumns(ALL, ["keel-cli"]).map((c) => c.project)).toEqual(["keel-cli"]);
  });

  it("shows nothing for a project without a column", () => {
    expect(shownColumns(ALL, ["lighthouse"])).toEqual([]);
  });
});

describe("filterText", () => {
  it("names one, two or more projects", () => {
    expect(filterText(["keel-cli"])).toBe("Showing only keel-cli.");
    expect(filterText(["keel-cli", "atlas-api"])).toBe("Showing only keel-cli and atlas-api.");
    expect(filterText(["keel-cli", "atlas-api", "harbor-web"])).toBe("Showing only keel-cli, atlas-api and harbor-web.");
  });
});

describe("header counts under a filter", () => {
  it("keep counting the cards of hidden projects", () => {
    const cards = [card("a", "harbor-web", "surface"), card("b", "keel-cli", "surface"), card("c", "atlas-api", "shallows")];
    const shown = new Set(shownColumns(ALL, ["harbor-web"]).map((c) => c.project));
    expect(cards.filter((c) => shown.has(c.project))).toHaveLength(1);
    expect(rowCounts(cards)).toMatchObject({ surface: 2, shallows: 1 });
  });
});

describe("indexAmongAll", () => {
  it("is the plain index without a filter", () => {
    expect(indexAmongAll(ALL, ALL, 1, 2)).toBe(2);
  });

  it("moves a shown column past another shown column without crossing hidden ones", () => {
    const shown = shownColumns(ALL, ["harbor-web", "atlas-api"]);
    expect(indexAmongAll(ALL, shown, HARBOR.id, 1)).toBe(2);
    expect(indexAmongAll(ALL, shown, ATLAS.id, 0)).toBe(0);
  });

  it("gives the shown columns the new order and keeps the hidden ones in theirs", () => {
    const shown = shownColumns(ALL, ["harbor-web", "atlas-api"]);
    const after = moveTo(ALL, ATLAS.id, indexAmongAll(ALL, shown, ATLAS.id, 0));
    expect(shownColumns(after, ["harbor-web", "atlas-api"]).map((c) => c.id)).toEqual([3, 1]);
    expect(after.filter((c) => !shown.includes(c)).map((c) => c.id)).toEqual([2, 4]);
  });
});
