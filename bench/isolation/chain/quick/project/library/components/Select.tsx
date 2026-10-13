// @line-level atom
'use client';
import * as Label from '@radix-ui/react-label';
import * as RadixSelect from '@radix-ui/react-select';
import { useId } from 'react';

export type SelectOption = { value: string; label: string };
export type SelectProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
};

/** A labelled select (Radix Select): the trigger is a combobox named by its label; each option is an option role. */
export function Select({ label, value, onValueChange, options, placeholder }: SelectProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label.Root id={`${id}-label`} htmlFor={id} className="text-sm font-medium">{label}</Label.Root>
      <RadixSelect.Root value={value} onValueChange={onValueChange}>
        <RadixSelect.Trigger id={id} aria-labelledby={`${id}-label`} className="inline-flex min-w-48 items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm">
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon>▾</RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content position="popper" className="rounded-md border border-slate-200 bg-white shadow-md">
            <RadixSelect.Viewport className="p-1">
              {options.map((o) => (
                <RadixSelect.Item key={o.value} value={o.value} className="cursor-pointer rounded px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100">
                  <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
