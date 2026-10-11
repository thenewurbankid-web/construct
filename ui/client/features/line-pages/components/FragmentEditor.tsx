'use client';

import { useId, useState, type ReactNode } from 'react';
import type { CodeFragment, FragmentOutcome, SaveOutcome } from '../types';

type FragmentEditorProps = {
  /** One FragmentForm per piece of code on the part. */
  children: ReactNode;
};

function toggleLabel(open: boolean): string {
  if (open) return 'Close code';
  return 'Edit code';
}

function saveLabel(busy: boolean): string {
  if (busy) return 'Saving';
  return 'Save';
}

/** The last refusal, when it belongs to this fragment. */
export function refusalFor(refusal: FragmentOutcome | null, fragment: CodeFragment): SaveOutcome | null {
  if (refusal && refusal.fragmentId === fragment.id) return refusal.outcome;
  return null;
}

/** The technical lines under Details: the parser or type message, then any rule findings. */
function detailText(outcome: SaveOutcome): string {
  const lines = outcome.findings.map((f) => `${f.rule} ${f.file}:${f.line}: ${f.sentence}`);
  if (outcome.detail) lines.unshift(outcome.detail);
  return lines.join('\n');
}

/** "Edit code" on a part (cx1): opens just the pieces of code on it (a handler, a prop's value, a condition, a style),
 * each with its plain-English label, a small code box and Save. The rest of the file stays hidden. A refused Save
 * shows its sentence next to the code, with the parser or type message in a collapsed Details. */
export function FragmentEditor({ children }: FragmentEditorProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="lp-code" data-testid="lp-code">
      <button type="button" className="ui-button lp-code-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} data-testid="lp-code-toggle">
        {toggleLabel(open)}
      </button>
      <div id={panelId} className="lp-code-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

type FragmentFormProps = { fragment: CodeFragment; busy: boolean; refusal: SaveOutcome | null; onSave: (fragment: CodeFragment, code: string) => void };

/** One piece of code: its label, the code box, Save, and the refusal when the last Save of it was refused. */
export function FragmentForm({ fragment, busy, refusal, onSave }: FragmentFormProps) {
  const id = useId();
  const [code, setCode] = useState(fragment.code);
  const changed = code.trim() !== fragment.code;
  const rows = Math.min(8, Math.max(2, code.split('\n').length));
  return (
    <form
      className="lp-fragment"
      data-testid="lp-fragment"
      data-kind={fragment.kind}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(fragment, code);
      }}
    >
      <label htmlFor={id} className="lp-fragment-label">
        {fragment.label}
      </label>
      <textarea id={id} className="lp-fragment-code" value={code} rows={rows} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={(e) => setCode(e.target.value)} />
      <div className="lp-fragment-actions">
        <button type="submit" className="ui-button ui-button--primary" disabled={busy || !changed}>
          {saveLabel(busy)}
        </button>
        <button type="button" className="ui-button" hidden={!changed} onClick={() => setCode(fragment.code)} disabled={busy}>
          Undo my changes
        </button>
      </div>
      <FragmentRefusal outcome={refusal} />
    </form>
  );
}

/** A refused code Save: the sentence first, the technical reason in a collapsed Details. Nothing when there is none. */
function FragmentRefusal({ outcome }: { outcome: SaveOutcome | null }) {
  if (!outcome) return null;
  const detail = detailText(outcome);
  return (
    <div className="lp-outcome lp-outcome--refused" role="alert" data-testid="lp-fragment-refusal">
      <p>{outcome.sentence}</p>
      <details className="lp-details" hidden={!detail}>
        <summary>Details</summary>
        <pre className="lp-fragment-detail" data-testid="lp-fragment-detail">
          {detail}
        </pre>
      </details>
    </div>
  );
}
