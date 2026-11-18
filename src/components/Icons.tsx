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

const SAILOR_SIZE = 36;

export function Sailor({ size = SAILOR_SIZE }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" overflow="visible" aria-hidden="true">
      <path d="M2 30c0-3.2 2.2-5.4 5.4-6h15.2c3.2.6 5.4 2.8 5.4 6z" fill="#2b4b5e" />
      <path d="M7 25.2c2.4 1.6 5 2.3 8 2.3s5.6-.7 8-2.3" fill="none" stroke="#1f3847" strokeWidth="1" />
      <rect x="3.5" y="13" width="3" height="7" rx="1" fill="#5a6069" />
      <rect x="23.5" y="13" width="3" height="7" rx="1" fill="#5a6069" />
      <path d="M6 11h18v10l-3.5 4h-11L6 21z" fill="#27334d" />
      <path d="M8 12h14v8l-2.5 3h-9L8 20z" fill="#eceeea" />
      <rect x="12" y="20.5" width="6" height="4.5" rx="1" fill="#1b2438" />
      <path d="M13.6 21.8v2M15 21.8v2M16.4 21.8v2" stroke="#8a9099" strokeWidth="0.8" />
      <rect x="5.5" y="13" width="19" height="6.5" rx="2" fill="#1b2438" />
      <path d="M5 10h20v2H5z" fill="#1b2438" />
      <path d="M8 2h14l6 6v2H2V8z" fill="#3b4a68" />
      <path d="M9 2h12l4 4H5z" fill="#4f6189" />
      <circle cx="15" cy="6" r="3.3" fill="#1b2438" />
      <path
        d="M15 3.91v4.29M13.68 4.79h2.64M12.91 6.55q.44 1.76 2.09 1.76t2.09-1.76"
        fill="none"
        stroke="#e0b13a"
        strokeWidth="0.935"
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
