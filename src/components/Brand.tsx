import { useLook } from "../themes/context";

export function BrandMark() {
  const art = useLook().art.brandMark;
  if (art) return <img className="brand-mark" data-part="brand-mark" src={art} alt="" aria-hidden="true" />;
  return (
    <svg className="brand-mark" data-part="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M50.38 13.62 A26 26 0 0 0 13.62 50.38 Z" fill="var(--logo-face)" />
      <path d="M50.38 13.62 A26 26 0 0 1 13.62 50.38 Z" fill="var(--logo-shade)" />
      <path className="brand-mark-gap" data-part="brand-mark-gap" d="M51.09 12.91 L12.91 51.09" strokeWidth="2.4" />
    </svg>
  );
}

export function Brand() {
  const brand = useLook().text.brand;
  return (
    <div className="brand" data-part="brand">
      <BrandMark />
      <span className="brand-name" data-part="brand-name" role="img" aria-label="Fathom">
        <span aria-hidden="true">{brand}</span>
      </span>
    </div>
  );
}
