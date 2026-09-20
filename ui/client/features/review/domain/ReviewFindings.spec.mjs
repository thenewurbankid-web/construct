// #315 findings, #316 blast radius, #318 failures: the pure view builders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFindingDetail, buildFindingsView } from './FindingsView.ts';
import { buildBlastView } from './BlastView.ts';
import { describeFailure } from './FailureView.ts';
import { degradedNotice } from './DegradedNotice.ts';
import { changeReducer, initialChange } from '../workflows/ChangeMachine.ts';

const INDICATORS = [
  { id: 'rule-regressions', title: 'Rule regressions' },
  { id: 'public-surface', title: 'Public surface' },
];
const FINDINGS = [
  { id: 'r1', indicator: 'rule-regressions', resolution: 'mechanical', severity: 'error', title: 'SLICE-003 is newly violated', message: 'index is stale', files: ['features/a/index.ts'], line: 3, rule: 'SLICE-003', why: 'The index must list exports.', fix: { via: 'construct sync', available: true } },
  { id: 'r2', indicator: 'rule-regressions', resolution: 'mechanical', severity: 'error', title: 'SLICE-002 is newly violated', message: 'deep import', files: ['features/b/x.ts'], fix: { via: 'construct refactor', available: false } },
  { id: 'p1', indicator: 'public-surface', resolution: 'conversation', severity: 'warning', title: 'a stops publishing Foo', message: 'Foo left the index.', files: ['features/a/index.ts'] },
];

test('mechanical and conversation findings are two separate lists, split by the engine resolution', () => {
  const v = buildFindingsView(FINDINGS, INDICATORS, null);
  assert.deepEqual(v.mechanical.map((r) => r.id), ['r1', 'r2']);
  assert.deepEqual(v.conversation.map((r) => r.id), ['p1']);
  assert.equal(v.summary, '2 of 3 findings can be fixed mechanically.');
  assert.equal(v.mechanical[0].indicatorTitle, 'Rule regressions');
});

test('a mechanical finding carries the exact engine command; available:false is said plainly', () => {
  const v = buildFindingsView(FINDINGS, INDICATORS, null);
  assert.equal(v.mechanical[0].fix.command, 'construct sync');
  assert.equal(v.mechanical[0].fix.available, true);
  assert.equal(v.mechanical[1].fix.command, 'construct refactor');
  assert.equal(v.mechanical[1].fix.available, false);
  assert.match(v.mechanical[1].fix.text, /No automated fix yet/);
});

test('a conversation finding never has a fix of any kind, even if the report carried one', () => {
  const sneaky = [{ ...FINDINGS[2], fix: { via: 'rm -rf /', available: true } }];
  const v = buildFindingsView(sneaky, INDICATORS, null);
  assert.equal(v.conversation[0].fix, null);
  assert.equal(buildFindingDetail(sneaky, 'p1').fix, null);
});

test('no findings is a designed empty summary, and the location joins file and line', () => {
  assert.equal(buildFindingsView([], INDICATORS, null).summary, 'No findings.');
  assert.equal(buildFindingsView(FINDINGS, INDICATORS, 'r1').mechanical[0].location, 'features/a/index.ts:3');
  assert.equal(buildFindingsView(FINDINGS, INDICATORS, 'r1').mechanical[0].selected, true);
});

test('the detail of a finding carries the rule, why and constraint; an unknown id is no detail', () => {
  const d = buildFindingDetail([{ ...FINDINGS[0], constraint: { layer: 'component', canImport: ['hook', 'domain'] } }], 'r1');
  assert.equal(d.resolutionLabel, 'Can be fixed mechanically');
  assert.equal(d.rule, 'SLICE-003');
  assert.match(d.constraint, /component may import hook, domain/);
  assert.equal(buildFindingDetail(FINDINGS, 'nope'), null);
});

const report = (indicator) => ({ indicators: [indicator], change: { features: [{ name: 'billing', files: 2 }, { name: 'checkout', files: 1 }] } });

test('no plan: scope is a calm neutral "not measured", never a warning', () => {
  const v = buildBlastView(report({ id: 'blast-radius', measured: false, status: 'not-measured', reason: 'No plan is linked.', evidence: {} }));
  assert.equal(v.measured, false);
  assert.equal(v.tone, 'neutral');
  assert.match(v.text, /normal for hand-written work/);
  assert.match(v.text, /Every other check on this page still runs/);
  assert.doesNotMatch(v.text, /should|must|forgot|failed/i, 'the copy does not blame the author');
});

test('with a plan: both directions, per feature, with the extra files listable', () => {
  const v = buildBlastView(report({
    id: 'blast-radius', measured: true, status: 'attention', headline: 'The plan declared 2 features; this change touches 2.',
    evidence: { declared: { features: ['billing', 'search'], files: [] }, touched: { features: ['billing', 'checkout'] }, extraFeatures: ['checkout'], unreachedFeatures: ['search'], extraFiles: { items: ['a.ts', 'b.ts'], total: 2 }, missingFiles: { items: ['c.ts'], total: 1 } },
  }));
  assert.equal(v.measured, true);
  assert.deepEqual(v.rows.map((r) => [r.feature, r.declared, r.files, r.note]), [
    ['billing', true, 2, 'As planned'],
    ['checkout', false, 1, 'Changed here, not in the plan'],
    ['search', true, 0, 'In the plan, not touched yet'],
  ]);
  assert.deepEqual(v.extraFiles, ['a.ts', 'b.ts']);
  assert.deepEqual(v.missingFiles, ['c.ts']);
  assert.equal(v.statusLabel, 'Outside the plan');
});

test('every failure states what happened and offers a next action, never a bare code', () => {
  for (const code of ['NOT_A_GIT_REPO', 'NO_PROJECT', 'BAD_REF', 'BAD_PLAN', 'TIMEOUT', 'GIT_FAILED', 'WORKER_FAILED', 'PROJECT_NOT_AT_HEAD', 'WHATEVER', null]) {
    const f = describeFailure(code, 'raw message');
    assert.ok(f.title.length > 5 && f.what.length > 10 && f.next.length > 5, code);
    assert.ok(f.actions.length >= 1, code);
    assert.doesNotMatch(f.title, /^[A-Z_]+$/, 'the title is never a raw code');
  }
  assert.deepEqual(describeFailure('NOT_A_GIT_REPO').actions, ['settings', 'retry']);
  assert.deepEqual(describeFailure('BAD_PLAN').actions, ['no-plan', 'list']);
});

test('a change over the cap says which checks still ran and which is not measured', () => {
  assert.equal(degradedNotice(null), null);
  const t = degradedNotice({ truncated: true, message: 'Larger than the 200-file cap.' });
  assert.match(t, /Larger than the 200-file cap/);
  assert.match(t, /still ran on the whole change/);
  assert.match(t, /Unexplained changes are not measured/);
});

test('selecting a finding is a state of the change and is cleared with the change', () => {
  let s = changeReducer(initialChange, { type: 'SELECT_FINDING', id: 'r1' });
  assert.equal(s.selectedFindingId, 'r1');
  s = changeReducer(s, { type: 'RESET' });
  assert.equal(s.selectedFindingId, null);
  const failed = changeReducer(initialChange, { type: 'FAILED', error: 'x', code: 'TIMEOUT' });
  assert.equal(failed.errorCode, 'TIMEOUT');
});
