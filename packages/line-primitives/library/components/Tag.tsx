// @line-level atom
'use client';
import type { KeyboardEvent } from 'react';

export type TagProps = {
  label: string;
  /** Shows a remove button; Backspace or Delete on the tag removes it too. */
  onRemove?: () => void;
  /** Makes it a toggle (aria-pressed). */
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  variant?: 'neutral' | 'brand';
  size?: 'sm' | 'md';
};

const VARIANTS = { neutral: 'bg-slate-100 text-slate-800', brand: 'bg-slate-900 text-white' };

/** A small token that can be selected or removed. */
export function Tag({ label, onRemove, onPress, selected = false, disabled = false, variant = 'neutral', size = 'md' }: TagProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (onRemove && !disabled && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); onRemove(); }
  };
  return (
    <span data-variant={variant} data-size={size} data-disabled={disabled ? '' : undefined} className={`inline-flex items-center gap-1 rounded-full font-medium data-[disabled]:opacity-50 ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'} ${VARIANTS[variant]}`}>
      <TagLabel label={label} onPress={onPress} selected={selected} disabled={disabled} onKeyDown={onKeyDown} />
      <RemoveButton label={label} show={Boolean(onRemove)} disabled={disabled} onRemove={onRemove} onKeyDown={onKeyDown} />
    </span>
  );
}

type LabelProps = { label: string; onPress?: () => void; selected: boolean; disabled: boolean; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };

function TagLabel({ label, onPress, selected, disabled, onKeyDown }: LabelProps) {
  if (!onPress) return <span data-part="label">{label}</span>;
  return <button type="button" data-part="label" aria-pressed={selected} disabled={disabled} onClick={onPress} onKeyDown={onKeyDown} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">{label}</button>;
}

type RemoveProps = { label: string; show: boolean; disabled: boolean; onRemove?: () => void; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };

function RemoveButton({ label, show, disabled, onRemove, onKeyDown }: RemoveProps) {
  if (!show) return null;
  return (
    <button type="button" data-part="remove" aria-label={`Remove ${label}`} disabled={disabled} onClick={onRemove} onKeyDown={onKeyDown} className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
      <span aria-hidden="true">✕</span>
    </button>
  );
}
