export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M50.38 13.62 A26 26 0 0 0 13.62 50.38 Z" fill="#F4F1EA" />
      <path d="M50.38 13.62 A26 26 0 0 1 13.62 50.38 Z" fill="#C9A45C" />
      <path className="brand-mark-gap" d="M51.09 12.91 L12.91 51.09" strokeWidth="2.4" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <BrandMark />
      <span className="brand-name" role="img" aria-label="Fathom">
        <span aria-hidden="true">FATHOM</span>
      </span>
    </div>
  );
}
