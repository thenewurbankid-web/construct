// #931 (lending-qwen-7b-r1-s2): the model called finish at turn 7 while 5 approved steps waited to run; they never ran.
// finish is refused while approved steps wait (the list, f1 plan_run_next), and accepted once none waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';
import { finishRefusal } from '../packages/engine/line/hints.mjs';

const STARTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'ecommerce', 'starter');

function starter() {
  const parent = fs.realpathSync(makeTempDir('line-finish-guard-'));
  const root = path.join(parent, 'shop');
  fs.cpSync(STARTER, root, { recursive: true, filter: (src) => !/node_modules|\.next/.test(src) });
  const cli = createPlanCli({ project: root, log: path.join(parent, 'log', 'calls.jsonl'), builder: 'test', shadowJev: false });
  return { cli, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

test('finishRefusal: none waiting -> null; waiting -> the house refusal with the list and f1 plan_run_next', () => {
  assert.equal(finishRefusal([]), null);
  const r = finishRefusal([
    { n: 12, tool: 'line.setCode', args: { file: 'features/loans/pages/ApplyPage.tsx' } },
    { n: 13, tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'loans', name: 'ListPage' } },
  ]);
  assert.equal(r.code, 'STEPS_WAITING');
  assert.deepEqual(r.waiting, [{ n: 12, tool: 'line.setCode', file: 'features/loans/pages/ApplyPage.tsx' }, { n: 13, tool: 'line.baseOn', file: 'ListPage in loans' }]);
  assert.deepEqual(r.choices.map((c) => [c.ref, c.step.tool, c.recommended]), [['f1', 'plan_run_next', true]]);
  const lines = r.text.split('\n');
  assert.equal(lines[0], 'Refused (STEPS_WAITING): 2 approved steps are still waiting to run, so the work is not done.');
  assert.equal(lines[1], 'Rule: finish is accepted once no approved step is waiting to run.');
  assert.equal(lines[2], '  step 12 line.setCode features/loans/pages/ApplyPage.tsx');
  assert.equal(lines[3], '  step 13 line.baseOn ListPage in loans');
  assert.equal(lines[4], 'Choice:');
  assert.equal(lines[5], '  f1: plan_run_next {}');
  assert.match(r.text, /Send plan_run_next \{\} \(or \{"fix":"f1"\}\) once per waiting step, then call finish again\. No tool drops a waiting step/);
});

test('plan-cli finish: refused while an approved step waits; accepted after run-next; {"fix":"f1"} runs it', async () => {
  const { cli, done } = starter();
  try {
    assert.equal((await cli.run('finish', ['nothing yet'])).ok, true, 'an empty plan has nothing waiting');
    const a = await cli.run('add', ['line.createFeature', JSON.stringify({ name: 'loans', story: 'As a borrower, I want to apply for a loan, so that I get money.', points: ['The page at /loans lists loans.'] })], { why: 'Create the loans feature.' });
    assert.equal(a.ok, true, a.sentence);
    assert.match(a.sentence, /1 approved step is waiting to run \(step 1 line\.createFeature loans\): call plan_run_next to land it\./);
    const b = await cli.run('add', ['line.createFeature', JSON.stringify({ name: 'offers', story: 'As a borrower, I want to see offers, so that I pick one.', points: ['The page at /offers lists offers.'] })], { why: 'Create the offers feature.' });
    assert.equal(b.ok, true, b.sentence);

    const refused = await cli.run('finish', ['The MVP is done.']);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'STEPS_WAITING');
    assert.deepEqual(refused.waiting.map((w) => [w.n, w.tool, w.file]), [[1, 'line.createFeature', 'loans'], [2, 'line.createFeature', 'offers']]);
    assert.match(refused.sentence, /^Refused \(STEPS_WAITING\): 2 approved steps are still waiting to run/);
    assert.match(refused.sentence, /\n {2}step 1 line\.createFeature loans\n {2}step 2 line\.createFeature offers\nChoice:\n {2}f1: plan_run_next \{\}\n/);
    assert.equal(refused.fixes[0].ref, 'f1');

    const ran = await cli.run('add', [], { fix: 'f1' });
    assert.equal(ran.ok, true, ran.sentence);
    assert.equal(ran.landed, true, ran.sentence);
    const still = await cli.run('finish', ['The MVP is done.']);
    assert.equal(still.code, 'STEPS_WAITING');
    assert.deepEqual(still.waiting.map((w) => w.n), [2]);

    const ran2 = await cli.run('run-next');
    assert.equal(ran2.landed, true, ran2.sentence);
    const ok = await cli.run('finish', ['The MVP is done.']);
    assert.equal(ok.ok, true, ok.sentence);
    assert.equal(ok.finished, true);
  } finally { done(); }
});
