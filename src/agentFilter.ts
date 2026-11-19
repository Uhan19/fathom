import { ROW_ORDER, type AgentFilter, type Card, type Worker } from "./api";
import type { Cells } from "./board";

export const AGENT_FILTERS: AgentFilter[] = ["all", "withAgent", "withActiveAgent"];

export const AGENT_FILTER_LABEL: Record<AgentFilter, string> = {
  all: "All",
  withAgent: "Agent",
  withActiveAgent: "Active",
};

export const AGENT_FILTER_TITLE: Record<AgentFilter, string> = {
  all: "Show every card",
  withAgent: "Show only cards with an agent",
  withActiveAgent: "Show only cards with an active agent",
};

const WHAT: Record<AgentFilter, string> = {
  all: "",
  withAgent: "an agent",
  withActiveAgent: "an active agent",
};

export function shownByAgent(worker: Worker | undefined, filter: AgentFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "withAgent":
      return worker !== undefined;
    case "withActiveAgent":
      return worker?.status === "working";
  }
}

export function keepCards(cells: Cells, keep: (card: Card) => boolean): Cells {
  const kept: Cells = new Map();
  for (const [column, rows] of cells) kept.set(column, new Map(ROW_ORDER.map((row) => [row, (rows.get(row) ?? []).filter(keep)])));
  return kept;
}

export function anyCard(cells: Cells): boolean {
  for (const rows of cells.values()) for (const here of rows.values()) if (here.length > 0) return true;
  return false;
}

export function agentFilterText(filter: AgentFilter): string {
  return `Showing only cards with ${WHAT[filter]}.`;
}

export function noMatchText(filter: AgentFilter, projectsFiltered: boolean): string {
  const where = projectsFiltered ? " in the shown projects" : "";
  return `No card${where} has ${WHAT[filter]} right now.`;
}
