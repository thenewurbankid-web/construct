// @line-level molecule
'use client';
import { Label } from 'radix-ui';
import { useId, type ReactNode } from 'react';

/** The props Field hands its control: spread them onto the input, select trigger or textarea. */
export type FieldControlProps = {
  id: string;
  'aria-labelledby': string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
  disabled?: boolean;
};

export type FieldProps = {
  label: string;
  /** Renders the control from the wiring props. */
  children: (control: FieldControlProps) => ReactNode;
  description?: string;
  /** Shown under the control (role="alert"); makes the control invalid. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

/** Wires a label, any control, help text and an error together (the FieldError part included). */
export function Field({ label, children, description, error, required = false, disabled = false, className = '' }: FieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const control: FieldControlProps = {
    id,
    'aria-labelledby': labelId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    required: required || undefined,
    disabled: disabled || undefined,
  };
  return (
    <div role="group" aria-labelledby={labelId} data-invalid={error ? '' : undefined} data-disabled={disabled ? '' : undefined} className={`flex flex-col gap-1.5 ${className}`}>
      <Label.Root id={labelId} htmlFor={id} className="text-sm font-medium text-slate-900 data-[disabled]:opacity-50">
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-red-600">*</span> : null}
      </Label.Root>
      {children(control)}
      {description ? <p id={descriptionId} data-part="description" className="text-sm text-slate-600">{description}</p> : null}
      {error ? <p id={errorId} role="alert" data-part="error" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
