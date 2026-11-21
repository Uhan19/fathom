import type { ReactNode } from "react";

export function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8.5 3L4.5 7l4 4" />
    </svg>
  );
}

export function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5.5 3l4 4-4 4" />
    </svg>
  );
}

export function ChevronUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 8.5l4-4 4 4" />
    </svg>
  );
}

export function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 5.5l4 4 4-4" />
    </svg>
  );
}

export function Close() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8" />
    </svg>
  );
}

export function Plus() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" />
    </svg>
  );
}

export function TerminalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
      <path d="M4 5.5l1.8 1.5L4 8.5M7.2 8.7h2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Trash() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2.5 3.8h9M5.5 3.8V2.5h3v1.3M3.7 3.8l.6 7.7h5.4l.6-7.7M5.9 6v3.6M8.1 6v3.6" strokeLinejoin="round" />
    </svg>
  );
}

const SAILOR_SIZE = 32;

export function Sailor({ size = SAILOR_SIZE }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" overflow="visible" aria-hidden="true">
      <path d="M2 30c0-3.2 2.2-5.4 5.4-6h15.2c3.2.6 5.4 2.8 5.4 6z" fill="#3f6b84" />
      <path d="M7 25.2c2.4 1.6 5 2.3 8 2.3s5.6-.7 8-2.3" fill="none" stroke="#2e5268" strokeWidth="1" />
      <rect x="3.5" y="13" width="3" height="7" rx="1" fill="#7d8591" />
      <rect x="23.5" y="13" width="3" height="7" rx="1" fill="#7d8591" />
      <path d="M6 11h18v10l-3.5 4h-11L6 21z" fill="#3c4d72" />
      <path d="M8 12h14v8l-2.5 3h-9L8 20z" fill="#eceeea" />
      <rect x="12" y="20.5" width="6" height="4.5" rx="1" fill="#1b2438" />
      <path d="M13.6 21.8v2M15 21.8v2M16.4 21.8v2" stroke="#8a9099" strokeWidth="0.8" />
      <rect x="5.5" y="13" width="19" height="6.5" rx="2" fill="#1b2438" />
      <path d="M5 10h20v2H5z" fill="#2f3d5e" />
      <path d="M8 2h14l6 6v2H2V8z" fill="#55699a" />
      <path d="M9 2h12l4 4H5z" fill="#6d82b5" />
      <circle cx="15" cy="6" r="3.9" fill="#1f2a44" />
      <path
        d="M15 3.59v4.94M13.48 4.61h3.04M12.59 6.63q.51 2.03 2.41 2.03t2.41-2.03"
        fill="none"
        stroke="#f0c22c"
        strokeWidth="1.08"
        strokeLinecap="round"
      />
      <g className="sailor-visor">
        <rect x="-5" y="15.6" width="40" height="1.3" rx="0.65" fill="#ff3366" opacity="0.35" />
        <rect x="-1" y="15" width="32" height="2.5" rx="1.25" fill="#ff3366" opacity="0.4" />
        <rect x="3" y="14.2" width="24" height="4.1" rx="2" fill="#ff3366" opacity="0.45" />
        <rect x="6.5" y="14" width="17" height="4.5" rx="1.8" fill="#ff2348" />
        <rect x="9" y="15.6" width="12" height="1.3" rx="0.65" fill="#ffd6de" />
      </g>
    </svg>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function PullRequestIcon() {
  return (
    <Glyph>
      <circle cx="3.5" cy="3" r="1.4" />
      <circle cx="3.5" cy="11" r="1.4" />
      <circle cx="10.5" cy="11" r="1.4" />
      <path d="M3.5 4.4v5.2M10.5 9.6V5.5a2 2 0 0 0-2-2H6.5M7.8 2.2L6.5 3.5l1.3 1.3" />
    </Glyph>
  );
}

export function IssueIcon() {
  return (
    <Glyph>
      <circle cx="7" cy="7" r="5.2" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
    </Glyph>
  );
}

export function CommitIcon() {
  return (
    <Glyph>
      <circle cx="7" cy="7" r="2.2" />
      <path d="M1 7h3.8M9.2 7H13" />
    </Glyph>
  );
}

export function RepoIcon() {
  return (
    <Glyph>
      <path d="M3 11.5V3a1.5 1.5 0 0 1 1.5-1.5H11v8H4.5A1.5 1.5 0 0 0 3 11a1.5 1.5 0 0 0 1.5 1.5H11" />
    </Glyph>
  );
}

export function TicketIcon() {
  return (
    <Glyph>
      <path d="M1.8 4.2h10.4v1.6a1.3 1.3 0 0 0 0 2.4v1.6H1.8V8.2a1.3 1.3 0 0 0 0-2.4z" />
      <path d="M8.6 4.4v5.2" strokeDasharray="1 1.2" />
    </Glyph>
  );
}

export function ChatIcon() {
  return (
    <Glyph>
      <path d="M2 3.2A1.2 1.2 0 0 1 3.2 2h7.6A1.2 1.2 0 0 1 12 3.2v5.1a1.2 1.2 0 0 1-1.2 1.2H6.2L3.4 12V9.5h-.2A1.2 1.2 0 0 1 2 8.3z" />
    </Glyph>
  );
}

export function GlobeIcon() {
  return (
    <Glyph>
      <circle cx="7" cy="7" r="5.3" />
      <path d="M1.7 7h10.6M7 1.7c1.6 1.6 2.3 3.4 2.3 5.3S8.6 10.7 7 12.3C5.4 10.7 4.7 8.9 4.7 7S5.4 3.3 7 1.7z" />
    </Glyph>
  );
}

export function FileIcon() {
  return (
    <Glyph>
      <path d="M3 1.8h5l3 3v7.4H3z" />
      <path d="M8 1.8v3h3M5 7.5h4M5 9.8h4" />
    </Glyph>
  );
}

export function ImageIcon() {
  return (
    <Glyph>
      <rect x="1.8" y="2.5" width="10.4" height="9" rx="1.2" />
      <circle cx="5" cy="5.6" r="1" />
      <path d="M2.2 10.4l3.2-3 2.4 2.2 1.6-1.4 2.6 2.4" />
    </Glyph>
  );
}

export function PageIcon() {
  return (
    <Glyph>
      <rect x="1.8" y="2.2" width="10.4" height="9.6" rx="1.2" />
      <path d="M1.8 4.8h10.4M5.4 7.2L4 8.4l1.4 1.2M8.6 7.2L10 8.4 8.6 9.6" />
    </Glyph>
  );
}

export function FolderIcon() {
  return (
    <Glyph>
      <path d="M1.8 3.4a1 1 0 0 1 1-1h2.8l1.3 1.4h4.3a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />
    </Glyph>
  );
}

export function OpenIcon() {
  return (
    <Glyph>
      <path d="M8 2h4v4M12 2L6.5 7.5M10.5 8.5v2.7a.8.8 0 0 1-.8.8H2.8a.8.8 0 0 1-.8-.8V4.3a.8.8 0 0 1 .8-.8h2.7" />
    </Glyph>
  );
}

export function RevealIcon() {
  return (
    <Glyph>
      <path d="M1.8 3.4a1 1 0 0 1 1-1h2.8l1.3 1.4h4.3a1 1 0 0 1 1 1v1.4M1.8 3.4v7.3a1 1 0 0 0 1 1h3.4" />
      <circle cx="9.6" cy="9.2" r="2" />
      <path d="M11.1 10.7l1.4 1.4" />
    </Glyph>
  );
}

export function ExpandIcon() {
  return (
    <Glyph>
      <path d="M8.5 2.5h3v3M11.5 2.5L8 6M5.5 11.5h-3v-3M2.5 11.5L6 8" />
    </Glyph>
  );
}
