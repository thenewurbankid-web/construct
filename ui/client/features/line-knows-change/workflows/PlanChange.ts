import type { LineRefusal, PlanView } from '@/lib/lineContract';
import type { ChangeProposal } from '@/lib/lineKnowsContract';
import type { ChangePlanApi } from '../services/ChangePlanApi';
import { progressAfterRun, type CardProgress } from '../domain/ChangeCards.ts';

const SILENT = 'The Cockpit server did not answer; nothing was changed.';
const isView = (b: PlanView | LineRefusal | undefined): b is PlanView => !!b && b.ok === true && Array.isArray((b as PlanView).steps);
const refused = (b: unknown, fallback: string): CardProgress => {
  const s = b && typeof b === 'object' && typeof (b as LineRefusal).sentence === 'string' ? (b as LineRefusal).sentence : fallback;
  return { state: 'refused', stepId: null, sentence: s };
};

/** "Plan it": the change becomes one plan step with its typed fix, waiting for the person's approval. */
export async function planChange(api: ChangePlanApi, p: ChangeProposal): Promise<CardProgress> {
  try {
    const r = await api.add({ tool: p.step.tool, args: p.step.args, why: p.sentence });
    if (!isView(r) || !r.stepId) return refused(r, 'The plan refused this change; nothing was changed.');
    return { state: 'waiting', stepId: r.stepId, sentence: 'Waiting for your approval. Nothing changes until you approve it.' };
  } catch {
    return refused(null, SILENT);
  }
}

/** "Approve": the person approves the step, and it runs through Construct's writer; the answer is one sentence. */
export async function approveChange(api: ChangePlanApi, stepId: string): Promise<CardProgress> {
  try {
    const a = await api.approve(stepId);
    if (!isView(a)) return refused(a, 'The step could not be approved; nothing was changed.');
    const r = await api.run(stepId);
    if (!isView(r)) return refused(r, 'The step could not run; nothing was changed.');
    return progressAfterRun(r.steps.find((s) => s.id === stepId), 'The step did not finish; nothing was changed.');
  } catch {
    return refused(null, SILENT);
  }
}
