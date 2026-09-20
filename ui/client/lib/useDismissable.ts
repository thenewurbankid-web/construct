'use client';

import { useEffect, type RefObject } from 'react';

/** One dismissal contract for every popover (docs/design/popovers.md, #298).
 *
 * While `open`:
 *  - focus moves to the first enabled control inside the surface (or the surface itself);
 *  - Escape (from the trigger or inside) closes, is consumed, and returns focus to the trigger;
 *  - a pointer press outside surface and trigger closes and does NOT touch focus;
 *  - Tab past the last control / Shift+Tab before the first closes and lets focus move on;
 *  - focus arriving anywhere outside surface and trigger (F6, a shortcut) closes;
 *  - opening any other popover closes this one (a window event, so features stay independent).
 *
 * It is deliberately NOT a focus trap: popovers are not modals. */

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const OPENED = 'construct:popover-opened';

type Options = {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<HTMLElement | null>;
  /** A stable name for this popover, used to tell "another popover opened". */
  id: string;
};

const controls = (surface: HTMLElement): HTMLElement[] =>
  Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE));

export function useDismissable({ open, onClose, triggerRef, surfaceRef, id }: Options) {
  useEffect(() => {
    if (!open) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    window.dispatchEvent(new CustomEvent(OPENED, { detail: id }));
    const first = controls(surface)[0];
    if (first) first.focus();
    else {
      surface.tabIndex = -1;
      surface.focus();
    }

    const inside = (n: EventTarget | null) =>
      n instanceof Node && (surface.contains(n) || !!triggerRef.current?.contains(n));

    const onKeyDown = (e: KeyboardEvent) => {
      if (!inside(e.target)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        triggerRef.current?.focus();
      } else if (e.key === 'Tab' && surface.contains(e.target as Node)) {
        const list = controls(surface);
        const edge = e.shiftKey ? list[0] : list[list.length - 1];
        if (list.length === 0 || e.target === edge || e.target === surface) onClose();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) onClose();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target)) onClose();
    };
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener(OPENED, onOther);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener(OPENED, onOther);
    };
    // onClose is a stable callback in both callers; re-subscribing on identity change would re-focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
