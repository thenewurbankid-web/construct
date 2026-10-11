import type { Diagram, LineWorkflow, WhenDoDraft } from '../types';
import { RoleList } from './RoleList';
import { StateDiagram } from './StateDiagram';
import { WhenDoCards } from './WhenDoCards';
import { WhenDoForm } from './WhenDoForm';

type WorkflowDetailProps = {
  workflow: LineWorkflow | null;
  diagram: Diagram | null;
  pages: string[];
  newDraft: WhenDoDraft;
  checkDraft: (draft: WhenDoDraft) => string | null;
  busy: boolean;
  onRole: (role: string, page: string) => void;
  onAdd: (draft: WhenDoDraft) => void;
  onRemove: (transitionId: string) => void;
  onPromote: () => void;
};

/** One feature workflow: what it is (summary), the pages it needs, its state diagram, its When -> Do cards, a form to
 * add one, and moving it to the library once a second feature needs it. Every change is a plan step. Nothing when no
 * workflow is chosen. */
export function WorkflowDetail({ workflow, diagram, pages, newDraft, checkDraft, busy, onRole, onAdd, onRemove, onPromote }: WorkflowDetailProps) {
  if (!workflow || !diagram) return null;
  return (
    <section className="lw-detail" aria-labelledby="lw-detail-title" data-testid="lw-detail" data-workflow={workflow.name}>
      <h3 id="lw-detail-title" className="lw-title">
        {workflow.name}
      </h3>
      <p className="lw-summary" data-testid="lw-summary">
        {workflow.summary.join(' ')}
      </p>
      <h4>Pages</h4>
      <RoleList workflow={workflow} pages={pages} busy={busy} onChoose={onRole} />
      <h4>State diagram</h4>
      <StateDiagram name={workflow.name} diagram={diagram} />
      <h4>When → Do</h4>
      <WhenDoCards workflow={workflow} busy={busy} onRemove={onRemove} />
      <WhenDoForm key={workflow.id} workflow={workflow} initial={newDraft} check={checkDraft} busy={busy} onAdd={onAdd} />
      <div className="lw-promote">
        <button type="button" className="lw-btn" disabled={busy} onClick={onPromote}>
          Move to the library
        </button>
        <span className="lw-muted">Do this when a second feature needs it.</span>
      </div>
      <details className="lw-details">
        <summary>Details</summary>
        <dl>
          <dt>File</dt>
          <dd data-testid="lw-file">{workflow.file}</dd>
          <dt>Based on</dt>
          <dd>{workflow.base?.value ?? 'nothing'}</dd>
          <dt>Machine id</dt>
          <dd>{workflow.machineId}</dd>
        </dl>
      </details>
    </section>
  );
}
