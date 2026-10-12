// @line-level molecule
'use client';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export type DialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The element that opens the dialog (optional when `open` is controlled). */
  trigger?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
};

export function Dialog({ open, onOpenChange, trigger, title, description, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-black/40" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg">
          <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
          {description ? <RadixDialog.Description className="mt-1 text-sm text-slate-600">{description}</RadixDialog.Description> : null}
          <div className="mt-4">{children}</div>
          <RadixDialog.Close className="absolute right-3 top-3 rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">×</RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
