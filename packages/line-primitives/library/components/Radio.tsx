// @line-level molecule
'use client';
import { Label, RadioGroup } from 'radix-ui';
import { useId, useState } from 'react';

export type RadioOption = { value: string; label: string; disabled?: boolean };
export type RadioProps = {
  /** The group's name (its legend). */
  label: string;
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  /** Shows the choice; choosing is ignored (aria-readonly). */
  readOnly?: boolean;
  error?: string;
  orientation?: 'vertical' | 'horizontal';
  name?: string;
  className?: string;
};

/** Pick exactly one of a small set of visible options (Radix RadioGroup: roving focus, arrows choose). */
export function Radio({ label, options, value, defaultValue, onValueChange, disabled, required, readOnly = false, error, orientation = 'vertical', name, className = '' }: RadioProps) {
  const id = useId();
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const change = (next: string) => { if (readOnly) return; setOwn(next); onValueChange?.(next); };
  const legendId = `${id}-legend`;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <span id={legendId} data-part="legend" className="text-sm font-medium text-slate-900">{label}</span>
      <RadioGroup.Root
        aria-labelledby={legendId}
        aria-describedby={errorId}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-readonly={readOnly || undefined}
        value={current ?? ''}
        onValueChange={change}
        disabled={disabled}
        required={required}
        orientation={orientation}
        name={name}
        data-orientation={orientation}
        className={orientation === 'horizontal' ? 'flex flex-row gap-4' : 'flex flex-col gap-2'}
      >
        {options.map((o) => (
          <div key={o.value} className="flex items-center gap-2">
            <RadioGroup.Item
              id={`${id}-${o.value}`}
              value={o.value}
              disabled={o.disabled}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-400 bg-white hover:border-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-slate-900"
            >
              <RadioGroup.Indicator data-part="indicator" className="h-2.5 w-2.5 rounded-full bg-slate-900" />
            </RadioGroup.Item>
            <Label.Root htmlFor={`${id}-${o.value}`} data-part="itemLabel" className="text-sm text-slate-900">{o.label}</Label.Root>
          </div>
        ))}
      </RadioGroup.Root>
      {error ? <p id={errorId} role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
