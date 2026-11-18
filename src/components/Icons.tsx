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

const SAILOR_SIZE = 30;

export function Sailor({ size = SAILOR_SIZE }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <path d="M30 58h60v62H30z" fill="#27334d" />
      <rect x="40" y="76" width="40" height="17" rx="2" fill="#34436a" />
      <path d="M55 80.5h4.5v8H55zM63 80.5h2v8h-2zM61.4 82.4L63 80.8" fill="none" stroke="#eceeea" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M38 96h44l-2 10H40z" fill="#eceeea" />
      <path d="M40 103h40l-.6 3H40.6z" fill="#c9cdcc" />
      <path d="M44 108h32l-1 12H45z" fill="#1b2438" />

      <g>
        <rect x="3" y="52" width="27" height="56" rx="4" fill="#27334d" />
        <rect x="3" y="52" width="27" height="18" rx="4" fill="#34436a" />
        <rect x="6" y="54" width="21" height="2" rx="1" fill="#46577c" />
        <rect x="7" y="64" width="19" height="4" fill="#f0c22c" />
        <path d="M8 68l2-4h2.2l-2 4zM12.5 68l2-4h2.2l-2 4zM17 68l2-4h2.2l-2 4zM21.5 68l2-4h2.2l-2 4z" fill="#1a1a1a" />
        <rect x="9.5" y="75" width="15" height="15" rx="2" fill="#5a6069" stroke="#3c4048" strokeWidth="1" />
        <path d="M12 77.5l2.5 2.5M22 77.5L19.5 80M12 87.5l2.5-2.5M22 87.5L19.5 85" stroke="#3c4048" strokeWidth="1.2" strokeLinecap="round" />
        <rect x="3" y="100" width="27" height="8" rx="2" fill="#1b2438" />
        <path d="M6 108h21v12H6z" fill="#1f3847" />
        <path d="M6 113h21" stroke="#2b4b5e" strokeWidth="1.5" />
      </g>
      <g transform="matrix(-1 0 0 1 120 0)">
        <rect x="3" y="52" width="27" height="56" rx="4" fill="#27334d" />
        <rect x="3" y="52" width="27" height="18" rx="4" fill="#34436a" />
        <rect x="6" y="54" width="21" height="2" rx="1" fill="#46577c" />
        <rect x="7" y="64" width="19" height="4" fill="#f0c22c" />
        <path d="M8 68l2-4h2.2l-2 4zM12.5 68l2-4h2.2l-2 4zM17 68l2-4h2.2l-2 4zM21.5 68l2-4h2.2l-2 4z" fill="#1a1a1a" />
        <rect x="9.5" y="75" width="15" height="15" rx="2" fill="#5a6069" stroke="#3c4048" strokeWidth="1" />
        <path d="M12 77.5l2.5 2.5M22 77.5L19.5 80M12 87.5l2.5-2.5M22 87.5L19.5 85" stroke="#3c4048" strokeWidth="1.2" strokeLinecap="round" />
        <rect x="3" y="100" width="27" height="8" rx="2" fill="#1b2438" />
        <path d="M6 108h21v12H6z" fill="#1f3847" />
        <path d="M6 113h21" stroke="#2b4b5e" strokeWidth="1.5" />
      </g>

      <path d="M28 66h10v54H28z" fill="#2b4b5e" />
      <path d="M35.5 66H38v54h-2.5z" fill="#1f3847" />
      <path d="M82 66h10v54H82z" fill="#2b4b5e" />
      <path d="M82 66h2.5v54H82z" fill="#1f3847" />

      <rect x="50" y="54" width="20" height="12" fill="#3c4048" />
      <path d="M33 62c7-7 17-7 27-5 10-2 20-2 27 5v8c-11 8-43 8-54 0z" fill="#2b4b5e" />
      <path d="M38 68.5c11 5.5 33 5.5 44 0M43 63.5c9 3 25 3 34 0" fill="none" stroke="#1f3847" strokeWidth="1.5" strokeLinecap="round" />

      <rect x="38" y="35" width="6" height="16" rx="3" fill="#5a6069" />
      <rect x="76" y="35" width="6" height="16" rx="3" fill="#5a6069" />
      <rect x="42" y="31" width="36" height="24" rx="4" fill="#27334d" />
      <path d="M45 37h30l-1 14-6 6H52l-6-6z" fill="#eceeea" />
      <path d="M50 50h20l-3 6H53z" fill="#c9cdcc" />
      <path d="M46 40h28l-2 6H48z" fill="#1b2438" />

      <path d="M47.5 58c-4.5 0-6.5-3-6.5-7M72.5 58c4.5 0 6.5-3 6.5-7" fill="none" stroke="#3c4048" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="50" cy="58" r="2.6" fill="#5a6069" />
      <circle cx="70" cy="58" r="2.6" fill="#5a6069" />
      <rect x="53" y="54" width="14" height="10" rx="2" fill="#1b2438" />
      <path d="M56.5 56.5h1.4v5h-1.4zM59.3 56.5h1.4v5h-1.4zM62.1 56.5h1.4v5h-1.4z" fill="#8a9099" />

      <path d="M42 23h36v9H42z" fill="#2a3752" />
      <path d="M40 32h40q-2 4-8 4H48q-6 0-8-4z" fill="#1b2438" />
      <path d="M22 23h76l-4 3H26z" fill="#1b2438" />
      <path d="M31 7h58l10 10-2 6H23l-2-6z" fill="#3b4a68" />
      <path d="M34 9h52l7 6H27z" fill="#4a5b7c" />
      <rect x="25" y="17.5" width="13" height="4.5" rx="1" fill="#5a6069" />
      <rect x="82" y="17.5" width="13" height="4.5" rx="1" fill="#5a6069" />
      <circle cx="60" cy="15" r="7" fill="#1b2438" />
      <g fill="none" stroke="#d9a833" strokeWidth="1.3" strokeLinecap="round">
        <circle cx="60" cy="10.3" r="1.1" />
        <path d="M60 11.4v8.3M57.6 13.2h4.8M55.9 16.4q.7 3.4 4.1 3.4t4.1-3.4" />
      </g>

      <g className="sailor-visor">
        <rect x="38" y="38.5" width="44" height="9" rx="4.5" fill="#ff3366" opacity="0.16" />
        <rect x="43" y="40" width="34" height="6" rx="3" fill="#ff3366" opacity="0.32" />
        <rect x="33" y="42.6" width="54" height="0.8" rx="0.4" fill="#ff6b8a" opacity="0.7" />
        <rect x="48" y="41.5" width="24" height="3" rx="1.5" fill="#ff2348" />
        <rect x="50.5" y="42.5" width="19" height="1" rx="0.5" fill="#ffd6de" />
      </g>
    </svg>
  );
}
