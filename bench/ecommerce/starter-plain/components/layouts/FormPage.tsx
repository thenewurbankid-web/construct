'use client';
import type { FormEvent, ReactNode } from 'react';
import { Button } from '../ui/Button';

export type FormPageProps = {
  title: string;
  /** Called with the submit event already prevented. */
  onSubmit: () => void;
  submitLabel: string;
  children?: ReactNode;
  /** A summary shown beside the form (an order total, say). */
  aside?: ReactNode;
};

export function FormPage({ title, onSubmit, submitLabel, children, aside }: FormPageProps) {
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(); };
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={title}>
          {children}
          <Button type="submit" label={submitLabel} />
        </form>
        {aside ? <aside className="flex flex-col gap-3">{aside}</aside> : null}
      </div>
    </main>
  );
}
