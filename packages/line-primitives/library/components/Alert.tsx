// @line-level atom
'use client';
import type { ReactNode } from 'react';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';
const VARIANTS: Record<AlertVariant, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  success: 'border-green-200 bg-green-50 text-green-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-900',
};
const ICONS: Record<AlertVariant, string> = { info: 'ℹ', success: '✓', warning: '!', error: '✕' };
/** Warnings and errors interrupt (role="alert"); info and success wait their turn (role="status"). */
const ROLES: Record<AlertVariant, 'alert' | 'status'> = { info: 'status', success: 'status', warning: 'alert', error: 'alert' };

export type AlertProps = {
  title: string;
  children?: ReactNode;
  variant?: AlertVariant;
  /** Shows a Dismiss button. */
  onDismiss?: () => void;
  className?: string;
};

/** An inline message that draws attention, optionally dismissible. */
export function Alert({ title, children, variant = 'info', onDismiss, className = '' }: AlertProps) {
  return (
    <div role={ROLES[variant]} data-variant={variant} className={`flex items-start gap-3 rounded-md border p-4 ${VARIANTS[variant]} ${className}`}>
      <span aria-hidden="true" data-part="icon" className="font-bold">{ICONS[variant]}</span>
      <div className="flex-1">
        <p data-part="title" className="text-sm font-semibold">{title}</p>
        <AlertDescription content={children} />
      </div>
      <AlertDismiss onDismiss={onDismiss} />
    </div>
  );
}

function AlertDescription({ content }: { content?: ReactNode }) {
  if (content === undefined || content === null) return null;
  return <div data-part="description" className="mt-1 text-sm">{content}</div>;
}

function AlertDismiss({ onDismiss }: { onDismiss?: () => void }) {
  if (!onDismiss) return null;
  return (
    <button type="button" aria-label="Dismiss" onClick={onDismiss} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
      <span aria-hidden="true">✕</span>
    </button>
  );
}
