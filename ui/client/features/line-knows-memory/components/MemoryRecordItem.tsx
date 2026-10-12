import { useState } from 'react';
import { Details } from '@/lib/ChatEntry';
import type { MemoryRow } from '@/lib/lineKnowsContract';
import { optionWords } from '../domain/MemoryTab';
import type { MemoryTabAction } from '../workflows/MemoryActions';

type Act = { busy: boolean; act: (action: MemoryTabAction) => void };

/** Correct this decision to another option Line offered for it (only when there is another one). */
function EditDecision({ row, busy, act }: Act & { row: MemoryRow }) {
  const [chosen, setChosen] = useState(row.chosen ?? row.options[0] ?? '');
  if (row.options.length < 2) return null;
  const id = `mem-edit-${row.id}`;
  return (
    <span className="lkm-edit">
      <label htmlFor={id}>Remember instead</label>
      <select id={id} value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={busy}>
        {row.options.map((o) => (
          <option key={o} value={o}>
            {optionWords(o)}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => act({ kind: 'edit', id: row.id, chosen })} disabled={busy || chosen === row.chosen} aria-label={`Save this decision: ${row.outcome}`}>
        Save
      </button>
    </span>
  );
}

/** One remembered decision: what you did, for what, when; edit it or forget it. */
export function MemoryRecordItem({ row, busy, act }: Act & { row: MemoryRow }) {
  return (
    <li className="lkm-record" data-testid="memory-record" data-id={row.id} data-step={row.step}>
      <p className="lkm-what">
        {row.outcome} for &apos;{row.intent}&apos;.
        <span className="lkm-when"> {row.when}</span>
      </p>
      <div className="lkm-actions">
        <EditDecision row={row} busy={busy} act={act} />
        <button type="button" className="lkm-forget" onClick={() => act({ kind: 'forgetRecord', id: row.id })} disabled={busy} aria-label={`Forget this decision: ${row.outcome} for '${row.intent}', ${row.when}`}>
          Forget this decision
        </button>
      </div>
      <Details lines={[`Record ${row.id}`, `Step ${row.step}`, `Options: ${row.options.join(', ')}`, `Kept: ${row.chosen ?? 'none'}`]} />
    </li>
  );
}
