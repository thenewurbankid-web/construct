// @line-level atom
'use client';
import { Label } from 'radix-ui';
import { useId, type ReactNode } from 'react';

/** The shared look of a text-like control (TextField, Combobox, DatePicker's trigger); a theming hook-point. */
export const INPUT_LOOK = 'w-full rounded-md border border-slate-300 bg-white px-3 text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-slate-50 aria-[invalid=true]:border-red-600 aria-busy:cursor-progress';

/** The props Field hands its control: spread them onto the input, select trigger or textarea. */
export type FieldControlProps = {
  id: string;
  'aria-labelledby': string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  /** Set while the field's data is loading. */
  'aria-busy'?: true;
  required?: boolean;
  disabled?: boolean;
  /** For native inputs; a control without a readonly attribute reads it and blocks changes itself. */
  readOnly?: boolean;
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
  readOnly?: boolean;
  /** The field's options or value are loading: a spinner by the label, and aria-busy on the control. */
  loading?: boolean;
  /** Say "(required)" in the label for controls that cannot carry a required attribute (a button trigger). */
  announceRequired?: boolean;
  className?: string;
};

/** Wires a label, any control, help text and an error together (the FieldError part included). */
export function Field({ label, children, description, error, required = false, disabled = false, readOnly = false, loading = false, announceRequired = false, className = '' }: FieldProps) {
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
    'aria-busy': loading ? true : undefined,
    required: required || undefined,
    disabled: disabled || undefined,
    readOnly: readOnly || undefined,
  };
  return (
    <div role="group" aria-labelledby={labelId} data-invalid={error ? '' : undefined} data-disabled={disabled ? '' : undefined} data-readonly={readOnly ? '' : undefined} className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-2">
        <Label.Root id={labelId} htmlFor={id} className="text-sm font-medium text-slate-900 data-[disabled]:opacity-50">
          {label}
          <RequiredMark show={required} announce={announceRequired} />
        </Label.Root>
        <LoadingMark show={loading} />
      </div>
      {children(control)}
      <FieldText id={descriptionId} part="description" text={description} />
      <FieldText id={errorId} part="error" text={error} />
    </div>
  );
}

function RequiredMark({ show, announce }: { show: boolean; announce: boolean }) {
  if (!show) return null;
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 text-red-600">*</span>
      <RequiredText show={announce} />
    </>
  );
}

function RequiredText({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="sr-only"> (required)</span>;
}

function LoadingMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span role="status" data-part="loading" className="inline-flex items-center text-slate-500">
      <span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />
      <span className="sr-only">Loading</span>
    </span>
  );
}

/** Help text, or the error (role="alert"). */
function FieldText({ id, part, text }: { id?: string; part: 'description' | 'error'; text?: string }) {
  if (!text) return null;
  if (part === 'error') return <p id={id} role="alert" data-part="error" className="text-sm text-red-700">{text}</p>;
  return <p id={id} data-part="description" className="text-sm text-slate-600">{text}</p>;
}
