'use client';

import { useState } from 'react';
import type { CatalogueProps } from '../types';

/** Add a step from the flow catalogue (the whitelist of flows Construct can run), or take the read-only steps the impact suggests. */
export function CatalogueBar({ flows, suggestionCount, onAdd, onAddSuggested }: CatalogueProps) {
  const [choice, setChoice] = useState('');
  return (
    <>
      <div className="pl-add">
        <label className="pl-sr" htmlFor="plan-add-flow">Add a step</label>
        <select id="plan-add-flow" value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="plan-add-flow">
          <option value="">Add a step from the catalogue...</option>
          {flows.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        <button type="button" className="dg-btn" disabled={!choice} onClick={() => { onAdd(choice); setChoice(''); }} data-testid="plan-add">Add</button>
      </div>
      {suggestionCount > 0 && (
        <button type="button" className="dg-btn" onClick={onAddSuggested} data-testid="plan-add-suggested">
          Add {suggestionCount} read-only step{suggestionCount === 1 ? '' : 's'} from the impact
        </button>
      )}
    </>
  );
}
