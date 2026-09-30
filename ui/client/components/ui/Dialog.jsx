// Accessible modal dialog, wrapping Radix Primitives' Dialog (#441). Radix owns focus trap, Esc-to-close,
// return-focus-to-trigger and outside-click-to-close; this file is the ONLY place in the app that imports
// `@radix-ui/react-dialog` — every feature imports the wrapper below instead, so the library underneath
// (Radix today) is swappable by editing this one file.
import { useLayoutEffect, useRef } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';

// Root: holds open/close state. `modal` stays true (Radix default) so background content is inert while open.
export function Dialog({ open, onOpenChange, children }) {
  return <RadixDialog.Root open={open} onOpenChange={onOpenChange}>{children}</RadixDialog.Root>;
}

export const DialogTrigger = RadixDialog.Trigger;

// Overlay + Content, always together — no feature has ever needed a dialog without its own backdrop.
// `className`/`backdropClassName` carry our tokens (see tests.css's .ts-backdrop/.ts-dialog); Radix
// contributes only behavior, not styling.
//
// Every caller here mounts/unmounts Content instead of wrapping a `DialogTrigger` (the trigger lives in
// another component, e.g. a row's own Edit button). Radix's own return-focus-on-close tracks
// `document.activeElement` inside a passive effect, and in dev (Next's `next dev` runs React in
// StrictMode) that effect's mount/cleanup/remount double-invoke races the trigger's autofocus-to-input:
// by the second (real) mount, `document.activeElement` is already the dialog's own input, so on close
// Radix "restores" focus into a node that's being unmounted, and focus falls through to <body>. A layout
// effect runs before any passive effect (StrictMode doubles it too, but always still before Radix's own
// passive mount-focus), so it reliably captures the true pre-open focus — used as the close fallback
// unless the caller supplies its own `onCloseAutoFocus`.
export function DialogContent({ className = '', backdropClassName = '', backdropTestId, onCloseAutoFocus, children, ...rest }) {
  const trigger = useRef(null);
  useLayoutEffect(() => {
    trigger.current = document.activeElement;
  }, []);
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={backdropClassName} data-testid={backdropTestId} />
      <RadixDialog.Content
        className={className}
        onCloseAutoFocus={
          onCloseAutoFocus ??
          ((event) => {
            if (trigger.current instanceof HTMLElement) {
              event.preventDefault();
              trigger.current.focus();
            }
          })
        }
        {...rest}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

// Title/Description: rendering these wires aria-labelledby/aria-describedby onto Content automatically.
// A dialog with meaningful content should use at least Title; Description is optional.
export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;
export const DialogClose = RadixDialog.Close;
