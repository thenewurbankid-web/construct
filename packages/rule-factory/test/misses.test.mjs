// im1 -- miss reports: every miss is ABSENT (the right answer was not among Line's options) or PICKED (offered, but
// another was recommended), per step, from plan feedback, Train Line's gold and the drafter eval; the report lists the
// most common absent patterns, slotted. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClassifiedMiss, assertMissReport, domainFree } from '../contract.mjs';
import { missesFromEvalCase, classifiedFromPlanDoc, missReport, requestShape } from '../misses.mjs';
import { trainMisses, drafterMisses } from '../eval-misses.mjs';

const EVAL_CASE = {
  id: 'tc-1', request: 'Fix the problem in <finding:P1>.',
  gold: [
    { sig: 'line.fix', step: 'line.fix', outcome: 'change', preferred: true, found: true },
    { sig: 'line.promote', step: 'line.promote', outcome: 'change', preferred: false, found: false },
  ],
  offered: ['line.fix', 'line.fix (other)'], chosen: 'line.fix',
};

test('contract: absent exactly when the right answer was not offered; a domain word or a non-miss is refused', () => {
  const ok = { id: 'x', source: 'train', step: 'line.promote', kind: 'absent', options: ['line.fix'], chosen: 'line.fix', correct: 'line.promote', correctFrom: 'train-gold', pattern: 'fix the problem in <finding> -> line.promote', sentence: 'Line never offered it.' };
  assertClassifiedMiss(ok);
  assert.throws(() => assertClassifiedMiss({ ...ok, kind: 'picked' }), /picked exactly when/);
  assert.throws(() => assertClassifiedMiss({ ...ok, options: ['line.promote'], kind: 'picked', chosen: 'line.promote' }), /other than the right answer/);
  assert.throws(() => assertClassifiedMiss({ ...ok, pattern: 'fix OrderButton in <feature> -> line.promote' }), /no domain word/);
  assert.throws(() => assertClassifiedMiss({ ...ok, pattern: 'set the title to "Spring sale" -> line.setPageProp' }), /no domain word/);
  assert.equal(domainFree('<feature> uses <item> from <feature>, which is not allowed; fix it -> line.promote + line.baseOn'), true);
  assert.equal(domainFree('line.baseOn refused (LINE-DIR) -> LINE-DIR/promote'), true);
});

test('eval case: a gold route never offered is absent; the preferred one offered but not recommended is picked', () => {
  const [m] = missesFromEvalCase('train', EVAL_CASE);
  assert.equal(m.kind, 'absent');
  assert.equal(m.step, 'line.promote');
  assert.equal(m.pattern, 'fix the problem in <finding> -> line.promote');
  assert.equal(m.correctFrom, 'train-gold');
  const picked = missesFromEvalCase('drafter-eval', { ...EVAL_CASE, gold: [{ ...EVAL_CASE.gold[0] }, { ...EVAL_CASE.gold[1], found: true, preferred: false }], offered: ['line.fix', 'line.promote'], chosen: 'line.promote' });
  assert.deepEqual(picked.map((x) => [x.kind, x.step, x.chosen, x.correct, x.correctFrom]), [['picked', 'line.fix', 'line.promote', 'line.fix', 'drafter-eval']]);
  // A question the gold wanted and Line did not ask is absent on the "ask" step.
  const ask = missesFromEvalCase('train', { id: 'tc-2', request: 'Make a <library:L1> in <feature:F1>.', gold: [{ sig: 'ask', step: 'ask', outcome: 'question', preferred: true, found: false }], offered: ['line.baseOn (other)'], chosen: 'line.baseOn (other)' });
  assert.deepEqual(ask.map((x) => [x.kind, x.step]), [['absent', 'ask']]);
  assert.deepEqual(missesFromEvalCase('train', { ...EVAL_CASE, gold: [EVAL_CASE.gold[0]] }), []);
  assert.equal(requestShape('set the <prop:A1> of the <page:P1~words> to <value:V1>'), 'set the <prop> of the <page> to <value>');
});

test('plan feedback: the person applied an offered fix static did not recommend (picked), their own step (absent), or edited and retried (absent)', () => {
  const fixes = [
    { id: 'fix', fixId: 'LINE-DIR/promote', recommended: true, step: { tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } } },
    { id: 'fix', fixId: 'LINE-DIR/move', recommended: false, step: { tool: 'line.moveFile', args: { from: 'a.tsx', to: 'b.tsx' } } },
  ];
  const target = { id: 's1', n: 1, kind: 'write', addedBy: 'jev', tool: 'line.setFragment', status: 'done', args: { file: 'f.tsx', code: 'x' }, result: { needsYou: true, findings: [{ rule: 'LINE-DIR' }], options: fixes } };
  const doc = { plans: [{ id: 'p1', steps: [
    target,
    { id: 's2', n: 2, kind: 'write', addedBy: 'ui', tool: 'line.moveFile', status: 'done', args: { from: 'a.tsx', to: 'b.tsx', fixOf: 's1' } },
    { id: 's3', n: 3, kind: 'write', addedBy: 'ui', tool: 'line.setBase', status: 'done', args: { file: 'f.tsx', libraryId: 'components/Badge', fixOf: 's1' } },
    { id: 's4', n: 4, kind: 'write', addedBy: 'ui', tool: 'line.setFragment', status: 'done', args: { file: 'f.tsx', code: 'y', retry: { of: 's1' } } },
    { id: 's5', n: 5, kind: 'write', addedBy: 'ui', tool: 'line.promote', status: 'done', args: { featureItemId: 'orders/components/OrderButton', fixOf: 's1' } },
  ] }] };
  const ms = classifiedFromPlanDoc(doc, 'line/plans/ses.json');
  assert.deepEqual(ms.map((m) => [m.id, m.kind, m.correct]), [
    ['plan:p1:s2', 'picked', 'LINE-DIR/move'],
    ['plan:p1:s3', 'absent', "line.setBase (the person's own step)"],
    ['plan:p1:s4', 'absent', "line.setFragment (the person's edit)"],
  ]);
  for (const m of ms) { assert.equal(m.step, 'line.setFragment'); assert.equal(m.correctFrom, 'person'); assert.match(m.pattern, /^line\.setFragment refused \(LINE-DIR\) -> /); }
  // A step an agent added is not the person's answer.
  assert.deepEqual(classifiedFromPlanDoc({ plans: [{ id: 'p', steps: [target, { ...doc.plans[0].steps[1], addedBy: 'agent' }] }] }, 'f'), []);
});

test('missReport: per step absent and picked, the top absent patterns slotted, and one sentence', () => {
  const ms = [
    ...trainMisses({ cases: [EVAL_CASE, { ...EVAL_CASE, id: 'tc-3' }, { ...EVAL_CASE, id: 'tc-4', request: 'Clear the reported problem on <finding:P1>.' }] }),
    ...drafterMisses({ results: [{ id: 'ls-1', request: 'share <component:C1> with <feature:F1>', gold: [{ sig: 'line.promote + line.baseOn', step: 'line.promote', outcome: 'change', preferred: true, found: true }], offered: ['line.promote + line.baseOn', 'line.promote (other)'], chosen: 'line.promote (other)' }] }),
  ];
  const r = missReport(ms);
  assertMissReport(r);
  assert.deepEqual(r.total, { misses: 4, absent: 3, picked: 1 });
  assert.deepEqual(r.steps.map((s) => [s.step, s.absent, s.picked]), [['line.promote', 3, 1]]);
  assert.equal(r.topAbsent[0].pattern, 'fix the problem in <finding> -> line.promote');
  assert.equal(r.topAbsent[0].count, 2);
  assert.deepEqual(r.topAbsent[0].sources, ['train']);
  assert.match(r.sentence, /^4 misses: 3 where the right answer was not among Line's options/);
  assert.equal(missReport([]).sentence, 'No misses: every right answer was offered and recommended.');
});
