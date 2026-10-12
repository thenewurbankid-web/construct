// @line-level molecule
'use client';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

export type DrawerSide = 'left' | 'right' | 'top' | 'bottom';
const SIDES: Record<DrawerSide, string> = {
  left: 'inset-y-0 left-0 h-full w-80 max-w-[90vw]',
  right: 'inset-y-0 right-0 h-full w-80 max-w-[90vw]',
  top: 'inset-x-0 top-0 max-h-[80vh] w-full',
  bottom: 'inset-x-0 bottom-0 max-h-[80vh] w-full',
};

export type DrawerProps = {
  title: string;
  description?: string;
  trigger?: ReactNode;
  children?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: DrawerSide;
  /** Has a close button and closes on Escape or an overlay click (default). */
  dismissible?: boolean;
  /** Escape or an overlay click is about to close it; call preventDefault on the event to keep it open. */
  onDismiss?: (event: Event) => void;
  closeLabel?: string;
};

/** A modal panel that slides in from an edge (Radix Dialog with an edge placement). */
export function Drawer({ title, description, trigger, children, open, defaultOpen, onOpenChange, side = 'right', dismissible = true, onDismiss, closeLabel = 'Close' }: DrawerProps) {
  const guard = (event: Event) => { onDismiss?.(event); if (!dismissible) event.preventDefault(); };
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <DrawerTrigger trigger={trigger} />
      <RadixDialog.Portal>
        <RadixDialog.Overlay data-part="overlay" className="fixed inset-0 z-40 bg-slate-900/50" />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onEscapeKeyDown={guard}
          onPointerDownOutside={guard}
          data-side={side}
          className={`fixed z-50 flex flex-col gap-4 overflow-y-auto bg-white p-6 shadow-xl focus:outline-none ${SIDES[side]}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <RadixDialog.Title className="text-lg font-semibold text-slate-900">{title}</RadixDialog.Title>
              <DrawerDescription text={description} />
            </div>
            <DrawerClose show={dismissible} label={closeLabel} />
          </div>
          <DrawerBody content={children} />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function DrawerTrigger({ trigger }: { trigger?: ReactNode }) {
  if (!trigger) return null;
  return <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>;
}

function DrawerDescription({ text }: { text?: string }) {
  if (!text) return null;
  return <RadixDialog.Description className="mt-1 text-sm text-slate-600">{text}</RadixDialog.Description>;
}

function DrawerBody({ content }: { content?: ReactNode }) {
  if (content === undefined || content === null) return null;
  return <div data-part="body">{content}</div>;
}

function DrawerClose({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <RadixDialog.Close aria-label={label} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">
      <span aria-hidden="true">✕</span>
    </RadixDialog.Close>
  );
}
