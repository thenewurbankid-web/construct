// @line-level molecule
'use client';
import type { FocusEvent } from 'react';
import { Field } from './Field';

export type TextFieldSize = 'sm' | 'md' | 'lg';
const SIZES: Record<TextFieldSize, string> = { sm: 'h-8 text-xs', md: 'h-10 text-sm', lg: 'h-12 text-base' };
export const INPUT_LOOK = 'w-full rounded-md border border-slate-300 bg-white px-3 text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-slate-50 aria-[invalid=true]:border-red-600';

export type TextFieldProps = {
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  description?: string;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  type?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url';
  name?: string;
  size?: TextFieldSize;
  className?: string;
};

/** A labelled single-line text input with help text and an error. */
export function TextField({ label, value, defaultValue, onValueChange, onFocus, onBlur, description, error, disabled, readOnly, required, placeholder, type = 'text', name, size = 'md', className = '' }: TextFieldProps) {
  return (
    <Field label={label} description={description} error={error} required={required} disabled={disabled} className={className}>
      {(control) => (
        <input
          {...control}
          type={type}
          name={name}
          value={value}
          defaultValue={defaultValue}
          readOnly={readOnly}
          placeholder={placeholder}
          data-size={size}
          onChange={(e) => onValueChange?.(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          className={`${INPUT_LOOK} ${SIZES[size]}`}
        />
      )}
    </Field>
  );
}
