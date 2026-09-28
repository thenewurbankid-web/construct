// packages/engine/rule-change-impact.mjs — deterministic before/after diff of
// a proposed architecture.yml edit (#395/#760). Uses fake enforcers (same
// pattern as registry.test.mjs) that read the raw architecture.yml written
// into each side's throwaway temp copy, so the test exercises the real
// isolation/diff mechanism without depending on any specific enforcer's rule
// logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { simulateRuleChangeImpact } from '../packages/engine/rule-change-impact.mjs';
import { makeViolation } from '../packages/core/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function rawConfig(root) {
  return yaml.load(fs.readFileSync(path.join(root, 'architecture.yml'), 'utf8')) || {};
}

// Flags `file` as violating `rule` whenever `predicate(rawConfig(root))` is true.
function fakeEnforcer(rule, file, predicate) {
  return {
    name: `fake-${rule}`,
    validate(root) {
      const violates = predicate(rawConfig(root));
      return {
        violations: violates
          ? [makeViolation({ rule, module: 'architecture', severity: 'error', file, line: 1, message: 'fake violation', why: 'testing simulateRuleChangeImpact', expected: [] })]
          : [],
      };
    },
  };
}

function project() {
  const dir = makeTempDir('construct-rule-impact-');
  fs.mkdirSync(path.join(dir, 'features', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'x', 'a.ts'), '// fixture\n');
  return dir;
}

test('simulateRuleChangeImpact: no-op change yields an empty diff', () => {
  const dir = project();
  const enforcers = [fakeEnforcer('DEMO-1', 'features/x/a.ts', (c) => c.rules?.['DEMO-1'] === 'error')];
  const config = { rules: { 'DEMO-1': 'error' } };
  const diff = simulateRuleChangeImpact(dir, config, { ...config }, { enforcers });
  assert.deepEqual(diff, {});
});

test('simulateRuleChangeImpact: toggling a rule on reports newly violating files', () => {
  const dir = project();
  const enforcers = [fakeEnforcer('DEMO-1', 'features/x/a.ts', (c) => c.rules?.['DEMO-1'] === 'error')];
  const diff = simulateRuleChangeImpact(
    dir,
    { rules: { 'DEMO-1': 'off' } },
    { rules: { 'DEMO-1': 'error' } },
    { enforcers },
  );
  assert.deepEqual(diff, { 'DEMO-1': { newlyViolating: ['features/x/a.ts'], newlyClean: [] } });
});

test('simulateRuleChangeImpact: toggling a rule off reports newly clean files', () => {
  const dir = project();
  const enforcers = [fakeEnforcer('DEMO-1', 'features/x/a.ts', (c) => c.rules?.['DEMO-1'] === 'error')];
  const diff = simulateRuleChangeImpact(
    dir,
    { rules: { 'DEMO-1': 'error' } },
    { rules: { 'DEMO-1': 'off' } },
    { enforcers },
  );
  assert.deepEqual(diff, { 'DEMO-1': { newlyViolating: [], newlyClean: ['features/x/a.ts'] } });
});

test('simulateRuleChangeImpact: changing severity from warning to error still counts as newly violating for this diff', () => {
  const dir = project();
  const enforcers = [fakeEnforcer('DEMO-1', 'features/x/a.ts', (c) => c.rules?.['DEMO-1'] === 'error')];
  const diff = simulateRuleChangeImpact(
    dir,
    { rules: { 'DEMO-1': 'warning' } },
    { rules: { 'DEMO-1': 'error' } },
    { enforcers },
  );
  assert.deepEqual(diff, { 'DEMO-1': { newlyViolating: ['features/x/a.ts'], newlyClean: [] } });
});

test('simulateRuleChangeImpact: adding an exception clears a violation', () => {
  const dir = project();
  const enforcers = [
    fakeEnforcer('DEMO-1', 'features/x/a.ts', (c) => !(c.exceptions || []).some((e) => e.rule === 'DEMO-1' && e.path === 'features/x/**')),
  ];
  const diff = simulateRuleChangeImpact(
    dir,
    { exceptions: [] },
    { exceptions: [{ path: 'features/x/**', rule: 'DEMO-1' }] },
    { enforcers },
  );
  assert.deepEqual(diff, { 'DEMO-1': { newlyViolating: [], newlyClean: ['features/x/a.ts'] } });
});

test('simulateRuleChangeImpact: adding a nonLayer entry clears a violation', () => {
  const dir = project();
  const enforcers = [
    fakeEnforcer('DEMO-1', 'features/x/a.ts', (c) => !(c.nonLayer || []).includes('features/x/a.ts')),
  ];
  const diff = simulateRuleChangeImpact(
    dir,
    { nonLayer: [] },
    { nonLayer: ['features/x/a.ts'] },
    { enforcers },
  );
  assert.deepEqual(diff, { 'DEMO-1': { newlyViolating: [], newlyClean: ['features/x/a.ts'] } });
});

test('simulateRuleChangeImpact: never writes to the real project architecture.yml', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules: {}\n');
  const before = fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8');
  simulateRuleChangeImpact(dir, { rules: {} }, { rules: { 'DEMO-1': 'error' } }, { enforcers: [] });
  const after = fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8');
  assert.equal(after, before);
});
