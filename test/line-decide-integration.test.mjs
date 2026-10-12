// cu2 -- decide() on the REAL linked @mx/reason (its defineProfiles + runLadder), with a mock picker (jev) so no model runs.
// Skipped when the source repo is not linked (the fallback tests in line-decide.test.mjs cover that path).
import test from 'node:test';
import assert from 'node:assert/strict';
import { importLinked } from '../packages/line-links/index.mjs';
import { createDecider } from '../packages/core/line-decide.mjs';
import { createMockPicker } from '../packages/line-links/mocks.mjs';
import { assertDecideResult, ownModelStep, DEFAULT_STEP_MODEL } from '../packages/engine/line/contract.mjs';
import { profilesWithOn } from '../packages/core/line-decide-mock.mjs';

const linked = await importLinked('@mx/reason');
const skip = 'module' in linked ? false : linked.reason;
const real = async () => ({ module: linked.module, note: null });

test('real @mx/reason: every profile converts to a valid reason pair', { skip }, async () => {
  const { listStepProfiles, reasonPairOf } = await import('../packages/core/ai-profiles.mjs');
  const decide = listStepProfiles({ traceConfig: null }).filter((p) => p.kind === 'decide');
  const pairs = decide.map(reasonPairOf);
  const defined = linked.module.defineProfiles(pairs);
  // #892 / #903 (owner): a request reader (construct.intent*) keeps its own model; every other decide step runs the 1.5B picker.
  decide.forEach((p, i) => assert.equal(defined[pairs[i].pairId].models.pick, ownModelStep(p.step) ? p.model : DEFAULT_STEP_MODEL, p.step));
});

test('real @mx/reason: jev (mocked) decides among the checked options of a step that is on; one option is static', { skip }, async () => {
  const picker = createMockPicker(1);
  const d = createDecider({ loadReason: real, jev: picker, profiles: profilesWithOn(['construct.chooser']) });
  const r = await d.decide('construct.chooser', ['alpha', 'beta', 'gamma'], { question: 'Which next' });
  assertDecideResult(r, ['alpha', 'beta', 'gamma']);
  assert.equal(r.via, 'jev');
  assert.equal(r.choice, 'beta');
  const single = await d.decide('construct.chooser', ['alpha', 'beta'], { check: (id) => (id === 'alpha' ? null : 'no') });
  assert.equal(single.by, 'single');
});

test('real @mx/reason: a typed-fix refusal goes to jev as the options, recommended first', { skip }, async () => {
  const picker = createMockPicker(0);
  const d = createDecider({ loadReason: real, jev: picker });
  const r = await d.decide('construct.fix', [], { refusal: { sentence: 'Nothing was saved.', fixes: [{ id: 'b', sentence: 'Second fix.', rank: 2 }, { id: 'a', sentence: 'First fix.', rank: 1 }] } });
  assertDecideResult(r, ['a', 'b']);
  assert.equal(r.choice, 'a');
  assert.deepEqual(picker.calls[0], ['First fix.', 'Second fix.']);
});
