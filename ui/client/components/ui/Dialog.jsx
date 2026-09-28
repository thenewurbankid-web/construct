// Accessible modal dialog, wrapping Radix Primitives' Dialog (#441). Radix owns focus trap, Esc-to-close,
// return-focus-to-trigger and outside-click-to-close; this file is the ONLY place in the app that imports
// `@radix-ui/react-dialog` — every feature imports the wrapper below instead, so the library underneath
// (Radix today) is swappable by editing this one file.
import * as RadixDialog from '@radix-ui/react-dialog';

// Root: holds open/close state. `modal` stays true (Radix default) so background content is inert while open.
export function Dialog({ open, onOpenChange, children }) {
  return <RadixDialog.Root open={open} onOpenChange={onOpenChange}>{children}</RadixDialog.Root>;
}

export const DialogTrigger = RadixDialog.Trigger;

// Overlay + Content, always together — no feature has ever needed a dialog without its own backdrop.
// `className`/`backdropClassName` carry our tokens (see tests.css's .ts-backdrop/.ts-dialog); Radix
// contributes only behavior, not styling.
export function DialogContent({ className = '', backdropClassName = '', backdropTestId, children, ...rest }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={backdropClassName} data-testid={backdropTestId} />
      <RadixDialog.Content className={className} {...rest}>
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
