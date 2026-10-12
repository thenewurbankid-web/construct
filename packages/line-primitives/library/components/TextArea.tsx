// @line-level molecule
'use client';
import { useState, type FocusEvent } from 'react';
import { Field } from './Field';

export type TextAreaProps = {
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onFocus?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  description?: string;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  /** Caps the length and shows a "n / max" counter. */
  maxLength?: number;
  name?: string;
  className?: string;
};

/** A labelled multi-line text input with help text, an error and an optional character count. */
export function TextArea({ label, value, defaultValue, onValueChange, onFocus, onBlur, description, error, disabled, readOnly, required, placeholder, rows = 3, maxLength, name, className = '' }: TextAreaProps) {
  const [own, setOwn] = useState(defaultValue ?? '');
  const text = value ?? own;
  return (
    <Field label={label} description={description} error={error} required={required} disabled={disabled} className={className}>
      {(control) => (
        <>
          <textarea
            {...control}
            name={name}
            rows={rows}
            maxLength={maxLength}
            value={text}
            readOnly={readOnly}
            placeholder={placeholder}
            onChange={(e) => { setOwn(e.target.value); onValueChange?.(e.target.value); }}
            onFocus={onFocus}
            onBlur={onBlur}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-slate-50 aria-[invalid=true]:border-red-600"
          />
          {maxLength ? <span data-part="counter" aria-live="polite" className="self-end text-xs text-slate-500">{text.length} / {maxLength}</span> : null}
        </>
      )}
    </Field>
  );
}
