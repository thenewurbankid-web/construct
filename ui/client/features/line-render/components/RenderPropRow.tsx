'use client';

import { useId } from 'react';
import type { RenderPropRowView } from '../types';

type RenderPropRowProps = { row: RenderPropRowView; onChange: (raw: string | boolean) => void };

/** One prop as a plain row: name, type, and a field to change its value (text, number or a tick box). A prop with
 * no simple sample (a function, an object) is listed with its value as text and no field. */
export function RenderPropRow({ row, onChange }: RenderPropRowProps) {
  const id = useId();
  const { prop, input, text } = row;
  return (
    <li className="lr-prop" data-testid="lr-prop" data-prop={prop.name}>
      <label className="lr-prop-name" htmlFor={id}>
        {prop.name}
      </label>
      <span className="lr-prop-type">{prop.type}</span>
      {prop.kind === 'boolean' && <input id={id} type="checkbox" checked={Boolean(input)} onChange={(e) => onChange(e.target.checked)} />}
      {(prop.kind === 'string' || prop.kind === 'number') && (
        <input id={id} type={prop.kind === 'number' ? 'number' : 'text'} value={String(input)} onChange={(e) => onChange(e.target.value)} />
      )}
      {prop.kind === 'other' && (
        <span id={id} className="lr-prop-value" data-testid="lr-prop-value">
          {text}
        </span>
      )}
    </li>
  );
}
