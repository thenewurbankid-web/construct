// @line-level molecule
'use client';
import type { FocusEvent } from 'react';
import { Field, INPUT_LOOK } from './Field';

export type TextFieldSize = 'sm' | 'md' | 'lg';
const SIZES: Record<TextFieldSize, string> = { sm: 'h-8 text-xs', md: 'h-10 text-sm', lg: 'h-12 text-base' };

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
  /** Its data is loading: a spinner by the label and aria-busy on the input. */
  loading?: boolean;
  placeholder?: string;
  type?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url';
  name?: string;
  size?: TextFieldSize;
  className?: string;
};

/** A labelled single-line text input with help text and an error. */
export function TextField({ label, value, defaultValue, onValueChange, onFocus, onBlur, description, error, disabled, readOnly, required, loading, placeholder, type = 'text', name, size = 'md', className = '' }: TextFieldProps) {
  return (
    <Field label={label} description={description} error={error} required={required} disabled={disabled} readOnly={readOnly} loading={loading} className={className}>
      {(control) => (
        <input
          {...control}
          type={type}
          name={name}
          value={value}
          defaultValue={defaultValue}
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
