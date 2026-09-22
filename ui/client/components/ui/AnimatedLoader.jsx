'use client';

// A reusable loading indicator built from the very same brand mark used everywhere else (#406) — so
// "something is loading" reads as the same brand instead of a generic ad hoc spinner. It is a thin
// wrapper over AnimatedLogo's `busy` motion state (app/brand.css): the SAME per-mark keyframes idle
// motion already uses, just compressed into a faster loop that reads as active work rather than
// ambient life. No new animation engine, no new keyframes, no bundle cost.
//
// Ad hoc indicators this can replace as call sites are touched (none were required to change for
// #406 — see the ticket for the one real drop-in site wired up): `.st-spinner` (app/screens.css,
// features/states/components/LoadingState.tsx — a plain CSS border-spin with no reduced-motion
// handling at all) and a few bare "Loading…" strings (e.g. features/workflows/components/
// WorkflowsBrowser.tsx, features/pages-editor/components/PagesBrowser.tsx).
//
// Accessibility: `role="status"` + `aria-label` by default — the loader announces itself, once, and
// is never focusable (no focus trap). Pass `decorative` when it sits beside a control that already
// carries the accessible name (e.g. a button whose own text reads "Signing in…"), mirroring
// AnimatedLogo's own aria-hidden-beside-a-label idiom, so the two are not announced twice.
// Reduced motion: same contract as AnimatedLogo — a static mark, no animation loop at all.
import { AnimatedLogo } from './AnimatedLogo.jsx';

const SIZES = { small: 16, medium: 28, large: 56 };

export function AnimatedLoader({ size = 'medium', variant = 'inline', label = 'Loading', mark = 'cockpit', decorative = false, className }) {
  const px = typeof size === 'number' ? size : SIZES[size] ?? SIZES.medium;
  const classes = ['loader', `loader--${variant}`, className].filter(Boolean).join(' ');
  const a11yProps = decorative ? { 'aria-hidden': 'true' } : { role: 'status', 'aria-label': label };

  return (
    <span className={classes} data-testid="animated-loader" {...a11yProps}>
      <AnimatedLogo mark={mark} size={px} busy />
      {variant === 'overlay' && (
        <span className="loader__label" aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  );
}
