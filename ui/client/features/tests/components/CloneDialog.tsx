import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { CloneDialogView } from '../types';

type CloneDialogProps = {
  dialog: CloneDialogView;
  onName: (name: string) => void;
  onCreate: () => void;
  onCancel: () => void;
  onShowCode: () => void;
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

/** The lock's refusal, made useful: says why a generated test cannot be edited and offers the clone right here.
 * A real modal dialog: focus moves in, Tab is trapped, Esc closes, and focus returns to what opened it. */
export function CloneDialog({ dialog, onName, onCreate, onCancel, onShowCode }: CloneDialogProps) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { slug } = dialog;

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    input.current?.focus();
    input.current?.select();
    return () => {
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !root.current) return;
    const items = Array.from(root.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ts-backdrop" data-testid="clone-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={root} className="ts-dialog" role="dialog" aria-modal="true" aria-labelledby="ts-clone-title" aria-describedby="ts-clone-why" data-testid="clone-dialog" onKeyDown={onKeyDown}>
        <div className="ts-dialog-head">
          <h2 id="ts-clone-title">This test is generated: clone it to edit</h2>
          <p id="ts-clone-why" data-testid="clone-reason">{dialog.reason}</p>
        </div>
        <div className="ts-dialog-body">
          <label className="ts-label">
            Name your test
            <input ref={input} className="ts-input" type="text" value={dialog.name} onChange={(e) => onName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && slug && !dialog.busy && onCreate()} aria-describedby="ts-clone-saved" data-testid="clone-name" spellCheck={false} autoComplete="off" />
          </label>
          <div>
            <div className="ts-label">Saved as</div>
            <div className="ts-saved" id="ts-clone-saved" data-testid="clone-path">{dialog.savedAs}</div>
          </div>
          <div>
            <div className="ts-label">What you get</div>
            <ul className="ts-gets" data-testid="clone-gets">
              <li>{dialog.steps ? `All ${dialog.steps} steps, copied. Editable.` : 'The whole test, copied. Editable.'}</li>
              <li>A note of where it came from: <span className="ts-mono">{dialog.lineageNote}</span></li>
              <li>So we can tell you later if the flow changes and your test drifts.</li>
            </ul>
          </div>
          {dialog.error && <p className="ts-err" role="alert" data-testid="clone-error">{dialog.error}</p>}
        </div>
        <div className="ts-dialog-foot">
          <button type="button" className="ts-btn ts-btn--primary" data-testid="clone-create" disabled={!slug || dialog.busy} onClick={onCreate}>{dialog.busy ? 'Cloning...' : 'Create clone and open'}</button>
          <button type="button" className="ts-btn" data-testid="clone-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="ts-btn ts-spacer" data-testid="clone-show-code" onClick={onShowCode}>Just show me the code</button>
        </div>
      </div>
    </div>
  );
}
