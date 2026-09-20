// The brand marks (docs/brand/): pills and at most one lit element. Draws in `currentColor` with the accent
// gradient. `mark` picks the product: line (whole package), construct (framework), cockpit (UI), cli.
const PARTS = {
  line: (
    <>
      <rect x="4" y="10" width="28" height="11" rx="5.5" fill="currentColor" />
      <rect x="16" y="27" width="28" height="11" rx="5.5" fill="none" stroke="url(#construct-logo-g)" strokeWidth="2.8" />
    </>
  ),
  construct: <rect x="4" y="15" width="40" height="18" rx="9" fill="none" stroke="currentColor" strokeWidth="2.8" />,
  cockpit: (
    <>
      <rect x="4" y="15" width="40" height="18" rx="9" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <rect x="10" y="21.6" width="13" height="4.8" rx="2.4" fill="currentColor" />
      <circle cx="34" cy="24" r="5" fill="url(#construct-logo-g)" />
    </>
  ),
  cli: (
    <>
      <rect x="4" y="19" width="26" height="10" rx="5" fill="currentColor" />
      <rect x="33" y="19" width="11" height="10" rx="5" fill="url(#construct-logo-g)" />
    </>
  ),
};

export function Logo({ mark = 'cockpit', size = 22, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="construct-logo-g" gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="44" y2="44">
          <stop offset="0" stopColor="#8fb0ff" />
          <stop offset="1" stopColor="#4b63f5" />
        </linearGradient>
      </defs>
      {PARTS[mark] ?? PARTS.cockpit}
    </svg>
  );
}
