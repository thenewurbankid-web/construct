import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui';
import type { CloneDialogView } from '../types';

type CloneDialogProps = {
  dialog: CloneDialogView;
  onName: (name: string) => void;
  onCreate: () => void;
  onCancel: () => void;
  onShowCode: () => void;
};

/** The lock's refusal, made useful: says why a generated test cannot be edited and offers the clone right here.
 * A real modal dialog, behind `components/ui`'s Dialog wrapper (#441): Radix Primitives owns the focus trap,
 * Esc-to-close and return-focus-to-trigger that this used to hand-roll. */
export function CloneDialog({ dialog, onName, onCreate, onCancel, onShowCode }: CloneDialogProps) {
  const input = useRef<HTMLInputElement>(null);
  const { slug } = dialog;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="ts-dialog"
        backdropClassName="ts-backdrop"
        backdropTestId="clone-backdrop"
        data-testid="clone-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
          input.current?.select();
        }}
      >
        <div className="ts-dialog-head">
          <DialogTitle asChild>
            <h2>This test is generated: clone it to edit</h2>
          </DialogTitle>
          <DialogDescription asChild>
            <p data-testid="clone-reason">{dialog.reason}</p>
          </DialogDescription>
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
      </DialogContent>
    </Dialog>
  );
}
