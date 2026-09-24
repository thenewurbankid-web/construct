import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from './PlanDocument.ts';
import { deriveTouches } from './StepTouches.ts';
import { moveStep, newStep, removeStep } from './StepList.ts';
import { nextStepId } from './StepIds.ts';
import { retagStep, setStepArg } from './StepEdit.ts';
import { errorLead, splitErrors } from './StepErrors.ts';
import { commandLine, quoteWord } from './CommandText.ts';
import { headline, seedNote, whyText } from './ImpactText.ts';
import { suggestedSteps } from './SuggestedSteps.ts';
import { EXECUTORS } from './ExecutorLabels.ts';
import { initialScreen, screenReducer } from '../workflows/PlanMachine.ts';

const createUnit = { id: 'create.unit', summary: 'Create one unit.', writes: true, executors: ['deterministic', 'local-model', 'user'], offered: true, args: [{ name: 'layer', type: 'string', required: true, path: false }, { name: 'name', type: 'string', required: true, path: false }, { name: 'feature', type: 'string', required: true, path: false }, { name: 'layers', type: 'string[]', required: false, path: false }, { name: 'llm', type: 'string', required: false, path: false }] };
const summarize = { id: 'summarize.list', summary: 'List units.', writes: false, executors: ['deterministic'], offered: true, args: [{ name: 'kind', type: 'string', required: false, path: false }] };
const step = (id, extra = {}) => ({ id, title: id, flow: 'summarize.list', args: {}, executor: 'deterministic', ...extra });

test('ids never collide, even after a removal', () => {
  assert.deepEqual(nextStepId([step('s1'), step('s2')], 1), { id: 's3', nextId: 4 });
  assert.equal(nextStepId([], 1).id, 's1');
  const a = newStep(summarize, [], 1);
  const b = newStep(summarize, [a.step], a.nextId);
  assert.notEqual(a.step.id, b.step.id);
});

test('a new step starts with the first executor the flow allows and no required argument invented', () => {
  const { step: s } = newStep(createUnit, [], 1);
  assert.equal(s.executor, 'deterministic');
  assert.deepEqual(s.args, {});
  assert.deepEqual(s.touches, { features: [], files: [] }, 'a writing flow declares what it touches');
  assert.equal(newStep(summarize, [], 1).step.touches, undefined, 'a read-only flow declares nothing');
});

test('removing a step also drops the dependencies on it', () => {
  const out = removeStep([step('a'), step('b', { dependsOn: ['a'] }), step('c', { dependsOn: ['a', 'b'] })], 'a');
  assert.deepEqual(out.map((s) => s.id), ['b', 'c']);
  assert.equal(out[0].dependsOn, undefined);
  assert.deepEqual(out[1].dependsOn, ['b']);
});

test('reordering moves one place and drops a dependency that would now point forward', () => {
  const steps = [step('a'), step('b', { dependsOn: ['a'] })];
  const moved = moveStep(steps, 'a', 1);
  assert.deepEqual(moved.map((s) => s.id), ['b', 'a']);
  assert.equal(moved[0].dependsOn, undefined, 'b no longer depends on a step that comes later');
  assert.equal(moveStep(steps, 'a', -1), steps, 'moving the first step up is a no-op');
  assert.equal(moveStep(steps, 'b', 1), steps, 'moving the last step down is a no-op');
  assert.deepEqual(moveStep([step('a'), step('b'), step('c')], 'c', -1).map((s) => s.id), ['a', 'c', 'b']);
});

test('re-tagging to the local model names it; re-tagging away leaves llm so the validator can say so', () => {
  const tagged = retagStep([step('a', { flow: 'create.unit' })], 'a', 'local-model', createUnit);
  assert.equal(tagged[0].executor, 'local-model');
  assert.equal(tagged[0].args.llm, 'ollama');
  const back = retagStep(tagged, 'a', 'deterministic', createUnit);
  assert.equal(back[0].args.llm, 'ollama');
  const noLlm = retagStep([step('a')], 'a', 'local-model', summarize);
  assert.equal(noLlm[0].args.llm, undefined, 'no llm argument is invented on a flow that has none');
});

test('arguments: empty clears, lists split on commas, the feature drives touches', () => {
  let steps = [step('a', { flow: 'create.unit', touches: { features: [], files: [] } })];
  steps = setStepArg(steps, 'a', 'feature', 'billing', createUnit);
  assert.equal(steps[0].args.feature, 'billing');
  assert.deepEqual(steps[0].touches.features, ['billing']);
  steps = setStepArg(steps, 'a', 'layers', 'domain, service', createUnit);
  assert.deepEqual(steps[0].args.layers, ['domain', 'service']);
  steps = setStepArg(steps, 'a', 'feature', '   ', createUnit);
  assert.equal('feature' in steps[0].args, false);
  assert.deepEqual(deriveTouches(summarize, {}), undefined);
});

test('the plan document is a v1 plan whose ticket is text', () => {
  const p = buildPlan({ title: '', body: 'Fix the totals\nmore' }, [step('a')]);
  assert.equal(p.version, 1);
  assert.deepEqual(p.ticket, { source: 'text', title: 'Fix the totals', body: 'Fix the totals\nmore' });
  assert.equal(buildPlan({ title: 'T', body: '' }, []).ticket.body, undefined);
  assert.equal(buildPlan({ title: '', body: '' }, []).ticket.title, 'Untitled note');
});

test('errors land on the step they are about; the rest are about the plan', () => {
  const steps = [step('a'), step('b')];
  const errors = [
    { code: 'STEP_DEPENDENCY_FORWARD', path: 'steps[1].dependsOn', message: 'm', plain: 'p' },
    { code: 'STEP_ARG_MISSING', path: 'steps[0].args.name', message: 'm', plain: 'p' },
    { code: 'STEPS_EMPTY', path: 'steps', message: 'm', plain: 'p' },
    { code: 'X', path: 'steps[9].id', message: 'm', plain: 'p' },
  ];
  const { byStep, plan } = splitErrors(steps, errors);
  assert.deepEqual(Object.keys(byStep), ['b', 'a']);
  assert.equal(plan.length, 2);
  assert.equal(errorLead('STEP_DEPENDENCY_FORWARD'), 'Out of order');
  assert.equal(errorLead('NOPE'), 'Needs attention');
});

test('the command line is quoted for the eye', () => {
  assert.equal(commandLine(['construct', 'create', 'feature', 'Wishlist']), 'construct create feature Wishlist');
  assert.equal(quoteWord('a b'), "'a b'");
  assert.equal(quoteWord("it's"), "'it'\\''s'");
  assert.equal(quoteWord(''), "''");
});

test('the three tags are the design ones', () => {
  assert.deepEqual(EXECUTORS.map((e) => e.label), ['Deterministic', 'Local model', 'You']);
});

const report = (over = {}) => ({
  summary: 's', seeds: [], warnings: [], stats: { derived: 1, inferred: 0, filesImplicated: 2 },
  features: [{ name: 'billing', kind: 'feature', provenance: 'derived', files: 2, seeded: true, layers: [], why: 'Contains a seed unit.' }, { name: 'shared', kind: 'directory', provenance: 'derived', files: 1, seeded: false, layers: [], why: 'x' }],
  files: [{ path: 'features/billing/domain/a.ts', layer: 'domain', feature: 'billing', scope: 'billing', distance: 0, provenance: 'derived', reasons: [{ code: 'SEED', message: 'A seed.' }] }, { path: 'features/billing/workflows/W.ts', layer: 'workflow', feature: 'billing', scope: 'billing', distance: 1, provenance: 'derived', reasons: [] }],
  ...over,
});

test('impact view: headline, reasons and the seed note', () => {
  assert.equal(headline(report()), '1 feature · 2 files');
  assert.equal(whyText(report().files[0]), 'A seed.');
  assert.match(whyText(report().files[1]), /1 hop/);
  assert.match(seedNote({ explicit: 0, inferred: 2 }), /guessed, so the result is marked Guess/);
  assert.match(seedNote({ explicit: 1, inferred: 1 }), /picked and 1 you confirmed/);
  assert.match(seedNote({ explicit: 2, inferred: 0 }), /2 unit\(s\) you picked/);
});

test('suggested steps come from the report and are not repeated once added', () => {
  const found = suggestedSteps(report(), []);
  assert.deepEqual(found.map((s) => s.flow), ['summarize.unit', 'research.workflow']);
  assert.deepEqual(found[0].args, { ref: 'feature:billing', detail: 'full' });
  assert.ok(found.every((s) => s.executor === 'deterministic'), 'every suggestion is read-only and deterministic');
  const again = suggestedSteps(report(), [{ id: 's1', title: 't', flow: 'summarize.unit', args: { ref: 'feature:billing', detail: 'full' }, executor: 'deterministic' }]);
  assert.deepEqual(again.map((s) => s.flow), ['research.workflow']);
  assert.deepEqual(suggestedSteps(null, []), []);
});

test('the screen machine: ticket edits make proposals stale; step edits reset the run; a run is remembered', () => {
  let s = screenReducer(initialScreen, { type: 'PROPOSALS_LOADED', proposals: [{ ref: 'feature:billing' }] });
  s = screenReducer(s, { type: 'TOGGLE_ACCEPT', ref: 'feature:billing' });
  assert.deepEqual(s.accepted, ['feature:billing']);
  s = screenReducer(s, { type: 'TICKET', ticket: { title: 'x' } });
  assert.equal(s.proposals.length, 1, 'a title edit keeps the proposals');
  s = screenReducer(s, { type: 'TICKET', ticket: { body: 'new text' } });
  assert.equal(s.proposals, null, 'new ticket text makes the proposals stale');
  assert.deepEqual(s.accepted, []);
  s = screenReducer(s, { type: 'RUN_STARTED', processId: 'p1', models: ['s2'] });
  assert.equal(s.startedId, 'p1');
  s = screenReducer(s, { type: 'STEPS', steps: [], nextId: 1 });
  assert.equal(s.startedId, null, 'editing the plan clears the started notice');
  s = screenReducer(s, { type: 'RUN_FAILED', error: 'no', errors: [] });
  assert.equal(s.runStatus, 'failed');
  s = screenReducer(s, { type: 'TOGGLE_PICK', ref: 'feature:a' });
  s = screenReducer(s, { type: 'TOGGLE_PICK', ref: 'feature:a' });
  assert.deepEqual(s.picked, []);
});

// --- #609 durable notes ---------------------------------------------------------------------------------------

import { counterAfter, isUnsaved, keysOfNote, planPart, stepsOf, textKey, stepsKey } from './PlanNote.ts';
import { buildNoteStatus } from './NoteStatusView.ts';

const wireNote = (over = {}) => ({ id: 'n1', title: 'Fix totals', body: 'the text', plan: null, status: 'draft', rev: 1, createdAt: 't', updatedAt: 't', processId: null, planStale: false, ...over });

test('#609 opening a note puts its text and plan on screen and keeps ids from colliding', () => {
  const plan = { version: 1, ticket: { source: 'text', title: 'Fix totals' }, steps: [step('s1'), step('s4')] };
  const s = screenReducer(initialScreen, { type: 'NOTE_OPENED', note: wireNote({ plan, status: 'plan-ready', rev: 3 }) });
  assert.deepEqual(s.ticket, { title: 'Fix totals', body: 'the text' });
  assert.deepEqual(s.steps.map((x) => x.id), ['s1', 's4']);
  assert.equal(s.nextId, 5, 'the next id is after the highest one the plan already uses');
  assert.deepEqual(s.note, { id: 'n1', rev: 3, status: 'plan-ready', planStale: false, processId: null });
  assert.equal(s.validation, null, 'the loaded plan is re-checked by the server, never trusted from disk');
  assert.equal(s.startedId, null);
  assert.equal(counterAfter([]), 1);
  assert.deepEqual(stepsOf({ steps: 'nope' }), [], 'a plan that is not a list of steps reads as no plan');
});

test('#609 a synced note moves the bookkeeping, not the typed text; save states are one union', () => {
  let s = screenReducer(initialScreen, { type: 'TICKET', ticket: { body: 'typed since' } });
  s = screenReducer(s, { type: 'NOTE_SYNCED', note: wireNote({ rev: 4, planStale: true }) });
  assert.equal(s.ticket.body, 'typed since');
  assert.equal(s.note.rev, 4);
  assert.equal(s.noteSave.status, 'saved');
  s = screenReducer(s, { type: 'NOTE_SAVE_FAILED', message: 'Disk full.' });
  assert.deepEqual(s.noteSave, { status: 'failed', message: 'Disk full.' });
  s = screenReducer(s, { type: 'NOTE_CONFLICT', theirs: wireNote({ rev: 9 }) });
  assert.equal(s.noteSave.status, 'conflict');
  assert.equal(screenReducer(s, { type: 'NOTE_RETRY' }).noteSave.status, 'idle');
});

test('#609 unsaved means the screen differs from what the server holds; the plan is sent only when steps changed or asked for', () => {
  const screen = { ticket: { title: 'T', body: 'B' }, steps: [step('s1')] };
  assert.equal(isUnsaved({ ticket: { title: '', body: '' }, steps: [] }, null), false, 'an empty screen with no note is nothing to save');
  assert.equal(isUnsaved({ ticket: { title: '', body: 'x' }, steps: [] }, null), true);
  const saved = { text: textKey(screen.ticket), steps: stepsKey(screen.steps) };
  assert.equal(isUnsaved(screen, saved), false);
  assert.equal(isUnsaved({ ...screen, ticket: { title: 'T', body: 'B2' } }, saved), true);
  assert.deepEqual(planPart({ ...screen, ticket: { title: 'T', body: 'B2' } }, saved, false), {}, 'a text-only edit sends no plan, so the server marks the plan out of date');
  assert.equal(planPart({ ...screen, steps: [step('s1'), step('s2')] }, saved, false).status, 'plan-ready');
  assert.equal(planPart(screen, saved, true).plan.steps.length, 1, 'Keep this plan sends it again');
  assert.deepEqual(planPart({ ...screen, steps: [] }, saved, false), { plan: null, status: 'draft' }, 'removing every step saves no plan');
  assert.deepEqual(keysOfNote(wireNote({ plan: { steps: [step('s1')] } })).steps, stepsKey([step('s1')]));
});

test('#609 the status line: saved, failed with Retry, conflict with a choice, ran, and Plan out of date only with a plan on screen', () => {
  const at = (over) => buildNoteStatus({ ...initialScreen, ...over });
  assert.equal(at({}).kind, 'none');
  const note = { id: 'n1', rev: 2, status: 'draft', planStale: false, processId: null };
  assert.equal(at({ note, noteSave: { status: 'saved' } }).label, 'Saved on this machine');
  const failed = at({ note, noteSave: { status: 'failed', message: 'The disk is full.' } });
  assert.equal(failed.canRetry, true);
  assert.match(failed.label, /still here/);
  assert.equal(at({ note, noteSave: { status: 'conflict', theirs: wireNote() } }).canResolve, true);
  assert.equal(at({ note: { ...note, status: 'ran' }, noteSave: { status: 'saved' } }).kind, 'ran');
  assert.equal(at({ note: { ...note, planStale: true }, steps: [step('s1')], noteSave: { status: 'saved' } }).planStale, true);
  assert.equal(at({ note: { ...note, planStale: true }, steps: [], noteSave: { status: 'saved' } }).planStale, false, 'no steps, nothing to be out of date');
});

import { buildStepView } from './StepView.ts';

test('#470 a step card names the files the server says it will write, next to the features it touches', () => {
  const s = step('s1', { flow: 'create.unit', touches: { features: ['billing'], files: [] } });
  const preview = { id: 's1', manual: false, argv: ['construct', 'create'], stdin: null, model: false, files: ['features/billing/domain/WishRules.tsx'] };
  assert.equal(buildStepView({ step: s, flow: createUnit, preview, errors: [] }).touches, 'billing · writes features/billing/domain/WishRules.tsx');
  assert.equal(buildStepView({ step: s, flow: createUnit, preview: { ...preview, files: [] }, errors: [] }).touches, 'billing');
  assert.equal(buildStepView({ step: s, flow: createUnit, preview: null, errors: [] }).touches, 'billing', 'no verdict yet: the features alone');
});
