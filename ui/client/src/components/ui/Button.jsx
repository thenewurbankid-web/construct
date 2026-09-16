// Reusable, themed button (#46). Renders a real <button> — every call
// site that used to write its own <button>…</button> now goes through
// this instead, and the app no longer relies on a bare `button {}` tag
// selector in styles.css (see .ui-button there) — the theme lives in one
// component instead of being implicit/global.
export function Button({ variant = 'primary', className = '', children, ...rest }) {
  const classes = ['ui-button', `ui-button--${variant}`, className].filter(Boolean).join(' ');
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
