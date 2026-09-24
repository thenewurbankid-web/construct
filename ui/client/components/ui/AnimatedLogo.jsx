'use client';

// The brand mark, alive (#455). Owner request, 2026-09-21: "make the logos active always with subtle
// animation". Same API as `Logo` (`mark`, `size`, `className`) so it is a drop-in at every call site.
//
// WHY NO ANIMATION LIBRARY (owner decision, 2026-09-21 — free/open technology first)
// The four marks are pills, a bar and a circle. A travelling stroke-dash gap and a scale/opacity breathe
// cover the whole brief in CSS keyframes (app/brand.css), so we add **0 KB** to the bundle, need no
// runtime download, work offline on loopback, and make no network call of any kind. `motion` (MIT) was
// the next option had a real engine been needed; Lottie after that (its JSON is at least an open text
// format we could generate deterministically); Rive last and rejected — a `.riv` is a binary only its
// proprietary editor can author, and we cannot run that editor here.
//
// THE ENGINE IS STILL SWAPPABLE. This component owns only the *motion state* and publishes it on a
// wrapper element as `data-motion` ("off" | "idle" | "paused" | "busy" | "exit"). The stylesheet is one
// consumer of that state; a future Lottie/Rive/canvas engine is another, and would read the same
// attribute without any call site changing. That is the whole interface.
//
// GUARDRAILS (both of these matter on the hosted box, where a Cockpit tab stays open all day):
//   - `prefers-reduced-motion: reduce` -> "off": no loop at all, not a shortened one. `busy` follows
//     the same rule (below); `exit` is the one deliberate exception — see `exiting` below.
//   - tab hidden, or the mark scrolled out of view -> "paused": the compositor stops, no CPU burnt
//     animating something nobody can see.
//
// #406 adds two more states, both requested by a caller rather than computed from visibility:
//   - `busy` (prop): a faster loop of the SAME per-mark keyframes idle already uses — read by
//     components/ui/AnimatedLoader.jsx so a loading indicator is built from the same marks/tokens
//     instead of a parallel spinner. Still gated by reduced motion (falls back to "off"), same as idle.
//   - `exiting` (prop) -> "exit": a short, one-shot hand-off animation (brand.css), used by the login
//     screen (#406) right before the Cockpit itself replaces it, so the cut is a resolve rather than a
//     jump. Unlike `busy`, this is published EVEN under reduced motion: `onExitEnd` is a completion
//     signal a caller uses to know when it is safe to unmount, and that has to fire deterministically
//     whether or not an animation actually played — the stylesheet's own reduced-motion rule
//     (`.brand-mark, .brand-mark * { animation: none !important }`) still guarantees nothing is seen
//     to move; this component additionally fires `onExitEnd` on the very next tick instead of waiting
//     for an `animationend` that would never come.
//
// A caller can also ask for `still`: no ambient idle loop, motion only while `busy`. The Cockpit's top bar uses it so the mark
// is a processing indicator (it moves only while the framework is working), not decoration.
//
// Accessibility is unchanged from `Logo`: the wrapper is `aria-hidden` decoration beside the real text
// label ("Cockpit"), it is not focusable, and it adds no accessible name of its own.
import { useEffect, useRef, useState } from 'react';
import { Logo } from './Logo.jsx';

const REDUCED = '(prefers-reduced-motion: reduce)';
// Safety net only: if `animationend` never fires (e.g. the browser drops the frame the class change
// lands in, or a future stylesheet edit shortens/removes the exit keyframe), a caller waiting on
// `onExitEnd` to unmount this screen must not be stuck forever.
const EXIT_FALLBACK_MS = 700;

export function AnimatedLogo({ mark = 'cockpit', size = 22, className, busy = false, still = false, exiting = false, onExitEnd }) {
  const ref = useRef(null);
  // Server render and first paint are deliberately "off": the static mark is what ships in the HTML,
  // and motion only ever starts once the effect below has confirmed this browser wants it.
  const [motion, setMotion] = useState('off');

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof window === 'undefined') return undefined;

    const query = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED) : null;
    let onScreen = true;

    const apply = () => {
      // `exiting` always wins, reduced motion included — see the file header.
      if (exiting) {
        setMotion('exit');
        return;
      }
      if (query?.matches) {
        setMotion('off');
        return;
      }
      if (busy) {
        setMotion('busy');
        return;
      }
      // `still`: no ambient loop at all; the mark moves only while `busy` (the Cockpit's processing indicator).
      if (still) {
        setMotion('off');
        return;
      }
      setMotion(onScreen && !document.hidden ? 'idle' : 'paused');
    };

    let observer;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        (entries) => {
          onScreen = entries.some((entry) => entry.isIntersecting);
          apply();
        },
        { threshold: 0 },
      );
      observer.observe(node);
    }
    document.addEventListener('visibilitychange', apply);
    // Safari < 14 only has the deprecated addListener; guard rather than assume.
    query?.addEventListener?.('change', apply);
    apply();

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', apply);
      query?.removeEventListener?.('change', apply);
    };
  }, [busy, still, exiting]);

  // The exit's completion signal — see `exiting` in the file header for why reduced motion is a
  // separate, immediate path rather than a wait that would never resolve.
  useEffect(() => {
    if (!exiting || !onExitEnd || typeof window === 'undefined') return undefined;
    const node = ref.current;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches;
    if (!node || reduced) {
      const id = window.setTimeout(onExitEnd, 0);
      return () => window.clearTimeout(id);
    }
    const handleEnd = (event) => {
      if (event.target === node) onExitEnd();
    };
    node.addEventListener('animationend', handleEnd);
    const fallback = window.setTimeout(onExitEnd, EXIT_FALLBACK_MS);
    return () => {
      node.removeEventListener('animationend', handleEnd);
      window.clearTimeout(fallback);
    };
  }, [exiting, onExitEnd]);

  return (
    <span
      ref={ref}
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      data-mark={mark}
      data-motion={motion}
      data-testid="animated-logo"
      aria-hidden="true"
    >
      <Logo mark={mark} size={size} />
    </span>
  );
}
