import type { SourceKind } from "../api";
import { AGENTS, agentChoices, type AgentKey } from "../agents";

interface OpenTerminalProps {
  source: SourceKind;
  agent: AgentKey;
  folder: string;
  opening: boolean;
  error: string | null;
  onAgent: (agent: AgentKey) => void;
  onOpen: () => void;
}

export function OpenTerminal({ source, agent, folder, opening, error, onAgent, onOpen }: OpenTerminalProps) {
  const name = AGENTS[agent].name;
  return (
    <section className="opener" aria-label="Open a terminal">
      <span className="sech">Open a terminal</span>
      <div className="agent-choices" role="radiogroup" aria-label="Agent">
        {agentChoices(source).map((key) => (
          <button
            key={key}
            role="radio"
            aria-checked={key === agent}
            className={key === agent ? "agent-choice on" : "agent-choice"}
            disabled={opening}
            onClick={() => onAgent(key)}
          >
            {AGENTS[key].name}
          </button>
        ))}
      </div>
      <p className="opener-folder">
        {agent === "firstmate" ? "Starts in the Firstmate home " : "Starts in "}
        <code>{folder}</code>
        {agent === "firstmate" ? "." : ". Change the folder in Settings."}
      </p>
      <button className="btn btn-dark" disabled={opening} onClick={onOpen}>
        {opening ? `Opening ${name}…` : `Open ${name}`}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
