// @line-level atom
'use client';
import { Checkbox as RadixCheckbox, Label } from 'radix-ui';
import { useId } from 'react';

export type CheckboxProps = {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  /** Partly checked (aria-checked="mixed"); wins over checked. */
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  name?: string;
  className?: string;
};

/** A labelled two- or three-state check (Radix Checkbox). */
export function Checkbox({ label, checked, defaultChecked, indeterminate = false, onCheckedChange, disabled, required, error, name, className = '' }: CheckboxProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const state = indeterminate ? 'indeterminate' : checked;
  return (
    <div data-part="root" className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        <RadixCheckbox.Root
          id={id}
          name={name}
          checked={state}
          defaultChecked={defaultChecked}
          onCheckedChange={(v) => onCheckedChange?.(v === true)}
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-400 bg-white hover:border-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-slate-900 data-[state=checked]:bg-slate-900 data-[state=indeterminate]:bg-slate-900 aria-[invalid=true]:border-red-600"
        >
          <RadixCheckbox.Indicator data-part="indicator" className="text-xs leading-none text-white">{indeterminate ? '–' : '✓'}</RadixCheckbox.Indicator>
        </RadixCheckbox.Root>
        <Label.Root htmlFor={id} className="text-sm text-slate-900">{label}</Label.Root>
      </div>
      {error ? <p id={errorId} role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
