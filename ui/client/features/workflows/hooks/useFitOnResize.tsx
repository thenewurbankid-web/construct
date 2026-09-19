'use client';

import { useCallback, useEffect, useRef } from 'react';

// Only fitView is needed, so accept any flow instance regardless of its node/edge types.
type Fitter = { fitView: (options?: { padding?: number }) => unknown };

/** React Flow fits the diagram to its box once, when it first renders. Inside
 * the shell the box changes afterwards (the Tools panel opens when a file
 * loads, panes are dragged, the window resizes), so refit whenever the
 * viewport element's size changes. `padding` matches the initial fit. */
export function useFitOnResize(padding: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<Fitter | null>(null);
  const onInit = useCallback((instance: Fitter) => {
    flowRef.current = instance;
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        flowRef.current?.fitView({ padding });
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [padding]);

  return { viewportRef, onInit };
}
