// cu2 -- the one AI layer's contract: per-step profiles (ai-profiles.json) and decide() / decideUntilAccepted()
// (line-decide.mjs), over mocks of @mx/reason and jev (no source repo, no model). Every result passes the contract's
// assert* checks (packages/engine/line/contract.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStepProfile, assertDecideResult, assertDecideLoopResult, assertAiProfiles, DEFAULT_STEP_MODEL } from '../packages/engine/line/contract.mjs';
import { listStepProfiles, stepProfile, stepModel, reasonPairOf, readAiProfiles } from '../packages/core/ai-profiles.mjs';
import { createDecider } from '../packages/core/line-decide.mjs';
import { createMockDecide } from '../packages/core/line-decide-mock.mjs';
import { createMockReason, createMockPicker } from '../packages/line-links/mocks.mjs';

const OPTS = [{ id: 'list', label: 'A list of orders' }, { id: 'detail', label: 'One order' }, { id: 'form', label: 'A form' }];
const withReason = (picker) => createDecider({ loadReason: async () => ({ module: createMockReason(), note: null }), jev: picker });

test('profiles: one set covers Cockpit, Trace and Construct steps, each passing the contract, 1.5B by default', () => {
  const all = listStepProfiles({ traceConfig: null });
  all.forEach((p) => assertStepProfile(p));
  const steps = all.map((p) => p.step);
  for (const s of ['construct.chooser', 'construct.fix', 'trace.choose', 'trace.pick-fields', 'trace.draft-body', 'cockpit.importFill', 'cockpit.createFill', 'cockpit.planAnalysis']) assert.ok(steps.includes(s), s);
  assert.equal(DEFAULT_STEP_MODEL, 'qwen2.5-coder:1.5b');
  for (const p of all.filter((x) => x.provider === 'ollama')) assert.equal(p.model, DEFAULT_STEP_MODEL, p.step);
  // im2 (owner, 12 Oct): the repair loop on the 1.5B, no reason field, up to 4 attempts (variant A, review.md).
  assert.deepEqual([stepProfile('construct.repair').reason, stepProfile('construct.repair').maxAttempts], [false, 4]);
  assert.equal(stepModel('cockpit.planAnalysis', { traceConfig: null }), null, 'plan analysis stays on a hosted model');
  assert.equal(stepProfile('construct.chooser').maxTokens, 800, 'plan steps get 800 tokens');
  assert.equal(stepProfile('construct.chooser').fallback, 'static');
});

test("profiles: Trace's ai.config.json overrides a task's model and the profile says where it came from", () => {
  const p = stepProfile('trace.choose', { traceConfig: { default: { provider: 'ollama', model: 'qwen2.5-coder:1.5b' }, tasks: { choose: { model: 'qwen3:4b' } } } });
  assert.equal(p.model, 'qwen3:4b');
  assert.equal(p.modelFrom, 'trace/ai.config.json');
  assert.equal(stepProfile('trace.explain', { traceConfig: null }).modelFrom, "Line's default");
});

test('profiles: the contract refuses a draft step with jev on, a hosted step with jev on, and a missing maxTokens', () => {
  const base = stepProfile('trace.explain', { traceConfig: null });
  assert.throws(() => assertStepProfile({ ...base, ladder: { ...base.ladder, options: { on: true, target: 0.6 } } }), /draft step/);
  const hosted = stepProfile('cockpit.planAnalysis', { traceConfig: null });
  assert.throws(() => assertStepProfile({ ...hosted, kind: 'decide', ladder: { ...hosted.ladder, options: { on: true, target: 0.6 } } }), /hosted/);
  assert.throws(() => assertStepProfile({ ...base, maxTokens: undefined }), /maxTokens/);
  assert.throws(() => stepProfile('nope.step'), /no profile/);
});

test('profiles: an @mx/reason pair carries the step, the model for every role and the ladder', () => {
  const pair = reasonPairOf(stepProfile('construct.chooser'));
  assert.equal(pair.pairId, 'construct.chooser.pick');
  assert.deepEqual(pair.models, { suggest: DEFAULT_STEP_MODEL, pick: DEFAULT_STEP_MODEL, review: DEFAULT_STEP_MODEL });
  assert.equal(pair.ladder.options.on, true);
  assert.equal(pair.plan.questions[0].kind, 'pick');
});

test('profiles: the Settings view shape lists every step and says in a sentence whether jev is linked', () => {
  const off = readAiProfiles({ traceConfig: null, status: () => ({ ok: false, packages: [{ name: '@mx/reason', ok: false, message: '@mx/reason is not linked because the source folder is missing.' }] }) });
  assertAiProfiles(off);
  assert.equal(off.reason.linked, false);
  assert.match(off.reason.sentence, /static path\.$/);
  assert.ok(!('guidance' in off.profiles[0]), 'Qwen-side guidance stays on the server');
  const on = readAiProfiles({ traceConfig: null, status: () => ({ ok: true, packages: [{ name: '@mx/reason', ok: true, message: 'ok' }] }) });
  assert.equal(on.reason.linked, true);
});

test('decide: one option left by the checks is decided by static, no model asked', async () => {
  const picker = createMockPicker(1);
  const r = await withReason(picker).decide('construct.chooser', OPTS, { check: (id) => (id === 'detail' ? null : 'not this one') });
  assertDecideResult(r, ['detail']);
  assert.equal(r.choice, 'detail');
  assert.equal(r.via, 'static');
  assert.equal(r.by, 'single');
  assert.equal(picker.calls.length, 0);
});

test('decide: with jev up, jev picks among the checked options by their plain labels and is attributed', async () => {
  const picker = createMockPicker(2);
  const r = await withReason(picker).decide('construct.chooser', OPTS, { question: 'What does the page show' });
  assertDecideResult(r, OPTS.map((o) => o.id));
  assert.deepEqual(picker.calls, [['A list of orders', 'One order', 'A form']]);
  assert.equal(r.choice, 'form');
  assert.equal(r.via, 'jev');
  assert.equal(r.attribution.provider, '@mx/reason');
  assert.equal(r.attribution.decider, 'jev');
  assert.equal(r.attribution.model, DEFAULT_STEP_MODEL);
});

test("decide: Qwen suggests, jev agrees -> Qwen's reason is kept; jev disagrees -> low confidence, the person is asked", async () => {
  const agree = await withReason(createMockPicker(1)).decide('trace.choose', OPTS, { suggestion: { option: 'detail', reason: 'Fact 2 says the page shows one order' } });
  assertDecideResult(agree);
  assert.deepEqual(agree.reasons, ['Fact 2 says the page shows one order.', 'jev agreed with it.']);
  assert.equal(agree.lowConfidence, false);
  const disagree = await withReason(createMockPicker(0)).decide('trace.choose', OPTS, { suggestion: { option: 'detail', reason: 'Fact 2 says so' } });
  assertDecideResult(disagree);
  assert.equal(disagree.choice, 'list');
  assert.equal(disagree.lowConfidence, true);
  assert.match(disagree.reasons[0], /^jev picked "A list of orders", but Qwen suggested "One order"/);
});

test('decide fallback: reason not linked -> static order, and the attribution says why in one sentence', async () => {
  const d = createDecider({ loadReason: async () => ({ module: null, note: '@mx/reason is not linked because the source folder is missing.' }) });
  const r = await d.decide('construct.chooser', OPTS);
  assertDecideResult(r);
  assert.equal(r.choice, 'list');
  assert.equal(r.by, 'order');
  assert.equal(r.attribution.fellBackFrom, 'reason');
  assert.match(r.attribution.note, /source folder is missing; Line decided without jev\.$/);
});

test("decide fallback: jev's local model not running -> Qwen's checked suggestion stands (via model)", async () => {
  const r = await withReason(createMockPicker(0, { available: false })).decide('trace.choose', OPTS, { suggestion: { option: 'form', reason: 'Fact 1 names a form' } });
  assertDecideResult(r);
  assert.equal(r.choice, 'form');
  assert.equal(r.via, 'model');
  assert.equal(r.attribution.decider, 'qwen');
  assert.equal(r.attribution.fellBackFrom, 'jev');
  assert.match(r.attribution.note, /not running/);
});

test('decide fallback: a throwing reason module falls back to static and says so', async () => {
  const d = createDecider({ loadReason: async () => ({ module: createMockReason({ fail: true }), note: null }), jev: createMockPicker(1) });
  const r = await d.decide('construct.chooser', OPTS);
  assertDecideResult(r);
  assert.equal(r.via, 'static');
  assert.match(r.attribution.note, /mock reason failure/);
});

test('decide: a suggestion that fails the checks is ignored; nothing passing asks the person', async () => {
  const d = createDecider({ loadReason: async () => ({ module: null, note: 'off' }) });
  const r = await d.decide('trace.choose', OPTS, { suggestion: { option: 'nope', reason: 'x' } });
  assert.equal(r.via, 'static');
  const none = await d.decide('trace.choose', OPTS, { check: () => 'no' });
  assertDecideResult(none);
  assert.equal(none.choice, null);
  assert.equal(none.lowConfidence, true);
});

test('decide: a step whose ladder keeps jev off never asks it (trace.pick-fields)', async () => {
  const picker = createMockPicker(1);
  const r = await withReason(picker).decide('trace.pick-fields', OPTS);
  assert.equal(r.by, 'order');
  assert.equal(picker.calls.length, 0);
});

const REFUSAL = {
  sentence: 'Nothing was saved: feature "billing" imports from feature "orders".',
  fixes: [
    { id: 'LINE-DIR/import-library', sentence: 'Import it from the library instead.', rank: 2 },
    { id: 'LINE-DIR/promote', sentence: 'Promote OrderButton to the library and re-point its users.', rank: 1 },
  ],
};

test("feedback: a refusal's typed fixes become the options, the recommended fix first; jev reads the refusal", async () => {
  const picker = createMockPicker(0);
  const r = await withReason(picker).decide('construct.fix', [], { refusal: REFUSAL });
  assertDecideResult(r, ['LINE-DIR/promote', 'LINE-DIR/import-library']);
  assert.equal(r.feedback, true);
  assert.equal(r.choice, 'LINE-DIR/promote');
  assert.deepEqual(picker.calls[0], ['Promote OrderButton to the library and re-point its users.', 'Import it from the library instead.']);
  const off = await createMockDecide().decide('construct.fix', [], { refusal: REFUSAL });
  assert.equal(off.choice, 'LINE-DIR/promote');
  assert.match(off.reasons[0], /recommends/);
});

test('loop: a refused change is retried with its typed fixes and lands', async () => {
  const applied = [];
  const loop = await createMockDecide({ pick: 0 }).decideUntilAccepted('construct.chooser', OPTS, {}, {
    apply: (choice) => { applied.push(choice); return applied.length === 1 ? { ok: false, refusal: REFUSAL } : { ok: true }; },
  });
  assertDecideLoopResult(loop);
  assert.equal(loop.outcome, 'accepted');
  assert.deepEqual(applied, ['list', 'LINE-DIR/promote']);
  assert.equal(loop.rounds[1].decision.feedback, true);
});

test('loop: a round that does not improve stops and asks the person ONE question with the fixes', async () => {
  let n = 0;
  const loop = await createMockDecide().decideUntilAccepted('construct.chooser', OPTS, {}, { apply: () => ({ ok: false, refusal: REFUSAL, score: -(++n > 1 ? 5 : 2) }) });
  assertDecideLoopResult(loop);
  assert.equal(loop.outcome, 'ask');
  assert.equal(loop.rounds.length, 2);
  assert.match(loop.question.sentence, /^Nothing was saved: .*Which fix should Line try\?$/);
  assert.deepEqual(loop.question.options.map((o) => o.id), ['LINE-DIR/promote', 'LINE-DIR/import-library']);
});

test('loop: nothing passing the checks asks at once, before anything is applied', async () => {
  let applied = 0;
  const loop = await createMockDecide().decideUntilAccepted('construct.chooser', OPTS, { question: 'Which page', check: () => 'no' }, { apply: () => { applied += 1; return { ok: true }; } });
  assertDecideLoopResult(loop);
  assert.equal(applied, 0);
  assert.equal(loop.question.sentence, 'Which page?');
});
