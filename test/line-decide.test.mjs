// cu2 -- the one AI layer's contract: per-step profiles (ai-profiles.json) and decide() (line-decide.mjs) on the one
// ladder (static -> middleware -> the picker -> Construct verify -> person), over mocks of @mx/reason and the picker (no
// source repo, no model). Every result passes the contract's assert* checks (packages/engine/line/contract.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStepProfile, assertDecideResult, assertAiProfiles, DEFAULT_STEP_MODEL } from '../packages/engine/line/contract.mjs';
import { listStepProfiles, stepProfile, stepModel, stepOn, stepWin, reasonPairOf, readAiProfiles } from '../packages/core/ai-profiles.mjs';
import { createDecider } from '../packages/core/line-decide.mjs';
import { createMockDecide, profilesWithOn } from '../packages/core/line-decide-mock.mjs';
import { createMockReason, createMockPicker } from '../packages/line-links/mocks.mjs';

const OPTS = [{ id: 'list', label: 'A list of orders' }, { id: 'detail', label: 'One order' }, { id: 'form', label: 'A form' }];
const CHOOSER_ON = profilesWithOn(['construct.chooser']);
const withReason = (picker, profiles = CHOOSER_ON) => createDecider({ loadReason: async () => ({ module: createMockReason(), note: null }), jev: picker, profiles });

test('profiles: one set covers Cockpit, Trace and Construct steps, each passing the contract, 1.5B by default', () => {
  const all = listStepProfiles({ traceConfig: null });
  all.forEach((p) => assertStepProfile(p));
  const steps = all.map((p) => p.step);
  for (const s of ['construct.chooser', 'construct.fix', 'construct.repair', 'trace.choose', 'trace.pick-fields', 'trace.draft-body', 'cockpit.importFill', 'cockpit.createFill']) assert.ok(steps.includes(s), s);
  assert.equal(DEFAULT_STEP_MODEL, 'qwen2.5-coder:1.5b');
  for (const p of all.filter((x) => x.provider === 'ollama')) assert.equal(p.model, DEFAULT_STEP_MODEL, p.step);
  // im2 (owner, 12 Oct): the repair loop on the 1.5B, no reason field, up to 4 attempts (variant A, review.md).
  assert.deepEqual([stepProfile('construct.repair').reason, stepProfile('construct.repair').maxAttempts], [false, 4]);
  assert.equal(stepModel('construct.chooser', { traceConfig: null }), DEFAULT_STEP_MODEL);
  assert.equal(stepProfile('construct.chooser').maxTokens, 800, 'plan steps get 800 tokens');
  assert.equal(stepProfile('construct.chooser').fallback, 'static');
});

test('profiles: the profile is the only switch; only steps with a measured win are on, and each lists its win or off', () => {
  const all = listStepProfiles({ traceConfig: null });
  assert.deepEqual(all.filter(stepOn).map((p) => p.step).sort(), ['construct.fix', 'construct.repair']);
  for (const s of ['construct.chooser', 'construct.label-miss', 'trace.choose']) assert.equal(stepWin(stepProfile(s)), 'off', s);
  assert.match(stepWin(stepProfile('construct.fix')), /9\/10.*6\/10/);
  assert.match(stepWin(stepProfile('construct.repair')), /7\/20/);
  assert.match(stepProfile('trace.choose').ladder.measured, /78\/132.*60%/, 'measured, but no win over static: off');
  assert.equal(stepWin(stepProfile('cockpit.importFill')), 'off (runs only when you ask)');
});

test("profiles: Trace's ai.config.json overrides a task's model and the profile says where it came from", () => {
  const p = stepProfile('trace.choose', { traceConfig: { default: { provider: 'ollama', model: 'qwen2.5-coder:1.5b' }, tasks: { choose: { model: 'qwen3:4b' } } } });
  assert.equal(p.model, 'qwen3:4b');
  assert.equal(p.modelFrom, 'trace/ai.config.json');
  assert.equal(stepProfile('trace.explain', { traceConfig: null }).modelFrom, "Line's default");
});

test('profiles: the contract refuses a step that is on without a measured win, a review rung, a hosted step with the picker on, and a missing maxTokens', () => {
  const base = stepProfile('trace.explain', { traceConfig: null });
  assert.throws(() => assertStepProfile({ ...base, ladder: { ...base.ladder, options: { on: true, target: 0.6 } } }), /measured win/);
  assert.throws(() => assertStepProfile({ ...base, ladder: { ...base.ladder, review: { on: false, target: 0.7 } } }), /no review rung/);
  assert.throws(() => assertStepProfile({ ...base, provider: 'hosted', model: null, kind: 'decide', ladder: { ...base.ladder, options: { on: true, target: 0.6 }, measured: 'x' } }), /hosted/);
  assert.throws(() => assertStepProfile({ ...base, maxTokens: undefined }), /maxTokens/);
  assert.throws(() => stepProfile('nope.step'), /no profile/);
});

test('profiles: an @mx/reason pair carries the step, the model for every role and the ladder, its picker only when on', () => {
  const off = reasonPairOf(stepProfile('construct.chooser'));
  assert.equal(off.pairId, 'construct.chooser.pick');
  assert.deepEqual(off.models, { suggest: DEFAULT_STEP_MODEL, pick: DEFAULT_STEP_MODEL, review: DEFAULT_STEP_MODEL });
  assert.equal(off.ladder.options.on, false);
  assert.equal(off.ladder.review.on, false, 'Line has no review rung');
  assert.equal(reasonPairOf(stepProfile('construct.fix')).ladder.options.on, true);
  assert.equal(off.plan.questions[0].kind, 'pick');
});

test('profiles: the Settings view shape lists every step with on and its win, and says in a sentence whether the picker is linked', () => {
  const off = readAiProfiles({ traceConfig: null, status: () => ({ ok: false, packages: [{ name: '@mx/reason', ok: false, message: '@mx/reason is not linked because the source folder is missing.' }] }) });
  assertAiProfiles(off);
  assert.equal(off.reason.linked, false);
  assert.match(off.reason.sentence, /static path\.$/);
  assert.ok(!('guidance' in off.profiles[0]), 'model-side guidance stays on the server');
  const fix = off.profiles.find((p) => p.step === 'construct.fix');
  assert.deepEqual([fix.on, /9\/10/.test(fix.win)], [true, true]);
  const on = readAiProfiles({ traceConfig: null, status: () => ({ ok: true, packages: [{ name: '@mx/reason', ok: true, message: 'ok' }] }) });
  assert.equal(on.reason.linked, true);
});

test('decide: one option left by the checks is decided by static, no model asked', async () => {
  const picker = createMockPicker(1);
  const r = await withReason(picker).decide('construct.chooser', OPTS, { check: (id) => (id === 'detail' ? null : 'not this one') });
  assertDecideResult(r, ['detail']);
  assert.deepEqual([r.choice, r.via, r.by, r.driver], ['detail', 'static', 'single', 'static']);
  assert.equal(picker.calls.length, 0);
});

test('decide: a step that is off (construct.chooser, no measured win) never asks the picker; static order, driver static', async () => {
  const picker = createMockPicker(2);
  const r = await withReason(picker, {}).decide('construct.chooser', OPTS);
  assertDecideResult(r);
  assert.deepEqual([r.choice, r.by, r.driver], ['list', 'order', 'static']);
  assert.equal(picker.calls.length, 0);
});

test('decide: with the step on and the picker up, it picks among the checked options by their plain labels (driver picker)', async () => {
  const picker = createMockPicker(2);
  const r = await withReason(picker).decide('construct.chooser', OPTS, { question: 'What does the page show' });
  assertDecideResult(r, OPTS.map((o) => o.id));
  assert.deepEqual(picker.calls, [['A list of orders', 'One order', 'A form']]);
  assert.deepEqual([r.choice, r.via, r.driver], ['form', 'jev', 'picker']);
  assert.equal(r.attribution.provider, '@mx/reason');
  assert.equal(r.attribution.decider, 'jev');
  assert.equal(r.attribution.model, DEFAULT_STEP_MODEL);
});

test('decide: middleware runs after static and before the picker; a pick outside the checked options or a throw is ignored', async () => {
  const picker = createMockPicker(0);
  const mw = ({ options }) => ({ option: options.at(-1).id, reason: 'The project rule prefers a form' });
  const r = await withReason(picker).decide('construct.chooser', OPTS, { middleware: [() => { throw new Error('x'); }, () => ({ option: 'nope' }), mw] });
  assertDecideResult(r);
  assert.deepEqual([r.choice, r.via, r.by, r.driver, r.reasons[0]], ['form', 'middleware', 'middleware', 'middleware', 'The project rule prefers a form.']);
  assert.equal(picker.calls.length, 0, 'the picker is not asked once middleware decided');
  const setup = await createDecider({ loadReason: async () => ({ module: null, note: 'off' }), middleware: [mw] }).decide('construct.chooser', OPTS);
  assert.equal(setup.driver, 'middleware');
});

test('decide fallback: reason not linked -> static order, and the attribution says why in one sentence', async () => {
  const d = createDecider({ loadReason: async () => ({ module: null, note: '@mx/reason is not linked because the source folder is missing.' }), profiles: CHOOSER_ON });
  const r = await d.decide('construct.chooser', OPTS);
  assertDecideResult(r);
  assert.deepEqual([r.choice, r.by, r.driver], ['list', 'order', 'static']);
  assert.equal(r.attribution.fellBackFrom, 'reason');
  assert.match(r.attribution.note, /source folder is missing; Line decided without the picker\.$/);
});

test("decide fallback: the picker's local model not running -> static order, and the note says so", async () => {
  const r = await withReason(createMockPicker(0, { available: false })).decide('construct.chooser', OPTS);
  assertDecideResult(r);
  assert.deepEqual([r.choice, r.via, r.attribution.fellBackFrom], ['list', 'static', 'jev']);
  assert.match(r.attribution.note, /not running/);
});

test('decide fallback: a throwing reason module falls back to static and says so', async () => {
  const d = createDecider({ loadReason: async () => ({ module: createMockReason({ fail: true }), note: null }), jev: createMockPicker(1), profiles: CHOOSER_ON });
  const r = await d.decide('construct.chooser', OPTS);
  assertDecideResult(r);
  assert.equal(r.via, 'static');
  assert.match(r.attribution.note, /mock reason failure/);
});

test('decide: nothing passing the checks asks the person (driver person)', async () => {
  const none = await createDecider({ loadReason: async () => ({ module: null, note: 'off' }) }).decide('trace.choose', OPTS, { check: () => 'no' });
  assertDecideResult(none);
  assert.deepEqual([none.choice, none.driver, none.lowConfidence], [null, 'person', true]);
});

const REFUSAL = {
  sentence: 'Nothing was saved: feature "billing" imports from feature "orders".',
  fixes: [
    { id: 'LINE-DIR/import-library', sentence: 'Import it from the library instead.', rank: 2 },
    { id: 'LINE-DIR/promote', sentence: 'Promote OrderButton to the library and re-point its users.', rank: 1 },
  ],
};

test("feedback: construct.fix (on, measured) gets a refusal's typed fixes as the options, the recommended fix first; the picker reads the refusal", async () => {
  const picker = createMockPicker(0);
  const r = await withReason(picker, {}).decide('construct.fix', [], { refusal: REFUSAL });
  assertDecideResult(r, ['LINE-DIR/promote', 'LINE-DIR/import-library']);
  assert.deepEqual([r.feedback, r.choice, r.driver], [true, 'LINE-DIR/promote', 'picker']);
  assert.deepEqual(picker.calls[0], ['Promote OrderButton to the library and re-point its users.', 'Import it from the library instead.']);
  const off = await createMockDecide().decide('construct.fix', [], { refusal: REFUSAL });
  assert.equal(off.choice, 'LINE-DIR/promote');
  assert.match(off.reasons[0], /recommends/);
});
