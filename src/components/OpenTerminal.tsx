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
    <section className="opener" data-part="opener" aria-label="Open a terminal">
      <span className="sech" data-part="sech">Open a terminal</span>
      <div className="agent-choices" data-part="agent-choices" data-control="agent-choice" role="radiogroup" aria-label="Agent">
        {agentChoices(source).map((key) => (
          <button
            key={key}
            role="radio"
            aria-checked={key === agent}
            className={key === agent ? "agent-choice on" : "agent-choice"}
            data-part="agent-choice"
            data-control="agent-choice-option"
            data-key={key}
            disabled={opening}
            onClick={() => onAgent(key)}
          >
            {AGENTS[key].name}
          </button>
        ))}
      </div>
      <p className="opener-folder" data-part="opener-folder">
        {agent === "firstmate" ? "Starts in the Firstmate home " : "Starts in "}
        <code>{folder}</code>
        {agent === "firstmate" ? "." : ". Change the folder in Settings."}
      </p>
      <button className="btn btn-dark" data-part="button" data-kind="dark" data-control="open-agent" disabled={opening} onClick={onOpen}>
        {opening ? `Opening ${name}…` : `Open ${name}`}
      </button>
      {error && (
        <p className="error-text" data-part="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
