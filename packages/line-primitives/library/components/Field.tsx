// @line-level atom
'use client';
import { Label } from 'radix-ui';
import { useId, type ReactNode } from 'react';

/** The shared look of a text-like control (TextField, Combobox, DatePicker's trigger); a theming hook-point. */
export const INPUT_LOOK = 'w-full rounded-md border border-slate-300 bg-white px-3 text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-slate-50 aria-[invalid=true]:border-red-600';

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
  /** Say "(required)" in the label for controls that cannot carry a required attribute (a button trigger). */
  announceRequired?: boolean;
  className?: string;
};

/** Wires a label, any control, help text and an error together (the FieldError part included). */
export function Field({ label, children, description, error, required = false, disabled = false, announceRequired = false, className = '' }: FieldProps) {
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
        <RequiredMark show={required} announce={announceRequired} />
      </Label.Root>
      {children(control)}
      {description ? <p id={descriptionId} data-part="description" className="text-sm text-slate-600">{description}</p> : null}
      {error ? <p id={errorId} role="alert" data-part="error" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function RequiredMark({ show, announce }: { show: boolean; announce: boolean }) {
  if (!show) return null;
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 text-red-600">*</span>
      {announce ? <span className="sr-only"> (required)</span> : null}
    </>
  );
}
