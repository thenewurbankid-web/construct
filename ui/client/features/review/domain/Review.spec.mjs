import test from 'node:test';
import assert from 'node:assert/strict';
import { groupByFeature, OUTSIDE_LABEL } from './FeatureGrouping.ts';
import { groupByLayer } from './LayerGrouping.ts';
import { flatFiles } from './TreeFiles.ts';
import { badgesOf } from './Badges.ts';
import { rankBranches, riskScore } from './Ranking.ts';
import { buildUnitsView, trimLead } from './UnitRows.ts';
import { buildIndicatorCard } from './IndicatorView.ts';
import { initialList, listIsSettling, listReducer } from '../workflows/ListMachine.ts';
import { changeReducer, initialChange } from '../workflows/ChangeMachine.ts';

const f = (path, feature, layer, status = 'M') => ({ path, status, feature, layer, scope: feature ?? '.' });
const FILES = [
  f('features/checkout/services/checkoutService.ts', 'checkout', 'service'),
  f('features/billing/components/BillingView.tsx', 'billing', 'component'),
  f('features/billing/domain/billingRules.ts', 'billing', 'domain'),
  f('features/billing/services/billingService.ts', 'billing', 'service', 'A'),
  f('README.md', null, null),
  f('features/billing/index.ts', 'billing', 'feature api'),
];

test('grouping is feature, then layer, in the order a feature reads (domain first, wiring last)', () => {
  const groups = groupByFeature(FILES);
  assert.deepEqual(groups.map((g) => g.label), ['billing', 'checkout', OUTSIDE_LABEL]);
  const billing = groups[0];
  assert.equal(billing.fileCount, 4);
  assert.deepEqual(billing.layers.map((l) => l.layer), ['domain', 'service', 'component', 'feature api']);
});

test('a file with no feature or layer still appears, marked as not classified', () => {
  const outside = groupByFeature(FILES).at(-1);
  assert.equal(outside.outside, true);
  assert.deepEqual(outside.layers.map((l) => [l.layer, l.label]), [['unclassified', 'not classified']]);
  assert.equal(outside.layers[0].files[0].path, 'README.md');
});

test('every changed file appears exactly once in each grouping', () => {
  const byFeature = groupByFeature(FILES).flatMap((g) => g.layers.flatMap((l) => l.files.map((x) => x.path)));
  const byLayer = groupByLayer(FILES).flatMap((l) => l.files.map((y) => y.path));
  const all = FILES.map((x) => x.path).sort((a, b) => a.localeCompare(b));
  assert.deepEqual([...byFeature].sort((a, b) => a.localeCompare(b)), all);
  assert.deepEqual([...byLayer].sort((a, b) => a.localeCompare(b)), all);
  assert.deepEqual(flatFiles(FILES).map((x) => x.path), all);
});

const ind = (id, status, measured = true, findings = 0) => ({ id, title: id, status, measured, headline: `${id} headline`, findings });
const done = (indicators, extra = {}) => ({ state: 'done', summary: 's', files: 3, features: [], findings: indicators.reduce((n, i) => n + i.findings, 0), counts: { mechanical: 0, conversation: 0 }, scope: null, degraded: null, indicators, ...extra });

test('no plan is a neutral badge, and nothing found is a positive one, never an empty cell', () => {
  const b = badgesOf(done([ind('blast-radius', 'not-measured', false), ind('unexplained', 'clear'), ind('rule-regressions', 'clear'), ind('public-surface', 'clear'), ind('flow-diff', 'clear')]));
  assert.deepEqual(b.map((x) => [x.text, x.tone]), [['No plan', 'neutral'], ['Nothing found', 'ok']]);
});

test('findings become text badges: scope, rule regressions, public API, flow', () => {
  const b = badgesOf(done([
    ind('blast-radius', 'attention', true, 2),
    ind('unexplained', 'attention', true, 1),
    ind('rule-regressions', 'attention', true, 2),
    ind('public-surface', 'info'),
    ind('flow-diff', 'attention', true, 1),
  ], { scope: { declared: 1, touched: 3 } }));
  assert.deepEqual(b.map((x) => x.text), ['Scope 1 → 3', '1 unexplained', '2 rule regressions', 'Public API', 'Flow changed']);
  assert.ok(!b.some((x) => x.id === 'nothing-found'));
});

test('ranking: riskiest first (attention then findings), pending last, ties by newest; or newest', () => {
  const row = (name, date, analysis) => ({ name, sha: name, subject: name, author: 'a', date, current: false, ahead: 1, analysis });
  const risky = row('risky', '2026-01-01T00:00:00Z', done([ind('rule-regressions', 'attention', true, 2)]));
  const calm = row('calm', '2026-03-01T00:00:00Z', done([ind('rule-regressions', 'clear')]));
  const pending = row('pending', '2026-04-01T00:00:00Z', { state: 'running' });
  assert.deepEqual(rankBranches([calm, pending, risky], 'risk').map((r) => r.name), ['risky', 'calm', 'pending']);
  assert.deepEqual(rankBranches([risky, calm, pending], 'newest').map((r) => r.name), ['pending', 'calm', 'risky']);
  assert.ok(riskScore(risky.analysis) > riskScore(calm.analysis));
});

test('the units view keeps units with a sentence and folds the rest into one "+N more" row', () => {
  const files = [f('features/a/domain/x.ts', 'a', 'domain'), f('features/a/domain/y.ts', 'a', 'domain'), f('features/a/gone.ts', 'a', null, 'D')];
  const v = buildUnitsView(files, [{ path: 'features/a/domain/x.ts', summary: 'File features/a/domain/x.ts: does x.', exports: ['x'] }, { path: 'features/a/domain/y.ts', summary: null }], 2);
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0].text, 'does x.');
  assert.equal(v.more.count, 4);
  assert.equal(trimLead('File a/b.ts: hi', 'a/b.ts'), 'hi');
});

test('a not-measured indicator shows its reason calmly (neutral tone, not an error)', () => {
  const card = buildIndicatorCard({ id: 'blast-radius', title: 'Declared vs actual scope', status: 'not-measured', measured: false, headline: 'Scope is not measured for this change.', reason: 'No plan is linked.', source: 'src', findings: [] });
  assert.equal(card.tone, 'neutral');
  assert.equal(card.statusLabel, 'Not measured');
  assert.equal(card.reason, 'No plan is linked.');
});

test('the list keeps polling while any row is unfinished, and stops when all are done', () => {
  const branches = (states) => states.map((s, i) => ({ name: `b${i}`, analysis: { state: s } }));
  let s = listReducer(initialList, { type: 'LOADED', data: { branches: branches(['done', 'running']) } });
  assert.equal(s.status, 'ready');
  assert.equal(listIsSettling(s), true);
  s = listReducer(s, { type: 'LOADED', data: { branches: branches(['done', 'done']) } });
  assert.equal(listIsSettling(s), false);
});

test('the list is a union: idle, then loading, then ready or error; a refresh keeps the rows it has (#592)', () => {
  const data = { branches: [{ name: 'b', analysis: { state: 'running' } }] };
  assert.deepEqual(initialList, { status: 'idle' });
  let s = listReducer(initialList, { type: 'STARTED' });
  assert.deepEqual(s, { status: 'loading' });
  s = listReducer(s, { type: 'LOADED', data });
  assert.deepEqual(s, { status: 'ready', data });
  assert.equal(listReducer(s, { type: 'STARTED' }), s, 'a re-read of a ready list keeps showing it');
  s = listReducer(s, { type: 'FAILED', error: 'boom', code: 'WORKER_FAILED' });
  assert.deepEqual(s, { status: 'error', error: 'boom', errorCode: 'WORKER_FAILED' });
  assert.equal('data' in s, false, 'an error carries no stale rows');
  assert.deepEqual(listReducer(s, { type: 'STARTED' }), { status: 'loading' }, 'retrying an error goes back to loading');
  assert.deepEqual(listReducer(initialList, { type: 'FAILED', error: 'x' }), { status: 'error', error: 'x', errorCode: null });
});

test('a poll that failed does not leave the list claiming it is still analysing (#592)', () => {
  const running = { branches: [{ name: 'b', analysis: { state: 'running' } }] };
  let s = listReducer(initialList, { type: 'LOADED', data: running });
  assert.equal(listIsSettling(s), true);
  // The poll loop stops on a failed read; the state must agree.
  s = listReducer(s, { type: 'FAILED', error: 'The Cockpit server could not be reached.', code: 'UNREACHABLE' });
  assert.equal(listIsSettling(s), false);
  assert.equal(listIsSettling(initialList), false);
  assert.equal(listIsSettling({ status: 'loading' }), false);
});

test('one change: waiting while queued, ready when done, failed with the engine message on error', () => {
  let s = changeReducer(initialChange, { type: 'RESPONSE', data: { state: 'running' } });
  assert.equal(s.status, 'waiting');
  s = changeReducer(s, { type: 'RESPONSE', data: { state: 'done', report: {} } });
  assert.equal(s.status, 'ready');
  s = changeReducer(s, { type: 'GROUPING', grouping: 'layer' });
  assert.equal(changeReducer(s, { type: 'RESET' }).grouping, 'layer', 'the chosen grouping survives opening another change');
  const failed = changeReducer(initialChange, { type: 'RESPONSE', data: { state: 'error', error: { code: 'X', message: 'boom' } } });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'boom');
});
