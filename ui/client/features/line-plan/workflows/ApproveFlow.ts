// The person's decisions on a plan step, each as the plan calls it takes. Approve: approve the step, then run it (the
// approval is the person's; the run is exactly that one step). A choice on a step that needs the person (Try again,
// Leave as it is) is a new step the person adds and approves in the same click; Try again stops on the server when it
// would not pass more checks than before.
import type { LinePlanApi, PlanAnswer, StepChoice } from '../types.ts';

/** Approve one step and run it. */
export async function approveAndRun(api: LinePlanApi, stepId: string): Promise<PlanAnswer> {
  const approved = await api.approve(stepId);
  if (!approved.ok) return approved;
  return api.run(stepId);
}

/** The step a choice adds: a retry of the same tool, or a "leave as is" for that step. */
export function choiceStep(tool: string, stepId: string, choice: StepChoice['id']) {
  return choice === 'retry' ? { tool, args: { retry: { of: stepId } } } : { tool: 'line.leaveAsIs', args: { stepId } };
}

/** Add the choice's step, approve it and run it. */
export async function chooseAndRun(api: LinePlanApi, tool: string, stepId: string, choice: StepChoice['id']): Promise<PlanAnswer> {
  const added = await api.addStep(choiceStep(tool, stepId, choice));
  if (!added.ok || !added.view.stepId) return added.ok ? { ok: false, sentence: 'The plan did not say which step it added.' } : added;
  return approveAndRun(api, added.view.stepId);
}
