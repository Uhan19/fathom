import type { ReactNode } from "react";
import type { Tab } from "../api";

interface DashboardProps {
  mac: boolean;
  children?: ReactNode;
}

export function Dashboard({ mac, children }: DashboardProps) {
  return (
    <div className="dashboard" data-part="dashboard" role="region" aria-label="Dashboard">
      <SectionHead title="Machine" lead={mac ? "What is using this Mac’s memory" : "What is using this computer’s memory"} />
      {children}
      <SectionHead title="Tokens and quota" />
    </div>
  );
}

export function SectionHead({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <div className="dash-head" data-part="dash-head">
      <h2 className="dash-title" data-part="dash-title">
        {title}
      </h2>
      {lead && (
        <span className="dash-lead" data-part="dash-lead">
          {lead}
        </span>
      )}
      {children}
    </div>
  );
}

export function ViewSwitch({ view, onChange }: { view: Tab; onChange: (view: Tab) => void }) {
  const tab = (key: Tab, label: string) => (
    <button
      type="button"
      className="view-tab"
      data-part="view-tab"
      data-control={`view-${key}`}
      data-state={view === key ? "active" : undefined}
      aria-current={view === key ? "page" : undefined}
      onClick={() => onChange(key)}
    >
      {label}
    </button>
  );
  return (
    <nav className="view-switch" data-part="view-switch" aria-label="Views">
      {tab("board", "Board")}
      {tab("dashboard", "Dashboard")}
    </nav>
  );
}
