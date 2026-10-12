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
  /** Actions, usually Buttons; a Close button is always there. */
  footer?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Asks to confirm: role="alertdialog", and an outside click does not close it. */
  alert?: boolean;
  closeLabel?: string;
  size?: DialogSize;
};

/** A modal window over the page (Radix Dialog): focus moves in, is trapped, and returns to the trigger. */
export function Dialog({ title, description, trigger, children, footer, open, defaultOpen, onOpenChange, alert = false, closeLabel = 'Close', size = 'md' }: DialogProps) {
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay data-part="overlay" className="fixed inset-0 z-40 bg-slate-900/50" />
        <RadixDialog.Content
          role={alert ? 'alertdialog' : 'dialog'}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onPointerDownOutside={alert ? (e) => e.preventDefault() : undefined}
          data-size={size}
          className={`fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none ${SIZES[size]}`}
        >
          <RadixDialog.Title className="text-lg font-semibold text-slate-900">{title}</RadixDialog.Title>
          {description ? <RadixDialog.Description className="mt-1 text-sm text-slate-600">{description}</RadixDialog.Description> : null}
          {children ? <div data-part="body" className="mt-4">{children}</div> : null}
          <div data-part="footer" className="mt-6 flex justify-end gap-2">
            {footer}
            <RadixDialog.Close className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">{closeLabel}</RadixDialog.Close>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
