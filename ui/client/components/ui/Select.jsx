// Reusable, themed <select> (#46). Same passthrough philosophy as
// Input.jsx — a real native <select> (ui/e2e's Settings test drives the
// actual dropdown via page.locator('select')), just carrying a shared
// `ui-select` class instead of every page re-declaring its own look.
// `children` stays <option>/<optgroup> — call sites keep full control
// over their own option lists (static, mapped, conditional) exactly as
// before.
export function Select({ className = '', children, ...rest }) {
  const classes = ['ui-select', className].filter(Boolean).join(' ');
  return (
    <select className={classes} {...rest}>
      {children}
    </select>
  );
}
