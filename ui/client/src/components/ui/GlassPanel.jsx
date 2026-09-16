// Reusable glass surface (#46) — the JSX side of #44's .glass-panel CSS
// class. Every page-level panel (Dashboard's command forms, the Wizard's
// chat log and start bar, Settings' "current resolution" box, Help's
// contents nav, ProjectGate's card) renders through this now instead of
// each page hand-writing `<div className="some-name">` and relying on
// that class alone to carry the glassmorphism background/border/blur.
//
// `className` is *appended* after `glass-panel`, not replaced — several
// call sites still need their own layout-only class (e.g. `command-form`
// for its flex/gap, or because ui/e2e's Playwright suite locates it by
// that exact class name) alongside the shared glass treatment. `as` picks
// the rendered tag (e.g. `form`, `nav`) since not every glass panel is a
// plain <div> (the Dashboard forms need to stay real <form> elements).
export function GlassPanel({ as: Tag = 'div', className = '', children, ...rest }) {
  const classes = ['glass-panel', className].filter(Boolean).join(' ');
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
