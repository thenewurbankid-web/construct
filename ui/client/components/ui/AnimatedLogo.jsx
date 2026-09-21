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
// wrapper element as `data-motion` ("off" | "idle" | "paused"). The stylesheet is one consumer of that
// state; a future Lottie/Rive/canvas engine is another, and would read the same attribute without any
// call site changing. That is the whole interface.
//
// GUARDRAILS (both of these matter on the hosted box, where a Cockpit tab stays open all day):
//   - `prefers-reduced-motion: reduce` -> "off": no loop at all, not a shortened one.
//   - tab hidden, or the mark scrolled out of view -> "paused": the compositor stops, no CPU burnt
//     animating something nobody can see.
//
// Accessibility is unchanged from `Logo`: the wrapper is `aria-hidden` decoration beside the real text
// label ("Cockpit"), it is not focusable, and it adds no accessible name of its own.
import { useEffect, useRef, useState } from 'react';
import { Logo } from './Logo.jsx';

const REDUCED = '(prefers-reduced-motion: reduce)';

export function AnimatedLogo({ mark = 'cockpit', size = 22, className }) {
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
      if (query?.matches) setMotion('off');
      else setMotion(onScreen && !document.hidden ? 'idle' : 'paused');
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
  }, []);

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
