import { useState } from 'react';
import type { StepRowModel } from '../types';

type StepEditorProps = { row: StepRowModel; busy: boolean; onSave: (stepId: string, values: Record<string, string>) => void; onCancel: () => void };

/** Change the fields a step allows (name, feature, base, level, features); saving asks for approval again. */
export function StepEditor({ row, busy, onSave, onCancel }: StepEditorProps) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(row.fields.map((f) => [f.key, f.value])));
  if (!row.editing) return null;
  const field = (f: StepRowModel['fields'][number]) => (
    <label key={f.key} className="la-field">
      <span>{f.label}</span>
      <input className="la-input" value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
    </label>
  );
  return (
    <form className="la-edit" aria-label={`Change step ${row.n}`} onSubmit={(e) => { e.preventDefault(); onSave(row.id, values); }}>
      {row.fields.map(field)}
      <div className="la-row">
        <button type="submit" className="la-btn la-btn--primary" disabled={busy}>Save change</button>
        <button type="button" className="la-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
