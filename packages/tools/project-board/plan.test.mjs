import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planActions, isOlderThan, statusForState, OFF_BOARD_LABEL } from './plan.mjs';

const now = new Date('2026-10-01T00:00:00Z');
const item = (o) => ({ itemId: 'I' + o.number, isArchived: false, status: 'Done', module: 'Core CLI', subModule: 'Enforcers', area: 'Core CLI › Enforcers', kind: 'Feature', priority: null, ...o });

test('statusForState maps closed to Done and open to Backlog', () => {
  assert.equal(statusForState('CLOSED'), 'Done');
  assert.equal(statusForState('OPEN'), 'Backlog');
});

test('isOlderThan respects the day threshold and null dates', () => {
  assert.equal(isOlderThan('2026-09-01T00:00:00Z', 14, now), true);
  assert.equal(isOlderThan('2026-09-25T00:00:00Z', 14, now), false);
  assert.equal(isOlderThan(null, 14, now), false);
});

test('adds missing issues with status derived from state', () => {
  const p = planActions({
    issues: [{ number: 1, id: 'A', state: 'OPEN' }, { number: 2, id: 'B', state: 'CLOSED', closedAt: '2026-09-30T00:00:00Z' }],
    items: [], now,
  });
  assert.deepEqual(p.add, [
    { number: 1, contentId: 'A', status: 'Backlog' },
    { number: 2, contentId: 'B', status: 'Done' },
  ]);
});

test('closed issue not Done -> Done; reopened Done issue -> In progress', () => {
  const p = planActions({
    issues: [{ number: 1, id: 'A', state: 'CLOSED', closedAt: '2026-09-30T00:00:00Z' }, { number: 2, id: 'B', state: 'OPEN' }],
    items: [item({ number: 1, status: 'In progress' }), item({ number: 2, status: 'Done' })],
    now,
  });
  assert.deepEqual(p.setStatus.map(s => [s.number, s.status]), [[1, 'Done'], [2, 'In progress']]);
  assert.equal(p.archive.length, 0);
});

test('archives Done items closed more than N days ago, only when already Done', () => {
  const p = planActions({
    issues: [
      { number: 1, id: 'A', state: 'CLOSED', closedAt: '2026-09-01T00:00:00Z' },
      { number: 2, id: 'B', state: 'CLOSED', closedAt: '2026-09-29T00:00:00Z' },
      { number: 3, id: 'C', state: 'CLOSED', closedAt: '2026-09-01T00:00:00Z' },
    ],
    items: [item({ number: 1 }), item({ number: 2 }), item({ number: 3, status: 'In progress' })],
    now,
  });
  assert.deepEqual(p.archive.map(a => a.number), [1]);
  assert.deepEqual(p.setStatus.map(a => a.number), [3]); // fixed first, archived on a later run
});

test('archived items are not re-added and are ignored', () => {
  const p = planActions({
    issues: [{ number: 1, id: 'A', state: 'CLOSED', closedAt: '2026-01-01T00:00:00Z' }],
    items: [item({ number: 1, isArchived: true })], now,
  });
  assert.deepEqual(p, { add: [], setStatus: [], setArea: [], archive: [], report: { missingModule: [], missingSubModule: [], areaProblems: [], missingKind: [], openWithoutPriority: [] } });
});

test('is idempotent: applying the plan yields an empty plan', () => {
  const issues = [{ number: 1, id: 'A', state: 'CLOSED', closedAt: '2026-09-30T00:00:00Z' }];
  const p = planActions({ issues, items: [item({ number: 1, status: 'Done' })], now });
  assert.equal(p.add.length + p.setStatus.length + p.archive.length, 0);
});

test('report flags missing Module/Kind and open non-standing issues without Priority', () => {
  const p = planActions({
    issues: [{ number: 1, id: 'A', state: 'OPEN' }, { number: 2, id: 'B', state: 'OPEN' }],
    items: [item({ number: 1, status: 'Backlog', module: null }), item({ number: 2, status: 'Backlog', kind: 'Standing' })],
    now,
  });
  assert.deepEqual(p.report, { missingModule: [1], missingSubModule: [], areaProblems: [], missingKind: [], openWithoutPriority: [1] });
});

test('Area is derived from Module + Sub-module: mismatches are fixed, impossible combos are reported', () => {
  const p = planActions({
    issues: [1, 2, 3, 4].map(n => ({ number: n, id: 'X' + n, state: 'OPEN' })),
    items: [
      item({ number: 1, status: 'Backlog', subModule: 'Enforcers', area: 'Core CLI › Enforcers' }),      // consistent
      item({ number: 2, status: 'Backlog', subModule: 'Enforcers', area: null }),                        // unset -> fix
      item({ number: 3, status: 'Backlog', subModule: 'Dashboard', area: 'Web UI › Dashboard' }),        // Dashboard is not a Core CLI sub-module
      item({ number: 4, status: 'Backlog', subModule: null }),                                           // missing sub-module
    ],
    now,
  });
  assert.deepEqual(p.setArea.map(a => [a.number, a.area]), [[2, 'Core CLI › Enforcers']]);
  assert.equal(p.report.areaProblems.length, 1);
  assert.match(p.report.areaProblems[0], /^#3: /);
  assert.deepEqual(p.report.missingSubModule, [4]);
});

test('an issue labelled off-board is never added to the board', () => {
  const p = planActions({ issues: [{ id: 'I1', number: 1, state: 'OPEN', labels: [OFF_BOARD_LABEL] }, { id: 'I2', number: 2, state: 'OPEN', labels: [] }], items: [] });
  assert.deepEqual(p.add.map((a) => a.number), [2]);
});
