import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROW_ORDER, type AgentFilter, type Card, type RowKey, type SourceKind, type Worker } from "./api";
import { AGENT_FILTERS, agentFilterText, noMatchText, shownByAgent, steppedFilter } from "./agentFilter";
import { AgentFilterToggle } from "./components/AgentFilterToggle";
import { insertAmongShown } from "./board";
import { Board } from "./components/Board";
import { shownColumns } from "./projectFilter";
import { FIXTURE_BACKLOG_CARDS, FIXTURE_BACKLOG_COLUMNS, FIXTURE_CARDS, FIXTURE_COLUMNS, FIXTURE_WORKERS } from "./preview/fixture";
import { NO_UPDATES } from "./updates";

const ignore = () => undefined;
const rowNames = Object.fromEntries(ROW_ORDER.map((row) => [row, row[0].toUpperCase() + row.slice(1)])) as Record<RowKey, string>;

interface BoardOptions {
  workers?: Worker[];
  agentFilter?: AgentFilter;
  collapsedRows?: RowKey[];
  projectFilter?: string[];
  cards?: Card[];
  source?: SourceKind;
  focus?: number[];
}

function board({ workers = FIXTURE_WORKERS, agentFilter = "all", collapsedRows = [], projectFilter = [], cards = FIXTURE_CARDS, source = "firstmate", focus = [] }: BoardOptions) {
  return renderToStaticMarkup(
    createElement(Board, {
      cards,
      source,
      columns: shownColumns(source === "fathom" ? FIXTURE_BACKLOG_COLUMNS : FIXTURE_COLUMNS, projectFilter),
      overlay: { places: [], requests: [] },
      workers: Object.fromEntries(workers.map((w) => [w.taskId, w])),
      rowNames,
      collapsedRows,
      agentFilter,
      focus,
      projectsFiltered: projectFilter.length > 0,
      updates: NO_UPDATES,
      selectedId: null,
      onSelect: ignore,
      onColumnChange: ignore,
      onRowCollapse: ignore,
      onShowEveryCard: ignore,
      onClearFocus: ignore,
      onColumnRename: ignore,
      onColumnMove: ignore,
      onColumnAdd: ignore,
      onColumnDelete: async () => undefined,
      onPlace: ignore,
      onWatch: ignore,
    }),
  );
}

const shownCards = (html: string) => [...html.matchAll(/<div class="card[^"]*" data-id="([^"]+)"/g)].map((m) => m[1]).sort();
const rowMarkup = (html: string, row: RowKey) => html.match(new RegExp(`<section class="row row-${row}[^"]*".*?</section>`))?.[0] ?? "";

describe("shownByAgent", () => {
  const working: Worker = { taskId: "a", terminal: "t1", status: "working" };
  const idle: Worker = { taskId: "b", terminal: "t2", status: "idle" };

  it("keeps every card, cards with a sailor, or cards whose sailor's visor glows", () => {
    expect([undefined, idle, working].map((w) => shownByAgent(w, "all"))).toEqual([true, true, true]);
    expect([undefined, idle, working].map((w) => shownByAgent(w, "withAgent"))).toEqual([false, true, true]);
    expect([undefined, idle, working].map((w) => shownByAgent(w, "withActiveAgent"))).toEqual([false, false, true]);
  });
});

describe("the agent filter on the board", () => {
  it("shows every card by default", () => {
    expect(shownCards(board({}))).toHaveLength(FIXTURE_CARDS.length);
  });

  it("shows only the cards with an agent, idle or working", () => {
    expect(shownCards(board({ agentFilter: "withAgent" }))).toEqual(["atl-09", "hrb-16", "hrb-18", "pil-08"]);
  });

  it("shows only the cards with an active agent", () => {
    expect(shownCards(board({ agentFilter: "withActiveAgent" }))).toEqual(["atl-09", "hrb-16"]);
  });

  it("uses the same workers on Fathom's own backlog", () => {
    const backlog = (agentFilter: AgentFilter) =>
      shownCards(board({ agentFilter, cards: FIXTURE_BACKLOG_CARDS, source: "fathom", workers: [{ taskId: "2", terminal: "t3", status: "working" }, { taskId: "5", terminal: "t4", status: "idle" }] }));
    expect(backlog("withAgent")).toEqual(["2", "5"]);
    expect(backlog("withActiveAgent")).toEqual(["2"]);
  });

  it("combines with the project filter", () => {
    expect(shownCards(board({ agentFilter: "withAgent", projectFilter: ["harbor-web", "pilot-infra"] }))).toEqual(["hrb-16", "hrb-18", "pil-08"]);
    expect(shownCards(board({ agentFilter: "withActiveAgent", projectFilter: ["atlas-api"] }))).toEqual(["atl-09"]);
  });

  it("follows the agents as they start, stop and change status", () => {
    const later: Worker[] = [
      { taskId: "atl-09", terminal: "t3", status: "idle" },
      { taskId: "hrb-18", terminal: "t4", status: "working" },
      { taskId: "kel-07", terminal: "t9", status: "working" },
    ];
    expect(shownCards(board({ agentFilter: "withActiveAgent", workers: later }))).toEqual(["hrb-18", "kel-07"]);
    expect(shownCards(board({ agentFilter: "withAgent", workers: later }))).toEqual(["atl-09", "hrb-18", "kel-07"]);
  });

  it("counts only the shown cards in each column", () => {
    expect(board({ agentFilter: "withAgent" })).toContain('<span class="column-total">2</span>');
  });

  it("says so when no card matches instead of showing an empty board", () => {
    const html = board({ agentFilter: "withActiveAgent", workers: [] });
    expect(html).toContain("No card has an active agent right now.");
    expect(html).toContain('<button class="mini">Show every card</button>');
    expect(html).not.toContain('class="column-heads"');
    expect(board({ agentFilter: "withAgent", projectFilter: ["keel-cli"] })).toContain("No card in the shown projects has an agent right now.");
  });

  it("does not call a board empty when its only matches sit in a collapsed row", () => {
    const html = board({ agentFilter: "withActiveAgent", collapsedRows: ["shallows"] });
    expect(html).not.toContain("board-no-match");
    expect(rowMarkup(html, "shallows")).toContain('<span class="row-count">2</span>');
  });
});

const numberOf = (id: string) => FIXTURE_CARDS.find((c) => c.id === id)?.number ?? 0;
const shownColumnNames = (html: string) => [...html.matchAll(/title="Rename ([^"]+)"/g)].map((m) => m[1]);

describe("the focus on the board", () => {
  it("shows only the focused cards and the columns that hold them", () => {
    const html = board({ focus: [numberOf("hrb-17"), numberOf("pil-08"), numberOf("lan-31")] });
    expect(shownCards(html)).toEqual(["hrb-17", "lan-31", "pil-08"]);
    expect(shownColumnNames(html)).toEqual(["harbor-web", "lantern-docs", "pilot-infra"]);
  });

  it("finds Fathom's own tasks by number too", () => {
    const backlog = FIXTURE_BACKLOG_CARDS.slice(1, 3);
    const html = board({ cards: FIXTURE_BACKLOG_CARDS, source: "fathom", focus: backlog.map((c) => c.number ?? 0) });
    expect(shownCards(html)).toEqual(backlog.map((c) => c.id).sort());
  });

  it("combines with the agent filter", () => {
    const focus = [numberOf("hrb-16"), numberOf("hrb-17")];
    expect(shownCards(board({ focus, agentFilter: "withAgent" }))).toEqual(["hrb-16"]);
    expect(board({ focus: [numberOf("hrb-17")], agentFilter: "withAgent" })).toContain("No focused task has an agent right now.");
  });

  it("offers a way back when none of the focused tasks is on the board", () => {
    const html = board({ focus: [9999] });
    expect(html).toContain("None of the focused tasks is on the board.");
    expect(html).toContain('<button class="mini">Clear focus</button>');
    expect(html).not.toContain('class="column-heads"');
    expect(board({ focus: [numberOf("hrb-17")], projectFilter: ["atlas-api"] })).toContain("None of the focused tasks is in the shown projects.");
  });
});

describe("task numbers on cards", () => {
  it("show the number, then the Firstmate name, above the title", () => {
    expect(board({})).toContain(`<span class="card-ref"><span class="card-number">#${numberOf("hrb-17")}</span><span class="card-name">hrb-17</span></span>`);
  });

  it("show only the number on Fathom's own tasks", () => {
    const html = board({ cards: FIXTURE_BACKLOG_CARDS, source: "fathom" });
    expect(html).toContain(`<span class="card-ref"><span class="card-number">#${FIXTURE_BACKLOG_CARDS[0].number}</span></span>`);
    expect(html).not.toContain("card-name");
  });
});

describe("collapsed rows", () => {
  it("shrink to a band with the row's name and card count", () => {
    const html = board({ collapsedRows: ["deep", "landed"] });
    const deep = rowMarkup(html, "deep");
    expect(deep).toContain('class="row row-deep row-collapsed"');
    expect(deep).toContain('aria-expanded="false" aria-label="Expand Deep, 9 cards" title="Expand Deep"');
    expect(deep).toContain('<span class="row-label">Deep</span><span class="row-count">9</span>');
    expect(deep).not.toContain('class="card');
    expect(rowMarkup(html, "landed")).toContain('<span class="row-count">9</span>');
  });

  it("stay drop targets that take a card at the end of the cell", () => {
    const deep = rowMarkup(board({ collapsedRows: ["deep"] }), "deep");
    expect(deep.match(/data-collapsed="true"/g)).toHaveLength(FIXTURE_COLUMNS.length);
  });

  it("leave the other rows open, with the last open row filling the board", () => {
    const html = board({ collapsedRows: ["landed"] });
    const shallows = rowMarkup(html, "shallows");
    expect(shallows).toContain('aria-expanded="true" aria-label="Collapse Shallows" title="Collapse Shallows"');
    expect(shallows).not.toContain("row-count");
    expect(rowMarkup(html, "seabed")).toContain('class="row row-seabed row-fill"');
    expect(rowMarkup(board({}), "landed")).toContain('class="row row-landed row-fill"');
  });

  it("count only the cards the filters show", () => {
    const html = board({ collapsedRows: ["shallows"], agentFilter: "withAgent", projectFilter: ["harbor-web"] });
    expect(rowMarkup(html, "shallows")).toContain('<span class="row-count">2</span>');
  });
});

describe("placing a card while the agent filter hides some", () => {
  it("lands next to the shown card it was dropped by and keeps hidden cards in place", () => {
    const all = ["a", "hidden1", "b", "hidden2", "c"];
    const shown = ["a", "b", "c"];
    expect(insertAmongShown(all, shown, "x", 0)).toEqual(["x", "a", "hidden1", "b", "hidden2", "c"]);
    expect(insertAmongShown(all, shown, "x", 2)).toEqual(["a", "hidden1", "b", "hidden2", "x", "c"]);
    expect(insertAmongShown(all, shown, "x", 3)).toEqual(["a", "hidden1", "b", "hidden2", "c", "x"]);
    expect(insertAmongShown(all, shown, "a", 2)).toEqual(["hidden1", "b", "hidden2", "c", "a"]);
    expect(insertAmongShown(all, shown, "c", 0)).toEqual(["c", "a", "hidden1", "b", "hidden2"]);
  });

  it("matches a plain insert when nothing is hidden", () => {
    const ids = ["a", "b", "c"];
    expect(insertAmongShown(ids, ids, "a", 2)).toEqual(["b", "c", "a"]);
    expect(insertAmongShown(ids, ids, "x", Number.MAX_SAFE_INTEGER)).toEqual(["a", "b", "c", "x"]);
    expect(insertAmongShown([], [], "x", 0)).toEqual(["x"]);
  });
});

describe("filter wording", () => {
  it("names the filter in the strip", () => {
    expect(agentFilterText("withAgent")).toBe("Showing only cards with an agent.");
    expect(agentFilterText("withActiveAgent")).toBe("Showing only cards with an active agent.");
  });

  it("names the shown projects in the empty message only when they are filtered", () => {
    expect(noMatchText("withAgent", false)).toBe("No card has an agent right now.");
    expect(noMatchText("withActiveAgent", true)).toBe("No card in the shown projects has an active agent right now.");
  });
});

describe("AgentFilterToggle", () => {
  const toggle = (filter: AgentFilter) => renderToStaticMarkup(createElement(AgentFilterToggle, { filter, disabled: false, onChange: ignore }));

  it("offers all three choices as one radio group with the chosen one checked", () => {
    const html = toggle("withAgent");
    expect(html).toContain('role="radiogroup" aria-label="Cards by agent"');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*>Agent</);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it("slides the highlight under the chosen choice", () => {
    expect(toggle("withActiveAgent")).toContain("--selected:2");
  });
});

describe("steppedFilter", () => {
  it("moves with the arrow keys and wraps around the ends", () => {
    expect(steppedFilter("all", "ArrowRight")).toBe("withAgent");
    expect(steppedFilter("withActiveAgent", "ArrowRight")).toBe("all");
    expect(steppedFilter("all", "ArrowLeft")).toBe("withActiveAgent");
    expect(steppedFilter("withAgent", "ArrowUp")).toBe("all");
  });

  it("jumps to the first and last choice with Home and End", () => {
    expect(steppedFilter("withAgent", "Home")).toBe(AGENT_FILTERS[0]);
    expect(steppedFilter("all", "End")).toBe(AGENT_FILTERS[AGENT_FILTERS.length - 1]);
  });

  it("ignores other keys", () => {
    expect(steppedFilter("all", "Enter")).toBeNull();
  });
});
