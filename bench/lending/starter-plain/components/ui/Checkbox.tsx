'use client';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import * as Label from '@radix-ui/react-label';
import { useId } from 'react';

export type CheckboxProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string;
};

/** A labelled checkbox (Radix Checkbox: role checkbox, named by its label). */
export function Checkbox({ label, checked, onCheckedChange, error }: CheckboxProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <RadixCheckbox.Root id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} aria-invalid={error ? true : undefined} className="flex h-5 w-5 items-center justify-center rounded border border-slate-400 data-[state=checked]:bg-slate-900">
          <RadixCheckbox.Indicator className="text-xs text-white">✓</RadixCheckbox.Indicator>
        </RadixCheckbox.Root>
        <Label.Root htmlFor={id} className="text-sm">{label}</Label.Root>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
