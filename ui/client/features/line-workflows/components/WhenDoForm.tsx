'use client';

import { useState } from 'react';
import type { LineWorkflow, LineWorkflowState, WhenDoDraft } from '../types';

type WhenDoFormProps = {
  workflow: LineWorkflow;
  initial: WhenDoDraft;
  check: (draft: WhenDoDraft) => string | null;
  busy: boolean;
  onAdd: (draft: WhenDoDraft) => void;
};

const stateOption = (s: LineWorkflowState) => (
  <option key={s.id} value={s.id}>
    {s.label}
  </option>
);

/** Why the draft cannot be added, once the person tried. */
function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="lw-warn" role="alert">
      {text}
    </p>
  );
}

/** Add a When -> Do: when a state's page sends an event, optionally call a service or set a part's state, then go to
 * a state. Adding puts one step in the plan; nothing changes until the person approves it. */
export function WhenDoForm({ workflow, initial, check, busy, onAdd }: WhenDoFormProps) {
  const [draft, setDraft] = useState<WhenDoDraft>(initial);
  const [tried, setTried] = useState(false);
  const set = (k: keyof WhenDoDraft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const problem = check(draft);
  const options = workflow.states.map(stateOption);
  return (
    <form
      className="lw-form"
      aria-label="Add a When and Do"
      data-testid="lw-whendo-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!problem) onAdd(draft);
      }}
    >
      <div className="lw-form-row">
        <label>
          When
          <select value={draft.from} onChange={set('from')} aria-label="When this state">
            {options}
          </select>
        </label>
        <label>
          sends
          <input value={draft.event} onChange={set('event')} placeholder="CANCEL" aria-label="Event" />
        </label>
      </div>
      <div className="lw-form-row">
        <label>
          Do: go to
          <select value={draft.to} onChange={set('to')} aria-label="Go to">
            {options}
          </select>
        </label>
        <label>
          and call the service (optional)
          <input value={draft.service} onChange={set('service')} placeholder="cancelOrder" aria-label="Service to call" />
        </label>
      </div>
      <details className="lw-details">
        <summary>Also set a part&apos;s state</summary>
        <div className="lw-form-row">
          <label>
            Part
            <input value={draft.part} onChange={set('part')} placeholder="OrderCard" aria-label="Part" />
          </label>
          <label>
            State
            <input value={draft.partState} onChange={set('partState')} placeholder="loading" aria-label="Part state" />
          </label>
        </div>
      </details>
      <Problem text={tried ? problem : null} />
      <button type="submit" className="lw-btn lw-btn--primary" disabled={busy}>
        Add to plan
      </button>
    </form>
  );
}
