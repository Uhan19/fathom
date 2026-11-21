import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { AgentFilter } from "../api";
import { AGENT_FILTER_LABEL, AGENT_FILTER_TITLE, AGENT_FILTERS, steppedFilter } from "../agentFilter";
import { Sailor } from "./Icons";

const ICON_SIZE = 20;

interface AgentFilterToggleProps {
  filter: AgentFilter;
  disabled: boolean;
  onChange: (filter: AgentFilter) => void;
}

export function AgentFilterToggle({ filter, disabled, onChange }: AgentFilterToggleProps) {
  const options = useRef<Partial<Record<AgentFilter, HTMLButtonElement | null>>>({});
  const selected = AGENT_FILTERS.indexOf(filter);

  const step = (e: KeyboardEvent) => {
    const next = steppedFilter(filter, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    options.current[next]?.focus();
  };

  return (
    <div className="agent-filter">
      <span className={`agent-filter-icon sailor${filter === "withActiveAgent" ? " working" : ""}`}>
        <Sailor size={ICON_SIZE} />
      </span>
      <div
        className="segmented"
        role="radiogroup"
        aria-label="Cards by agent"
        style={{ "--segments": AGENT_FILTERS.length, "--selected": selected } as CSSProperties}
        onKeyDown={step}
      >
        <span className="segmented-thumb" aria-hidden="true" />
        {AGENT_FILTERS.map((option) => (
          <button
            key={option}
            ref={(el) => {
              options.current[option] = el;
            }}
            type="button"
            role="radio"
            aria-checked={option === filter}
            tabIndex={option === filter ? 0 : -1}
            className={option === filter ? "segmented-option toggle-text on" : "segmented-option toggle-text"}
            title={AGENT_FILTER_TITLE[option]}
            disabled={disabled}
            onClick={() => onChange(option)}
          >
            {AGENT_FILTER_LABEL[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
