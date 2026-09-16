// Reusable labeled-field wrapper (#46) — the `<label className="field">
// <span>Label</span>{input}<span className="field-hint">…</span></label>`
// pattern that used to be hand-repeated on every form field across
// Dashboard/Settings. `children` is whatever control the field wraps
// (Input, Select, or something bespoke like the layer checkbox group) —
// Field only owns the label/hint chrome, not the control itself, so it
// composes with any of the other ui/ components.
export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
