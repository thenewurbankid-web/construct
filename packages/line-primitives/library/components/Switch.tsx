// @line-level atom
'use client';
import { Label, Switch as RadixSwitch } from 'radix-ui';
import { useId, useState } from 'react';

export type SwitchProps = {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Shows its state; toggles are ignored (aria-readonly). */
  readOnly?: boolean;
  required?: boolean;
  /** Shown under it (role="alert"); sets aria-invalid. */
  error?: string;
  name?: string;
  /** What the form submits when it is on. */
  value?: string;
  className?: string;
};

/** An on/off setting that applies at once (Radix Switch: role="switch"). */
export function Switch({ label, checked, defaultChecked = false, onCheckedChange, disabled, readOnly = false, required, error, name, value, className = '' }: SwitchProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const [own, setOwn] = useState(defaultChecked);
  const current = checked ?? own;
  const change = (next: boolean) => { if (readOnly) return; setOwn(next); onCheckedChange?.(next); };
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-3">
        <RadixSwitch.Root
          id={id}
          name={name}
          value={value}
          checked={current}
          onCheckedChange={change}
          disabled={disabled}
          required={required}
          aria-readonly={readOnly || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-slate-300 transition-colors hover:bg-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-slate-900"
        >
          <RadixSwitch.Thumb data-part="thumb" className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
        </RadixSwitch.Root>
        <Label.Root htmlFor={id} className="text-sm text-slate-900">{label}</Label.Root>
      </div>
      <SwitchError id={errorId} text={error} />
    </div>
  );
}

function SwitchError({ id, text }: { id?: string; text?: string }) {
  if (!text) return null;
  return <p id={id} role="alert" className="text-sm text-red-700">{text}</p>;
}
