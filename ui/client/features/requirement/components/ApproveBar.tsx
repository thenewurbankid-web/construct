import { Button } from '@/components/ui';
import type { ApproveBarProps } from '../types';

/**
 * Step 5: approve the plan, or keep the card as a note. Approving does not write files: it starts a process through the Plan
 * screen's own route, where each file still needs your approval before it reaches the project.
 */
export function ApproveBar({ approve, warnings, files, onApprove, onSaveNote, onOpenProcesses }: ApproveBarProps) {
  return (
    <section className="rq-card" aria-labelledby="rq-approve-h" data-testid="requirement-approve">
      <h2 className="rq-h2" id="rq-approve-h">5. Approve</h2>
      {files.length > 0 && (
        <details className="rq-files-all" data-testid="requirement-files">
          <summary>{files.length} files will be created</summary>
          <ul className="rq-files">
            {files.map((f) => (
              <li key={f} data-testid="requirement-file"><code>{f}</code></li>
            ))}
          </ul>
        </details>
      )}
      {warnings.map((w) => (
        <p key={w} className="rq-warn" role="status" data-testid="requirement-warning">{w}</p>
      ))}
      <div className="rq-row">
        <Button type="button" disabled={!approve.canApprove} onClick={onApprove} data-testid="requirement-approve-plan">
          {approve.running ? 'Starting...' : 'Approve plan'}
        </Button>
        <Button type="button" variant="ghost" disabled={approve.saveState === 'saving'} onClick={onSaveNote} data-testid="requirement-save-note">
          Save as note
        </Button>
        {approve.hint && <span className="rq-muted" data-testid="requirement-approve-hint">{approve.hint}</span>}
      </div>
      {approve.started && (
        <p className="rq-ok" role="status" data-testid="requirement-started">
          Plan approved: process {approve.processId} started. Nothing reaches your project until you approve each file.{' '}
          <button type="button" className="rq-link" onClick={onOpenProcesses}>Open the process</button>
        </p>
      )}
      {approve.error && <p className="rq-error" role="alert" data-testid="requirement-approve-error">{approve.error}</p>}
      {approve.saveState === 'saved' && <p className="rq-ok" role="status" data-testid="requirement-note-saved">Saved as a note (see Notes).</p>}
      {approve.saveError && <p className="rq-error" role="alert" data-testid="requirement-note-error">{approve.saveError}</p>}
    </section>
  );
}
