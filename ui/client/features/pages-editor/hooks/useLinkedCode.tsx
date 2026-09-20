'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { linkSegments } from '../domain/CodeLinks';
import type { NavReference } from '../types';

export type LinkHover = { ref: NavReference; x: number; y: number };

/** Link behaviour for the read-only code view (#321): the segments (only resolved references carry a
 * ref), whether Ctrl/Cmd is held (links draw solid), the hover label, and the open gestures. A plain
 * click keeps its meaning (it does not navigate); Ctrl/Cmd-click and Enter on a focused link open. */
export function useLinkedCode(source: string, references: NavReference[], onFollow: (ref: NavReference) => void) {
  const segments = useMemo(() => linkSegments(source, references), [source, references]);
  const [modifierHeld, setModifierHeld] = useState(false);
  const [hover, setHover] = useState<LinkHover | null>(null);

  useEffect(() => {
    const sync = (e: globalThis.KeyboardEvent) => setModifierHeld(e.ctrlKey || e.metaKey);
    const clear = () => setModifierHeld(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const showTip = useCallback((ref: NavReference, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setHover({ ref, x: r.left, y: r.bottom + 6 });
  }, []);
  const hideTip = useCallback(() => setHover(null), []);

  const onLinkClick = useCallback(
    (e: MouseEvent<HTMLElement>, ref: NavReference) => {
      // A resolved link already shows an underline and a pointer before any modifier, so a plain primary
      // click opens it (#346). This is a read-only rendering, so there is no caret placement to preserve;
      // Ctrl/Cmd-click and Enter keep working. Other buttons are left alone.
      if (e.button !== 0) return;
      e.preventDefault();
      onFollow(ref);
    },
    [onFollow],
  );
  const onLinkKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, ref: NavReference) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onFollow(ref);
      }
    },
    [onFollow],
  );

  return { segments, modifierHeld, hover, showTip, hideTip, onLinkClick, onLinkKeyDown };
}
