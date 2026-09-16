// Reusable, themed text/checkbox input (#46). A thin passthrough to a
// real <input> — kept intentionally trivial (no custom styling logic of
// its own beyond a class name) so every input everywhere in the app is
// still exactly a native <input> for accessibility, autofill, and
// Playwright's own element/role queries (getByPlaceholder etc., used
// throughout ui/e2e, keep working unchanged since this renders the same
// DOM node type with the same attributes).
//
// Decision: `type="checkbox"` gets a different class (`ui-checkbox`,
// currently unstyled — a native checkbox already reads fine on a dark
// background) instead of `ui-input`'s text-field background/padding,
// which would otherwise visibly break every checkbox in the app (the
// layer pickers on Dashboard, Import's "have the LLM…" toggle).
export function Input({ className = '', type, ...rest }) {
  const base = type === 'checkbox' ? 'ui-checkbox' : 'ui-input';
  const classes = [base, className].filter(Boolean).join(' ');
  return <input type={type} className={classes} {...rest} />;
}
