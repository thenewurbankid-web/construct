// Pure (DOMAIN-001): everything the Import agent screen shows, computed from the view the server sends, so the
// components only render.
import { EDITABLE, LABELS } from './AgentLabels.ts';
import { editValue, orderedOptions } from './AgentEdit.ts';
import { canChange, mainAction, moveTargets } from './AgentRules.ts';
import type { AgentScreen, ImportAgentStep, ImportAgentView, LineRefusal, StepRowModel } from '../types.ts';

/** The technical lines of a step, for its Details. */
function stepDetails(step: ImportAgentStep): string[] {
  return [`tool ${step.tool}`, `args ${JSON.stringify(step.args)}`, ...(step.planStepIds.length ? [`plan steps ${step.planStepIds.join(', ')}`] : []), ...(step.rounds ? [`fix rounds ${step.rounds}`] : [])];
}

function rowOf(view: ImportAgentView, step: ImportAgentStep, i: number, editing: string | null): StepRowModel {
  const open = canChange(view, step);
  const { up, down } = moveTargets(view, step);
  const fields = (EDITABLE[step.tool] ?? []).map((f) => ({ ...f, value: editValue(step, f.key) }));
  return {
    id: step.id, n: i + 1, sentence: step.sentence, review: step.review, run: step.run,
    reviewLabel: LABELS.review[step.review], runLabel: LABELS.run[step.run], outcome: step.outcome,
    canApprove: open && step.review === 'proposed',
    canEdit: open && fields.length > 0 && step.review !== 'skipped',
    skipLabel: open && step.tool !== 'line.import.mark' ? (step.review === 'skipped' ? 'Bring back' : 'Skip') : null,
    up: open ? up : null, down: open ? down : null,
    editing: editing === step.id, fields, details: stepDetails(step),
  };
}

/** The screen model. */
export function agentScreen(view: ImportAgentView | null, editing: string | null): AgentScreen {
  const started = Boolean(view && view.state !== 'idle');
  const q = view?.waiting?.for === 'answer' ? view.waiting.question ?? null : null;
  return {
    started,
    stages: started && view ? view.stages : [],
    sentence: started && view ? view.sentence : null,
    message: view?.message ?? null,
    question: q ? { id: q.id, sentence: q.sentence, options: orderedOptions(q) } : null,
    main: mainAction(view),
    canPause: Boolean(started && view && view.state !== 'done' && !view.paused),
    rows: view ? view.steps.map((s, i) => rowOf(view, s, i, editing)) : [],
    checks: (view?.verify?.checks ?? []).map((c) => ({ id: c.id, state: c.state, label: `${LABELS.checkName[c.id]}: ${LABELS.check[c.state]}`, sentence: c.sentence, details: c.detail ? c.detail.split('\n') : [] })),
    decider: started && view ? view.decider : null,
    decisions: (view?.decisions ?? []).map((d) => `${d.question} ${LABELS.decider[d.by] ?? d.by}: ${d.picked}. ${d.reason}`),
    changes: started && view ? view.changes.map((c) => `${LABELS.who[c.by] ?? c.by}: ${c.sentence}`) : [],
  };
}

/** A refusal `{ok: false, sentence}` rather than the view asked for. */
export function isRefusal(body: unknown): body is LineRefusal {
  return Boolean(body && typeof body === 'object' && (body as { ok?: unknown }).ok === false && typeof (body as { sentence?: unknown }).sentence === 'string');
}
