import { Button } from '@/components/ui';
import type { ApproveBarProps } from '../types';

/** The compiled plan (once every chooser is answered), and Approve: it starts a process through the Plan screen's
 * own run route, unchanged. Nothing here calls a model; debug.fix's ai exit (if taken) is not one of the plan's
 * steps, it is its own recorded decision. */
export function ApproveBar({ plan, compileError, approve, onApprove, onOpenProcesses }: ApproveBarProps) {
  if (!plan && !compileError) return null;
  return (
    <section className="dbg-card" aria-labelledby="dbg-approve-h" data-testid="debug-approve">
      <h2 className="dbg-h2" id="dbg-approve-h">Plan</h2>
      {compileError && <p className="dbg-error" role="alert" data-testid="debug-compile-error">{compileError}</p>}
      {plan && (
        <ol className="dbg-plan-steps" data-testid="debug-plan-step-list">
          {plan.steps.map((s) => (
            <li key={s.id} data-testid="debug-plan-step">{s.title} <code>{s.flow}</code></li>
          ))}
        </ol>
      )}
      {plan && (
        <div className="dbg-row">
          <Button type="button" disabled={!approve.canApprove} onClick={onApprove} data-testid="debug-approve-plan">
            {approve.running ? 'Starting...' : 'Approve plan'}
          </Button>
        </div>
      )}
      {approve.started && (
        <p className="dbg-ok" role="status" data-testid="debug-started">
          Plan approved: process {approve.processId} started. Nothing reaches your project until you approve each file.{' '}
          <button type="button" className="dbg-link" onClick={onOpenProcesses}>Open the process</button>
        </p>
      )}
      {approve.error && <p className="dbg-error" role="alert" data-testid="debug-approve-error">{approve.error}</p>}
    </section>
  );
}
