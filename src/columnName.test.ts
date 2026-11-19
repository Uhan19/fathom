import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROW_ORDER, type Column, type RowKey } from "./api";
import { Board } from "./components/Board";
import { FIXTURE_UNFILED_CARDS, FIXTURE_UNFILED_COLUMNS } from "./preview/fixture";

const ignore = () => undefined;
const rowNames = Object.fromEntries(ROW_ORDER.map((row) => [row, row])) as Record<RowKey, string>;

function header(columns: Column[]) {
  return renderToStaticMarkup(
    createElement(Board, {
      cards: FIXTURE_UNFILED_CARDS,
      source: "firstmate",
      columns,
      overlay: { places: [], requests: [] },
      workers: {},
      rowNames,
      selectedId: null,
      onSelect: ignore,
      onColumnChange: ignore,
      onColumnRename: ignore,
      onColumnMove: ignore,
      onColumnAdd: ignore,
      onColumnDelete: async () => undefined,
      onPlace: ignore,
      onWatch: ignore,
    }),
  );
}

const renameButtons = (html: string) => [...html.matchAll(/<button class="column-name[" ][^>]*>.*?<\/button>/g)].map((m) => m[0]);

describe("a column without a name", () => {
  it("comes from cards that have no project", () => {
    expect(FIXTURE_UNFILED_COLUMNS[0]).toMatchObject({ project: "", name: "" });
  });

  it("still shows a rename button with something to click", () => {
    const [nameless, named] = renameButtons(header(FIXTURE_UNFILED_COLUMNS));
    expect(nameless).toBe('<button class="column-name unnamed" title="Rename this unnamed column">Unnamed</button>');
    expect(named).toContain(">atlas-api</button>");
  });

  it("treats a whitespace-only name as no name", () => {
    const blank = FIXTURE_UNFILED_COLUMNS.map((c, i) => (i === 0 ? { ...c, project: null, name: "   " } : c));
    expect(renameButtons(header(blank))[0]).toContain(">Unnamed</button>");
  });
});
