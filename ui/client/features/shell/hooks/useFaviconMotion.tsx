'use client';

import { useEffect, useRef } from 'react';
import { isAtRest, toDataUrl, toggleFaviconSvg, toggleFrame } from '../domain/FaviconFrames';

const TICK_MS = 150;

/**
 * The tab icon flips like the logo while `moving` (the framework is working), and settles back to the static icon once it stops:
 * it finishes the flip in progress instead of freezing mid-way. Redrawn from the clock, so a hidden tab (whose timers run slower)
 * is choppier but never out of step, which is exactly where a tab icon is most useful. Reduced motion: never animated.
 * Nothing here calls the network or a model.
 */
export function useFaviconMotion(moving: boolean): void {
  const movingRef = useRef(moving);
  const state = useRef<{ link: HTMLLinkElement | null; original: string | null; timer: ReturnType<typeof setInterval> | null; last: string }>({ link: null, original: null, timer: null, last: '' });

  useEffect(() => {
    movingRef.current = moving;
    const s = state.current;
    const stop = (restore: boolean) => {
      if (s.timer) clearInterval(s.timer);
      s.timer = null;
      s.last = '';
      if (restore && s.link && s.original !== null) s.link.setAttribute('href', s.original);
    };
    const tick = () => {
      const f = toggleFrame(Date.now());
      // Read through the ref: this callback outlives the render that started it.
      if (!movingRef.current && isAtRest(f)) return stop(true);
      const href = toDataUrl(toggleFaviconSvg(f));
      if (href !== s.last && s.link) {
        s.last = href;
        s.link.setAttribute('href', href);
      }
    };
    if (moving && !s.timer) {
      const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
      if (reduced || !link) return undefined;
      if (s.original === null || s.link !== link) {
        s.link = link;
        s.original = link.getAttribute('href');
      }
      s.timer = setInterval(tick, TICK_MS);
      tick();
    }
    // Stopping: the timer keeps running until the flip in progress reaches rest, then restores the static icon.
    return undefined;
  }, [moving]);

  // Leaving the page (or the shell unmounting): put the static icon back at once.
  useEffect(() => {
    const s = state.current;
    return () => {
      if (s.timer) clearInterval(s.timer);
      s.timer = null;
      if (s.link && s.original !== null) s.link.setAttribute('href', s.original);
    };
  }, []);
}
