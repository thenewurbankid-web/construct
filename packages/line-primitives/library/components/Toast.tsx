// @line-level molecule
'use client';
import { Toast as RadixToast } from 'radix-ui';

export type ToastVariant = 'info' | 'success' | 'error';
const VARIANTS: Record<ToastVariant, string> = {
  info: 'border-slate-200 bg-white text-slate-900',
  success: 'border-green-200 bg-green-50 text-green-900',
  error: 'border-red-200 bg-red-50 text-red-900',
};

export type ToastProps = {
  title: string;
  description?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The action button's text; needs onAction. */
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds before it closes by itself. */
  duration?: number;
  variant?: ToastVariant;
  /** Shows a close button (default true). */
  dismissible?: boolean;
};

/**
 * A short, temporary message about something that happened (Radix Toast). Carries its own provider and viewport so it
 * works alone; the viewport is a labelled region reachable with F8.
 */
export function Toast({ title, description, open, defaultOpen = false, onOpenChange, actionLabel, onAction, duration = 5000, variant = 'info', dismissible = true }: ToastProps) {
  return (
    <RadixToast.Provider duration={duration} label="Notification">
      <RadixToast.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        type={variant === 'error' ? 'foreground' : 'background'}
        data-variant={variant}
        className={`flex items-start gap-3 rounded-md border p-4 shadow-md ${VARIANTS[variant]}`}
      >
        <div className="flex-1">
          <RadixToast.Title className="text-sm font-semibold">{title}</RadixToast.Title>
          <ToastDescription text={description} />
        </div>
        <ToastAction label={actionLabel} onAction={onAction} />
        <ToastClose show={dismissible} />
      </RadixToast.Root>
      <RadixToast.Viewport className="fixed bottom-4 right-4 z-50 flex w-96 max-w-[100vw] flex-col gap-2 outline-none" />
    </RadixToast.Provider>
  );
}

function ToastDescription({ text }: { text?: string }) {
  if (!text) return null;
  return <RadixToast.Description className="mt-1 text-sm">{text}</RadixToast.Description>;
}

function ToastAction({ label, onAction }: { label?: string; onAction?: () => void }) {
  if (!label) return null;
  return (
    <RadixToast.Action altText={label} asChild>
      <button type="button" onClick={onAction} className="rounded-md border border-current px-3 py-1 text-sm font-medium hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">{label}</button>
    </RadixToast.Action>
  );
}

function ToastClose({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <RadixToast.Close aria-label="Close" className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
      <span aria-hidden="true">✕</span>
    </RadixToast.Close>
  );
}
