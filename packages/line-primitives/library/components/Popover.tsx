// @line-level molecule
'use client';
import { Popover as RadixPopover } from 'radix-ui';
import type { ReactNode } from 'react';

export type PopoverSide = 'top' | 'right' | 'bottom' | 'left';

export type PopoverProps = {
  /** Names the popover content (aria-label). */
  label: string;
  /** The element that opens it (a Button). */
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The trigger is disabled and it never opens. */
  disabled?: boolean;
  /** Escape or an outside click is about to close it; call preventDefault on the event to keep it open. */
  onDismiss?: (event: Event) => void;
  side?: PopoverSide;
  closeLabel?: string;
};

/** Non-modal floating content anchored to a trigger (Radix Popover). */
export function Popover({ label, trigger, children, open, defaultOpen, onOpenChange, disabled = false, onDismiss, side = 'bottom', closeLabel = 'Close' }: PopoverProps) {
  return (
    <RadixPopover.Root open={disabled ? false : open} defaultOpen={defaultOpen} onOpenChange={disabled ? undefined : onOpenChange}>
      <RadixPopover.Trigger asChild disabled={disabled}>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content aria-label={label} side={side} sideOffset={6} data-side={side} onEscapeKeyDown={onDismiss} onInteractOutside={onDismiss} className="z-50 w-72 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-900 shadow-md focus:outline-none">
          {children}
          <RadixPopover.Close aria-label={closeLabel} className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">
            <span aria-hidden="true">✕</span>
          </RadixPopover.Close>
          <RadixPopover.Arrow className="fill-white" />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
