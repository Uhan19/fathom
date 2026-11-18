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

export function Close() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8" />
    </svg>
  );
}

export function Wave() {
  return (
    <svg className="wave" width="100%" height="10" viewBox="0 0 120 10" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 6 Q5 2 10 6 T20 6 T30 6 T40 6 T50 6 T60 6 T70 6 T80 6 T90 6 T100 6 T110 6 T120 6"
        fill="none"
        stroke="#2F6F95"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Sailor() {
  return (
    <svg width="22" height="22" viewBox="0 0 44 44" aria-hidden="true">
      <path d="M12 28h20v16H12z" fill="#34436a" />
      <path d="M12 27h2v17h-2zM30 27h2v17h-2z" fill="#2f5d73" />
      <path d="M16 30h6v8h-6zM18 32v4h2v-4z" fill="#eceeea" fillRule="evenodd" />
      <path d="M24 30h4v8h-2v-6h-2z" fill="#eceeea" />
      <path d="M14 40h16l-1 2H15z" fill="#eceeea" />
      <ShoulderPad />
      <ShoulderPad mirrored />
      <rect x="10" y="24" width="24" height="4" rx="2" fill="#2f5d73" />
      <rect x="12" y="12" width="2" height="8" rx="1" fill="#8a93a6" />
      <rect x="30" y="12" width="2" height="8" rx="1" fill="#8a93a6" />
      <path d="M14 10h16v10l-3 4H17l-3-4z" fill="#eceeea" />
      <path d="M19 21h6v3h-6z" fill="#1b2438" />
      <path d="M14 12h16v5l-2 2H16l-2-2z" fill="#1b2438" />
      <path d="M4 8h36v2H4z" fill="#1b2438" />
      <path d="M10 2h24l4 4v2H6V6z" fill="#4f6189" />
      <circle cx="22" cy="5" r="3" fill="#1b2438" />
      <path
        d="M22 3.5v3.5M20.8 4.2h2.4M20 5.6q.3 1.4 2 1.4t2-1.4"
        fill="none"
        stroke="#e0b13a"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
      <g className="sailor-visor">
        <path d="M8 15h28v2H8z" fill="#ff6b8a" opacity="0.5" />
        <rect x="16" y="14" width="12" height="4" rx="1" fill="#ff2348" />
        <path d="M18 16h8v1h-8z" fill="#ffd6de" />
      </g>
    </svg>
  );
}

function ShoulderPad({ mirrored = false }: { mirrored?: boolean }) {
  return (
    <g transform={mirrored ? "matrix(-1 0 0 1 44 0)" : undefined}>
      <rect x="0" y="22" width="10" height="20" rx="2" fill="#34436a" />
      <path d="M2 22h6a2 2 0 0 1 2 2v4H0v-4a2 2 0 0 1 2-2z" fill="#4f6189" />
      <path d="M0 28h10v2H0z" fill="#f0c22c" />
      <rect x="2" y="32" width="6" height="6" rx="1" fill="#7d8594" />
    </g>
  );
}
