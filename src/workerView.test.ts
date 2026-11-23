import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROW_ORDER, type RowKey, type SourceKind, type Worker } from "./api";
import { Board } from "./components/Board";
import { WorkerTerminal } from "./components/WorkerTerminal";
import { FIXTURE_BACKLOG_CARDS, FIXTURE_BACKLOG_COLUMNS, FIXTURE_BACKLOG_WORKERS } from "./preview/fixture";
import { NO_UPDATES } from "./updates";

const ignore = () => undefined;
const rowNames = Object.fromEntries(ROW_ORDER.map((row) => [row, row])) as Record<RowKey, string>;

function backlogBoard(workers: Worker[], source: SourceKind = "fathom") {
  return renderToStaticMarkup(
    createElement(Board, {
      cards: FIXTURE_BACKLOG_CARDS,
      source,
      columns: FIXTURE_BACKLOG_COLUMNS,
      overlay: { places: [], requests: [] },
      workers: Object.fromEntries(workers.map((w) => [w.taskId, w])),
      rowNames,
      collapsedRows: [],
      agentFilter: "all",
      focus: [],
      projectsFiltered: false,
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

const cardMarkup = (html: string, id: string) => html.match(new RegExp(`<div class="card[^"]*" data-id="${id}">.*?</button></div>`))?.[0] ?? "";

describe("sailors on a Fathom backlog board", () => {
  it("puts a working and an idle sailor on the cards their workers are on", () => {
    const html = backlogBoard(FIXTURE_BACKLOG_WORKERS);
    expect(cardMarkup(html, "2")).toContain('<button class="sailor working" aria-label="A worker is working on this. Open its terminal"');
    expect(cardMarkup(html, "5")).toContain('<button class="sailor idle" aria-label="A worker is on this, idle. Open its terminal"');
    expect(html.match(/class="sailor /g)).toHaveLength(2);
  });

  it("shows no sailor without a live worker", () => {
    expect(backlogBoard([])).not.toContain('class="sailor');
  });

  it("keeps the crewmate wording on a Firstmate board", () => {
    expect(backlogBoard(FIXTURE_BACKLOG_WORKERS, "firstmate")).toContain('aria-label="A crewmate is working on this. Open its terminal"');
  });
});

function workerView(source: SourceKind, status: Worker["status"] | null) {
  return renderToStaticMarkup(
    createElement(WorkerTerminal, {
      watched: { taskId: "2", title: "Chart the north reef from the new soundings", terminal: "t3" },
      source,
      status,
      fontFamily: "monospace",
      fontSize: 13,
      theme: "light",
      onClose: ignore,
    }),
  );
}

describe("the worker view on a Fathom backlog board", () => {
  it("names the worker, its task and its terminal", () => {
    const html = workerView("fathom", "working");
    expect(html).toContain('aria-label="Worker terminal for Chart the north reef from the new soundings"');
    expect(html).toContain('<span class="sailor working" aria-hidden="true">');
    expect(html).toContain('<span class="terminal-chip">2</span><span class="terminal-chip">t3</span><span class="watch-status">working</span>');
    expect(html).toContain('aria-label="Close the worker terminal" title="Close (the worker keeps running)"');
    expect(html).toContain("Attaching to t3…");
  });

  it("says when the worker is no longer live", () => {
    expect(workerView("fathom", null)).toContain('<span class="watch-status">no longer live</span>');
  });

  it("keeps the crewmate wording for Firstmate", () => {
    expect(workerView("firstmate", "idle")).toContain('aria-label="Close the crewmate terminal" title="Close (the crewmate keeps running)"');
  });
});
