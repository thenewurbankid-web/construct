// @line-level molecule
'use client';
import { useId, type FormEvent, type ReactNode } from 'react';

export type FormProps = {
  /** Names the form. */
  label: string;
  children: ReactNode;
  /** The submitted values (FormData entries by field name). */
  onSubmit?: (values: Record<string, FormDataEntryValue>) => void;
  onReset?: () => void;
  /** Submitting: the fields are disabled and the form is aria-busy. */
  submitting?: boolean;
  /** A form-level error (role="alert"). */
  error?: string;
  submitLabel?: string;
  /** Shows a reset button with this text. */
  resetLabel?: string;
  layout?: 'stacked' | 'inline';
};

/** A set of fields submitted together, with a submitting state and a form-level error. */
export function Form({ label, children, onSubmit, onReset, submitting = false, error, submitLabel = 'Submit', resetLabel, layout = 'stacked' }: FormProps) {
  const id = useId();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    onSubmit?.(Object.fromEntries(new FormData(e.currentTarget).entries()));
  };
  return (
    <form aria-labelledby={`${id}-label`} aria-busy={submitting || undefined} onSubmit={submit} onReset={() => onReset?.()} data-layout={layout} className="flex flex-col gap-4">
      <h2 id={`${id}-label`} className="text-lg font-semibold text-slate-900">{label}</h2>
      <fieldset disabled={submitting} data-part="fieldset" className={layout === 'inline' ? 'flex flex-wrap items-end gap-4' : 'flex flex-col gap-4'}>
        {children}
      </fieldset>
      <FormError text={error} />
      <div data-part="actions" className="flex gap-2">
        <button type="submit" data-part="submit" disabled={submitting} className="inline-flex h-10 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50">
          {submitLabel}
        </button>
        <ResetButton label={resetLabel} disabled={submitting} />
      </div>
    </form>
  );
}

function FormError({ text }: { text?: string }) {
  if (!text) return null;
  return <p role="alert" data-part="error" className="text-sm text-red-700">{text}</p>;
}

function ResetButton({ label, disabled }: { label?: string; disabled: boolean }) {
  if (!label) return null;
  return <button type="reset" disabled={disabled} className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-50">{label}</button>;
}
