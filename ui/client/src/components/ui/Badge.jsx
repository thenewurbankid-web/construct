// Reusable status badge (#46) — generalizes the tool/llm attribution
// label styling (previously hand-rolled per <span> in AttributionBadge
// and again, verbatim, in Help.jsx's prose) into one themed component.
// `tone` picks which #44 token colors it renders with. `error` is new
// here (nothing used an attribution-label.error before) — added so Badge
// covers the full set of meanings this app actually has (tool-work,
// llm-work/no-llm-work, and a failure state), documented as a decision
// point on #46 rather than silently only covering the two tones that
// happened to already exist.
const TONE_CLASS = {
  tool: 'tool',
  llm: 'llm',
  'llm-none': 'llm-none',
  error: 'error',
};

export function Badge({ tone = 'llm-none', children }) {
  return <span className={`attribution-label ${TONE_CLASS[tone] || tone}`}>{children}</span>;
}
