import type { AgentFilter } from "../api";
import { AGENT_FILTER_LABEL, AGENT_FILTER_TITLE, AGENT_FILTERS } from "../agentFilter";
import { Sailor } from "./Icons";

const ICON_SIZE = 20;

interface AgentFilterToggleProps {
  filter: AgentFilter;
  disabled: boolean;
  onChange: (filter: AgentFilter) => void;
}

export function AgentFilterToggle({ filter, disabled, onChange }: AgentFilterToggleProps) {
  return (
    <div className="agent-filter" role="radiogroup" aria-label="Cards by agent">
      <span className={`agent-filter-icon sailor${filter === "withActiveAgent" ? " working" : ""}`}>
        <Sailor size={ICON_SIZE} />
      </span>
      {AGENT_FILTERS.map((option) => (
        <button
          key={option}
          role="radio"
          aria-checked={option === filter}
          className={option === filter ? "agent-filter-option on" : "agent-filter-option"}
          title={AGENT_FILTER_TITLE[option]}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {AGENT_FILTER_LABEL[option]}
        </button>
      ))}
    </div>
  );
}
