'use client';

import { useEffect } from 'react';

/**
 * #391: Help sections start collapsed (except Getting started), so a Contents link (`#tutorials`) has to open the
 * section it points at, on the page's first load with that hash and on every later hash change. A native
 * <details> does not open itself when the fragment targets the element rather than something inside it.
 */
export function useOpenSectionOnHash(): void {
  useEffect(() => {
    const open = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView();
      }
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
}
