// @line-level molecule
'use client';
import { useId, type ReactNode } from 'react';

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** The next thing to do; shown as a button with onAction. */
  actionLabel?: string;
  onAction?: () => void;
  size?: 'sm' | 'md';
};

/** What to show when there is nothing yet, with the next thing to do. */
export function EmptyState({ title, description, icon, actionLabel, onAction, size = 'md' }: EmptyStateProps) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} data-size={size} className={`flex flex-col items-center gap-2 text-center ${size === 'sm' ? 'py-6' : 'py-12'}`}>
      <EmptyIcon icon={icon} />
      <h2 id={`${id}-title`} data-part="title" className="text-base font-semibold text-slate-900">{title}</h2>
      <EmptyDescription text={description} />
      <EmptyAction label={actionLabel} onAction={onAction} />
    </section>
  );
}

function EmptyIcon({ icon }: { icon?: ReactNode }) {
  if (!icon) return null;
  return <span aria-hidden="true" data-part="icon" className="text-3xl text-slate-400">{icon}</span>;
}

function EmptyDescription({ text }: { text?: string }) {
  if (!text) return null;
  return <p data-part="description" className="max-w-sm text-sm text-slate-600">{text}</p>;
}

function EmptyAction({ label, onAction }: { label?: string; onAction?: () => void }) {
  if (!label) return null;
  return (
    <button type="button" data-part="action" onClick={onAction} className="mt-2 inline-flex h-10 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
      {label}
    </button>
  );
}
