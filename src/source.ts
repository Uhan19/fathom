import type { MoveStatus, SourceKind } from "./api";

export interface MoveCopy {
  heading: string;
  body: string;
}

interface Owner {
  agent: string;
  Agent: string;
  waitsFor: string;
  tasks: string;
}

const OWNERS: Record<SourceKind, Owner> = {
  firstmate: {
    agent: "Firstmate",
    Agent: "Firstmate",
    waitsFor: "Firstmate's task list agrees",
    tasks: "Firstmate's tasks",
  },
  fathom: {
    agent: "the agent",
    Agent: "The agent",
    waitsFor: "the agent moves the task or declines",
    tasks: "The backlog tasks",
  },
};

export function moveCopy(source: SourceKind, status: MoveStatus, move: string): MoveCopy | null {
  const owner = OWNERS[source];
  switch (status) {
    case "sending":
      return { heading: `Asking ${owner.agent}`, body: `Asking ${owner.agent} to move this ${move}…` };
    case "asked":
      return {
        heading: `Asked ${owner.agent}`,
        body: `Asked ${owner.agent} to move this ${move}. The card stays there until ${owner.waitsFor}.`,
      };
    case "failed":
      return { heading: "Move not sent", body: `Could not ask ${owner.agent} to move this ${move}:` };
    case "answered":
      return { heading: `${owner.Agent} answered`, body: `You asked to move this ${move}.` };
    default:
      return null;
  }
}

export function cardMessageLabel(source: SourceKind): string {
  return `Message ${OWNERS[source].agent} about this card`;
}

export function cardMessagePrompt(source: SourceKind, connected: boolean): string {
  return connected ? `${cardMessageLabel(source)}…` : `Connect the chat panel to message ${OWNERS[source].agent}`;
}

export function projectTasks(source: SourceKind): string {
  return OWNERS[source].tasks;
}

export function emptyBoardText(source: SourceKind, home: string): string {
  return source === "fathom" ? "No tasks yet. Agents add them through Fathom's MCP server." : `No tasks yet in ${home}.`;
}
