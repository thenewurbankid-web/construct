'use client';

import { useEffect } from 'react';

function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || Boolean(el.closest?.('.monaco-editor'));
}

/** Alt+Left / Alt+Right walk the trail (#321). Only acts (and only then swallows the key, so the
 * browser's own history navigation is untouched) when there is somewhere to go and focus is not in a
 * text field or the code editor. */
export function useTrailShortcuts(canBack: boolean, canForward: boolean, back: () => void, forward: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || inTextField(e.target)) return;
      if (e.key === 'ArrowLeft' && canBack) {
        e.preventDefault();
        back();
      } else if (e.key === 'ArrowRight' && canForward) {
        e.preventDefault();
        forward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canBack, canForward, back, forward]);
}
