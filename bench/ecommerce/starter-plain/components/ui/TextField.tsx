'use client';
import * as Label from '@radix-ui/react-label';
import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  /** One sentence shown under the field and announced with it. */
  error?: string;
};

export function TextField({ label, value, onChange, error, type = 'text', id, ...rest }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-1">
      <Label.Root htmlFor={inputId} className="text-sm font-medium">{label}</Label.Root>
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm aria-[invalid=true]:border-red-600"
        {...rest}
      />
      {error ? <p id={errorId} role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
