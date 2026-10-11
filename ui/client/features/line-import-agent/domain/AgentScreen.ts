// Pure (DOMAIN-001): everything the Import agent screen shows, computed from the view the server sends, so the
// components only render.
import { EDITABLE, LABELS } from './AgentLabels.ts';
import { editValue, orderedOptions } from './AgentEdit.ts';
import { canChange, mainAction, moveTargets } from './AgentRules.ts';
import type { AgentScreen, ImportAgentStep, ImportAgentView, LineRefusal, LogicModel, StepRowModel } from '../types.ts';

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The import loop (Line Import v2): the logic map count, "N of M logic units kept", the coverage, each checked step's
 * diff, and the units that went missing, each a sentence; kinds, fingerprints and waivers sit under Details. */
export function logicModel(view: ImportAgentView | null): LogicModel | null {
  const l = view?.logic;
  if (!l || !l.units) return null;
  const c = l.coverage;
  return {
    sentence: l.sentence,
    kept: l.keptSentence,
    count: `${plural(l.units, 'logic unit')} in ${plural(l.files, 'file')}${l.route ? `, from route ${l.route}` : ''}.`,
    coverage: c ? `${c.covered} of ${plural(c.total, 'unit')} have a block and a test${c.waived ? `; the owner waived ${c.waived}` : ''}.` : null,
    tests: l.tests ? (l.tests.total ? `${l.tests.passed} of ${plural(l.tests.total, 'characterization test')} pass.` : 'No characterization tests yet.') : null,
    missing: l.missing.map((u) => ({ id: u.fingerprint, sentence: u.sentence, details: [`unit ${u.id}`, `fingerprint ${u.fingerprint}`, `goes back into ${u.block}`] })),
    steps: l.steps.map((s) => ({ n: s.n, status: s.status, sentence: s.sentence, line: `Step ${s.n}: ${s.kept} kept (${s.moved} moved), ${s.missing} missing, ${s.added} new${s.tests.total ? `; tests ${s.tests.passed} of ${s.tests.total} pass` : ''}.` })),
    details: [
      ...Object.entries(l.counts).map(([kind, n]) => `${kind} ${n}`),
      ...l.waivers.map((w) => `waived ${w.fingerprint} by ${w.by}: ${w.why}`),
    ],
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
    logic: started ? logicModel(view) : null,
    decider: started && view ? view.decider : null,
    decisions: (view?.decisions ?? []).map((d) => `${d.question} ${d.answer} (${LABELS.decider[d.by] ?? d.by}.)`),
    changes: started && view ? view.changes.map((c) => `${LABELS.who[c.by] ?? c.by} ${c.sentence}`) : [],
  };
}

/** A refusal `{ok: false, sentence}` rather than the view asked for. */
export function isRefusal(body: unknown): body is LineRefusal {
  return Boolean(body && typeof body === 'object' && (body as { ok?: unknown }).ok === false && typeof (body as { sentence?: unknown }).sentence === 'string');
}
