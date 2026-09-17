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

// `className`/`style` are additive (#75) — every existing caller only ever
// passed `tone`+`children`, so this stays byte-identical for them (an empty
// `className` and an `undefined` `style` are no-ops); it lets a caller that
// needs a per-instance color (e.g. the prop-flow diagram's per-prop-name
// pills, which can't be expressed by the fixed tool/llm/llm-none/error
// vocabulary) still render through the same small-rounded-badge shape
// instead of hand-rolling a near-duplicate element.
export function Badge({ tone = 'llm-none', className = '', style, children }) {
  const classes = ['attribution-label', TONE_CLASS[tone] || tone, className].filter(Boolean).join(' ');
  return (
    <span className={classes} style={style}>
      {children}
    </span>
  );
}
