// The north-star metric: the share of the opportunity feature's and the bench shop's logic maps that maps onto atoms.
// The figures are pinned so a change to an atom, a rule or a map shows up here, with the reason, in the same commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { atomCoverage, readUnits, unitAtom, MAPS, RULES } from '../metric.mjs';
import { ATOM_ROLES } from '../contract.mjs';

const survey = JSON.parse(fs.readFileSync(new URL('../survey.json', import.meta.url), 'utf8'));

test('every rule names a known role: an atom role, or a planned one from the survey (or null for "no atom job")', () => {
  const planned = new Set(survey.patterns.filter((p) => p.atom === null).map((p) => p.role));
  for (const r of RULES) assert.ok(r.role === null || Object.hasOwn(ATOM_ROLES, r.role) || planned.has(r.role), r.role);
});

test('opportunity feature (Import v2 prototype map): 110 of 637 units on atoms (17.3%), 45 more on planned atoms', () => {
  const r = atomCoverage(readUnits(MAPS.opportunity));
  assert.equal(r.units, 637);
  assert.equal(r.onAtoms, 110);
  assert.equal(r.onAtomsPct, 17.3);
  assert.equal(r.logicOnAtomsPct, 16.5);
  assert.deepEqual(r.byAtom, { 'filter-sort': 62, 'async-status': 16, 'infinite-list': 16, 'validated-submit': 16 });
  assert.deepEqual(r.byPlanned, { 'nav.searchParams': 19, 'ui.notify': 15, 'state.persist': 11 });
});

test('bench shop (Haiku pilot build, 22/22): 25 of 123 units on atoms (20.3%), 36.4% of its logic units', () => {
  const r = atomCoverage(readUnits(MAPS['bench-shop']));
  assert.equal(r.units, 123);
  assert.equal(r.onAtoms, 25);
  assert.equal(r.onAtomsPct, 20.3);
  assert.equal(r.logicOnAtomsPct, 36.4);
  assert.deepEqual(r.byAtom, { 'filter-sort': 6, 'validated-submit': 19 });
});

test('unitAtom: analytics is no atom job, storage is the planned persisted store, a query hook is the loading atom', () => {
  const u = (kind, fn, detail) => unitAtom({ id: 'x', kind, file: 'f.ts', fn, detail });
  assert.equal(u('analytics', 'h', 'track({ filters })').role, null);
  assert.deepEqual([u('storage', 'h', 'localStorage.getItem("k")').atom, u('storage', 'h', 'localStorage.getItem("k")').role], [null, 'state.persist']);
  assert.equal(u('data', 'C', 'useListOrdersQuery()').atom, 'async-status');
  assert.equal(u('branch', 'formatCurrency', 'if (n < 0)').role, null);
});
