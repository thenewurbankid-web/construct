// @line-level molecule
'use client';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

export type DialogSize = 'sm' | 'md' | 'lg';
const SIZES: Record<DialogSize, string> = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' };

export type DialogProps = {
  title: string;
  description?: string;
  /** The element that opens it (a Button); omitted for a dialog opened only by state. */
  trigger?: ReactNode;
  children?: ReactNode;
  /** Actions, usually Buttons; a Close button follows them while the dialog is dismissible. */
  footer?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Asks to confirm: role="alertdialog", and an outside click does not close it. */
  alert?: boolean;
  /** Has a Close button and closes on Escape or an overlay click (default); false leaves only the footer's actions. */
  dismissible?: boolean;
  /** Escape or an overlay click is about to close it; call preventDefault on the event to keep it open. */
  onDismiss?: (event: Event) => void;
  closeLabel?: string;
  size?: DialogSize;
};

/** A modal window over the page (Radix Dialog): focus moves in, is trapped, and returns to the trigger. */
export function Dialog({ title, description, trigger, children, footer, open, defaultOpen, onOpenChange, alert = false, dismissible = true, onDismiss, closeLabel = 'Close', size = 'md' }: DialogProps) {
  const guard = (event: Event) => { onDismiss?.(event); if (!dismissible) event.preventDefault(); };
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <DialogTrigger trigger={trigger} />
      <RadixDialog.Portal>
        <RadixDialog.Overlay data-part="overlay" className="fixed inset-0 z-40 bg-slate-900/50" />
        <RadixDialog.Content
          role={alert ? 'alertdialog' : 'dialog'}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onEscapeKeyDown={guard}
          onPointerDownOutside={(e) => { if (alert) { e.preventDefault(); return; } guard(e); }}
          data-size={size}
          data-dismissible={dismissible ? '' : undefined}
          className={`fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none ${SIZES[size]}`}
        >
          <RadixDialog.Title className="text-lg font-semibold text-slate-900">{title}</RadixDialog.Title>
          <DialogDescription text={description} />
          <DialogBody content={children} />
          <div data-part="footer" className="mt-6 flex justify-end gap-2">
            {footer}
            <DialogClose show={dismissible} label={closeLabel} />
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function DialogTrigger({ trigger }: { trigger?: ReactNode }) {
  if (!trigger) return null;
  return <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>;
}

function DialogDescription({ text }: { text?: string }) {
  if (!text) return null;
  return <RadixDialog.Description className="mt-1 text-sm text-slate-600">{text}</RadixDialog.Description>;
}

function DialogBody({ content }: { content?: ReactNode }) {
  if (content === undefined || content === null) return null;
  return <div data-part="body" className="mt-4">{content}</div>;
}

function DialogClose({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return <RadixDialog.Close className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">{label}</RadixDialog.Close>;
}
