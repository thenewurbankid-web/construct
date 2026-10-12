// @line-level atom
'use client';
import { Label, Switch as RadixSwitch } from 'radix-ui';
import { useId } from 'react';

export type SwitchProps = {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  className?: string;
};

/** An on/off setting that applies at once (Radix Switch: role="switch"). */
export function Switch({ label, checked, defaultChecked, onCheckedChange, disabled, name, className = '' }: SwitchProps) {
  const id = useId();
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <RadixSwitch.Root
        id={id}
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-slate-300 transition-colors hover:bg-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-slate-900"
      >
        <RadixSwitch.Thumb data-part="thumb" className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
      </RadixSwitch.Root>
      <Label.Root htmlFor={id} className="text-sm text-slate-900">{label}</Label.Root>
    </div>
  );
}
