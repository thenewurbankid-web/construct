// @line-level molecule
'use client';
import { Select as RadixSelect } from 'radix-ui';
import { Field } from './Field';

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectSize = 'sm' | 'md' | 'lg';
const SIZES: Record<SelectSize, string> = { sm: 'h-8 text-xs', md: 'h-10 text-sm', lg: 'h-12 text-base' };

export type SelectProps = {
  label: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  size?: SelectSize;
  className?: string;
};

/** Pick one option from a closed list (Radix Select: a select-only combobox). */
export function Select({ label, options, value, defaultValue, onValueChange, open, defaultOpen, onOpenChange, placeholder = 'Choose…', description, error, disabled, required, name, size = 'md', className = '' }: SelectProps) {
  return (
    <Field label={label} description={description} error={error} required={required} disabled={disabled} className={className}>
      {({ required: req, disabled: dis, ...control }) => (
        <RadixSelect.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange} open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} disabled={dis} required={req} name={name}>
          <RadixSelect.Trigger
            {...control}
            aria-required={req}
            data-size={size}
            className={`inline-flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-slate-900 hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-slate-500 aria-[invalid=true]:border-red-600 ${SIZES[size]}`}
          >
            <RadixSelect.Value placeholder={placeholder} />
            <RadixSelect.Icon aria-hidden="true">▾</RadixSelect.Icon>
          </RadixSelect.Trigger>
          <RadixSelect.Portal>
            <RadixSelect.Content aria-labelledby={control['aria-labelledby']} position="popper" sideOffset={4} className="z-50 min-w-[var(--radix-select-trigger-width)] rounded-md border border-slate-200 bg-white shadow-md">
              <RadixSelect.Viewport className="p-1">
                {options.map((o) => (
                  <RadixSelect.Item key={o.value} value={o.value} disabled={o.disabled} className="flex cursor-pointer items-center justify-between rounded px-3 py-1.5 text-sm text-slate-900 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-slate-100">
                    <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                    <RadixSelect.ItemIndicator aria-hidden="true">✓</RadixSelect.ItemIndicator>
                  </RadixSelect.Item>
                ))}
              </RadixSelect.Viewport>
            </RadixSelect.Content>
          </RadixSelect.Portal>
        </RadixSelect.Root>
      )}
    </Field>
  );
}
