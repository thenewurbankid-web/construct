import type { LineWorkflow, PlanStepRequest, WhenDoDraft } from '../types';

/** The plan step that starts a feature workflow from a library one. */
const baseOn = (feature: string, libraryId: string, name: string): PlanStepRequest => ({ tool: 'line.baseWorkflowOn', args: { libraryId, feature, name } });

/** The plan step that chooses (or clears, with '') the page for one role. */
const role = (w: LineWorkflow, roleId: string, page: string): PlanStepRequest => ({ tool: 'line.setWorkflowRole', args: { file: w.file, role: roleId, page } });

/** The plan step for a When -> Do the person typed; empty optional fields are left out. */
function whenDo(w: LineWorkflow, d: WhenDoDraft): PlanStepRequest {
  const args: Record<string, unknown> = { file: w.file, from: d.from, event: d.event.trim().toUpperCase().replace(/\s+/g, '_'), to: d.to };
  if (d.service.trim()) args.service = d.service.trim();
  if (d.part.trim() || d.partState.trim()) {
    args.part = d.part.trim();
    args.partState = d.partState.trim();
  }
  return { tool: 'line.addWorkflowTransition', args };
}

/** The plan step that removes one of the feature's own transitions. */
function remove(w: LineWorkflow, transitionId: string): PlanStepRequest {
  const t = w.transitions.find((x) => x.id === transitionId);
  return { tool: 'line.removeWorkflowTransition', args: { file: w.file, from: t?.from ?? '', event: t?.event ?? '' } };
}

/** Promoting a feature workflow to the library is the same step as for every other kind. */
const promote = (w: LineWorkflow): PlanStepRequest => ({ tool: 'line.promote', args: { featureItemId: w.id } });

/** The plan step of each change the Workflows tab makes (the arguments of contract.mjs's workflow plan tools). */
export const workflowSteps = Object.freeze({ baseOn, role, whenDo, remove, promote });
