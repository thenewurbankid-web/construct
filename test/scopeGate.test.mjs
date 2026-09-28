// #548 — the per-transition invariant module itself: scope subset, blast radius (reusing
// impactFromChangedFiles, never rebuilt), then rules on the affected set only. The engine, gate and
// pipeline wiring is proven in their own test files (processEngine.test.mjs, approvalGate.test.mjs,
// pipeline.test.mjs); this file proves scopeGate.mjs's own contract in isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkScope, affectedSet, validateAffectedSet, checkTransition, declaredFilePaths,
} from '../packages/engine/scopeGate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');

// ---- declaredFilePaths / checkScope --------------------------------------------------------------

test('declaredFilePaths reads both touches shapes: plain strings and {path, change} objects', () => {
  assert.deepEqual(declaredFilePaths({ files: ['a.ts', { path: 'b.ts', change: 'create' } ] }), ['a.ts', 'b.ts']);
  assert.deepEqual(declaredFilePaths(null), []);
  assert.deepEqual(declaredFilePaths({}), [], 'no files array at all');
  assert.deepEqual(declaredFilePaths({ files: [{ change: 'create' }, 42, ''] }), [], 'malformed entries are dropped, not thrown on');
});

test('checkScope: every changed file inside the declared set is ok', () => {
  const scope = { files: [{ path: 'a.ts', change: 'create' }, { path: 'b.ts', change: 'create' }] };
  const result = checkScope(scope, ['a.ts', 'b.ts']);
  assert.deepEqual(result, { ok: true, outside: [], declared: ['a.ts', 'b.ts'] });
});

test('checkScope: a changed file the scope never declared is reported as outside', () => {
  const scope = { files: [{ path: 'a.ts', change: 'create' }] };
  const result = checkScope(scope, ['a.ts', 'sneaky.ts']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.outside, ['sneaky.ts']);
});

test('checkScope: a read-only block (no changed files) is trivially true against any scope, including none', () => {
  assert.deepEqual(checkScope(null, []), { ok: true, outside: [], declared: [] });
  assert.deepEqual(checkScope({ files: [{ path: 'a.ts', change: 'create' }] }, []), { ok: true, outside: [], declared: ['a.ts'] });
});

test('checkScope: an empty/missing scope refuses any actual write', () => {
  assert.equal(checkScope(null, ['a.ts']).ok, false);
  assert.deepEqual(checkScope(null, ['a.ts']).outside, ['a.ts']);
  assert.equal(checkScope({ files: [] }, ['a.ts']).ok, false);
});

// ---- affectedSet: impactFromChangedFiles, reused not rebuilt --------------------------------------

test('affectedSet: no changed files is an empty, no-op result', () => {
  assert.deepEqual(affectedSet(SHARED, []), { files: [], features: [], impact: null });
});

test('affectedSet: a shared component pulls in every feature that imports it, not just the seed file', () => {
  const result = affectedSet(SHARED, ['features/shared/components/CurrencyLabel.tsx']);
  assert.ok(result.impact.ok);
  assert.deepEqual(result.features, ['billing', 'checkout', 'reporting', 'shared']);
  assert.ok(result.files.includes('features/shared/components/CurrencyLabel.tsx'), 'the seed itself is always included');
  assert.ok(result.files.includes('features/billing/components/BillingView.tsx'), 'a dependent the seed never mentioned is pulled in');
  assert.ok(result.files.includes('features/checkout/components/CheckoutView.tsx'));
  assert.deepEqual(result.files, [...result.files].sort(), 'deterministic, sorted output');
});

test('affectedSet: a change confined to one feature never reaches another feature', () => {
  const result = affectedSet(SHARED, ['features/billing/pages/BillingPage.tsx']);
  assert.deepEqual(result.features, ['billing']);
  assert.ok(result.files.every((f) => !f.startsWith('features/checkout/') && !f.startsWith('features/reporting/')));
  assert.ok(result.files.includes('features/billing/pages/BillingPage.tsx'));
});

// ---- validateAffectedSet / checkTransition: the enforcer catalog runs on the affected set only ----

/** A fake enforcer that records exactly what `opts.files` it was called with, and fails on
 * `TRIP.ts` when that file is among them — enough to prove the affected-set wiring without needing
 * a real rule violation on the shared fixture. */
function spyEnforcer(calls) {
  return {
    name: 'spy',
    validate(root, opts) {
      calls.push(opts?.files ? [...opts.files].sort() : null);
      const hit = (opts?.files || []).includes('TRIP.ts');
      return { violations: hit ? [{ rule: 'SPY-001', file: 'TRIP.ts', message: 'tripped', severity: 'error' }] : [] };
    },
  };
}

test('validateAffectedSet: the enforcer sees the affected set (seed + blast radius), not the whole project', () => {
  const calls = [];
  const result = validateAffectedSet(SHARED, ['features/shared/components/CurrencyLabel.tsx'], [spyEnforcer(calls)]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], result.affected.files);
  assert.ok(calls[0].includes('features/billing/components/BillingView.tsx'), 'dependents are in scope for rule 3, even though rule 1 never declared them');
  assert.equal(result.ok, true);
});

test('checkTransition: OUT_OF_SCOPE stops at rule 1 — rule 2/3 never run, not even to build the affected set', () => {
  const calls = [];
  const scope = { files: [{ path: 'features/billing/pages/BillingPage.tsx', change: 'create' }] };
  const result = checkTransition(SHARED, {
    scope,
    changedFiles: ['features/billing/pages/BillingPage.tsx', 'TRIP.ts'],
    enforcers: [spyEnforcer(calls)],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OUT_OF_SCOPE');
  assert.deepEqual(result.scope.outside, ['TRIP.ts']);
  assert.equal(result.blastRadius, null);
  assert.equal(result.validation, null);
  assert.deepEqual(calls, [], 'the enforcer is never invoked for a refused transition');
});

test('checkTransition: in-scope but a rule violation on the affected set is RULE_VIOLATION, blast radius is still reported', () => {
  const scope = { files: [{ path: 'TRIP.ts', change: 'create' }] };
  const result = checkTransition(SHARED, {
    scope,
    changedFiles: ['TRIP.ts'],
    enforcers: [spyEnforcer([])],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RULE_VIOLATION');
  assert.equal(result.scope.ok, true);
  assert.ok(result.blastRadius);
  assert.equal(result.validation.ok, false);
  assert.equal(result.validation.violations[0].rule, 'SPY-001');
});

test('checkTransition: a clean in-scope change is OK, with the blast radius attached', () => {
  const scope = { files: [{ path: 'features/shared/components/CurrencyLabel.tsx', change: 'modify' }] };
  const result = checkTransition(SHARED, {
    scope,
    changedFiles: ['features/shared/components/CurrencyLabel.tsx'],
    enforcers: [spyEnforcer([])],
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.deepEqual(result.blastRadius.features, ['billing', 'checkout', 'reporting', 'shared']);
});

test('checkTransition: a read-only step (in-scope, no changed files) is OK without touching the impact graph', () => {
  const result = checkTransition(SHARED, { scope: null, changedFiles: [], enforcers: [spyEnforcer([])] });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.deepEqual(result.blastRadius, { files: [], features: [], impact: null });
});
