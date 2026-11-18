import { errorText, type SourceKind, type Terminal } from "./api";

export type AgentKey = "claude" | "codex" | "firstmate";

interface AgentInfo {
  name: string;
  program: string;
}

export const AGENTS: Record<AgentKey, AgentInfo> = {
  claude: { name: "Claude Code", program: "claude" },
  codex: { name: "Codex", program: "codex" },
  firstmate: { name: "Firstmate", program: "claude" },
};

export const AGENT_LABEL = "fathom.agent";
const HERDR_CORE = "herdr-core";
const GENERIC_TITLE = "Agent";

const isAgent = (key: string | null | undefined): key is AgentKey => !!key && key in AGENTS;

export function agentChoices(source: SourceKind): AgentKey[] {
  return source === "firstmate" ? ["claude", "codex", "firstmate"] : ["claude", "codex"];
}

export function initialAgent(source: SourceKind, remembered: AgentKey | null): AgentKey {
  if (remembered && agentChoices(source).includes(remembered)) return remembered;
  return source === "firstmate" ? "firstmate" : "claude";
}

function nameOn(source: SourceKind, agent: AgentKey): string {
  return source === "fathom" && agent === "firstmate" ? AGENTS.claude.name : AGENTS[agent].name;
}

export function chatTitle(source: SourceKind, terminal: Terminal | null, picked: AgentKey): string {
  if (!terminal) return source === "firstmate" ? AGENTS.firstmate.name : nameOn(source, picked);
  const labeled = terminal.labels?.[AGENT_LABEL];
  if (isAgent(labeled)) return nameOn(source, labeled);
  if (source === "firstmate") return AGENTS.firstmate.name;
  const known = (Object.keys(AGENTS) as AgentKey[]).find((key) => key !== "firstmate" && AGENTS[key].program === terminal.agent);
  return known ? AGENTS[known].name : GENERIC_TITLE;
}

export function findingText(source: SourceKind, label: string): string {
  return source === "firstmate" ? `Looking for Firstmate's terminal (${label})…` : `Looking for the chat terminal (${label})…`;
}

export function missingToolText(tool: string): string {
  if (tool === HERDR_CORE) return "herdr-core is not installed or not on PATH. Fathom opens and shows terminals through herdr-core (hc).";
  const agent = (Object.keys(AGENTS) as AgentKey[]).find((key) => AGENTS[key].program === tool);
  const name = agent ? AGENTS[agent].name : tool;
  return `${name} is not installed or not on PATH. Fathom looked for the ${tool} command.`;
}

type LaunchError = { kind: "missing"; tool: string } | { kind: "failed"; message: string };

const isLaunchError = (error: unknown): error is LaunchError =>
  typeof error === "object" && error !== null && "kind" in error && (error.kind === "missing" || error.kind === "failed");

export function launchErrorText(error: unknown): string {
  if (!isLaunchError(error)) return errorText(error);
  return error.kind === "missing" ? missingToolText(error.tool) : error.message;
}
