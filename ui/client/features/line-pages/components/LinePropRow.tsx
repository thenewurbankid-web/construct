'use client';

import { useId, useState } from 'react';
import type { PartProp } from '../types';

type LinePropRowProps = {
  prop: PartProp;
  busy: boolean;
  onSave: (raw: string | boolean) => void;
};

/** One prop of a part: its name, an input of its kind, and Save. The value on disk is shown as "Now". */
export function LinePropRow({ prop, busy, onSave }: LinePropRowProps) {
  const id = useId();
  const [value, setValue] = useState<string | boolean>(prop.kind === 'boolean' ? Boolean(prop.value) : String(prop.value));
  const changed = prop.kind === 'boolean' ? value !== prop.value : value !== String(prop.value);
  return (
    <form
      className="prop-row lp-prop"
      data-testid="lp-prop"
      data-prop={prop.name}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <label className="prop-name" htmlFor={id}>
        {prop.name}
      </label>
      {prop.kind === 'boolean' ? (
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => setValue(e.target.checked)} />
      ) : (
        <input id={id} type={prop.kind === 'number' ? 'number' : 'text'} value={String(value)} onChange={(e) => setValue(e.target.value)} />
      )}
      <button type="submit" className="ui-button ui-button--primary" disabled={busy || !changed}>
        {busy ? 'Saving' : 'Save'}
      </button>
      <span className="lp-now" data-testid="lp-prop-now">
        Now: {prop.kind === 'boolean' ? (prop.value ? 'yes' : 'no') : String(prop.value)}
      </span>
    </form>
  );
}
