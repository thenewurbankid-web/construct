// Pure (DOMAIN-001): what the person may do now, from the view the server sends.
import type { ImportAgentStep, ImportAgentView, MainAction } from '../types.ts';

/** A step can still be changed: the plan is in review or running, and this step has not started. */
export function canChange(view: ImportAgentView | null, step: ImportAgentStep): boolean {
  return Boolean(view && (view.state === 'review' || view.state === 'execute') && step.run === 'todo');
}

/** The places a step may move to: among the steps that have not run, after the first step (which marks the folder). */
export function moveTargets(view: ImportAgentView, step: ImportAgentStep): { up: number | null; down: number | null } {
  const i = view.steps.findIndex((s) => s.id === step.id);
  const first = view.steps.findIndex((s) => s.run === 'todo' && s.tool !== 'line.import.mark');
  if (!canChange(view, step) || step.tool === 'line.import.mark' || first < 0) return { up: null, down: null };
  return { up: i - 1 >= first ? i - 1 : null, down: i + 1 < view.steps.length ? i + 1 : null };
}

/** The one main action for where the process is. */
export function mainAction(view: ImportAgentView | null): MainAction {
  if (!view || view.state === 'idle') return { id: 'start', label: 'Start the import' };
  if (view.paused) return { id: 'resume', label: 'Resume' };
  if (view.waiting?.for === 'review' && view.state === 'review') return { id: 'approve-all', label: 'Approve the plan' };
  if (view.waiting?.for === 'review') return { id: 'approve-all', label: 'Approve the changed steps' };
  if (view.waiting?.for === 'approval') return { id: 'approve-run', label: 'Approve and run' };
  return null;
}
