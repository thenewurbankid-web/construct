// #549: packages/core/rules-catalog.mjs -- a static metadata catalog (id/module/layers/scope/
// severity/why/expected/fix) for every rule `construct validate` can report, and the effective
// (architecture.yml-overridden) severity for a given project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { DEFAULT_RULES } from '../packages/core/config.mjs';
import { catalogRules, listRules, RULE_METADATA } from '../packages/core/rules-catalog.mjs';

const VALID_MODULES = new Set(['architecture', 'separation-of-concerns', 'readability']);
const VALID_SEVERITIES = new Set(['error', 'warning', 'info', 'off']);
const VALID_SCOPES = new Set(['buffer', 'project']);

test('catalogRules() covers every real DEFAULT_RULES id exactly once', () => {
  const defaultIds = Object.entries(DEFAULT_RULES).filter(([, v]) => 'severity' in v).map(([k]) => k).sort();
  const catalogIds = catalogRules().map((r) => r.id).sort();
  assert.deepEqual(catalogIds, defaultIds);
});

test('catalogRules() entries have a well-shaped id/module/scope/why/expected/severity', () => {
  for (const r of catalogRules()) {
    assert.equal(typeof r.id, 'string');
    assert.ok(r.id.length > 0, `${r.id}: empty id`);
    assert.ok(VALID_MODULES.has(r.module), `${r.id}: invalid module "${r.module}"`);
    assert.ok(Array.isArray(r.layers), `${r.id}: layers must be an array`);
    assert.ok(VALID_SCOPES.has(r.scope), `${r.id}: invalid scope "${r.scope}"`);
    assert.ok(VALID_SEVERITIES.has(r.defaultSeverity), `${r.id}: invalid defaultSeverity "${r.defaultSeverity}"`);
    assert.equal(r.severity, r.defaultSeverity, `${r.id}: severity should equal defaultSeverity with no root given`);
    assert.equal(typeof r.why, 'string');
    assert.ok(r.why.length > 0, `${r.id}: empty why`);
    assert.ok(Array.isArray(r.expected), `${r.id}: expected must be an array`);
    assert.ok(r.fix === null || typeof r.fix === 'string', `${r.id}: fix must be a string or null`);
  }
});

test('catalogRules() defaultSeverity matches DEFAULT_RULES for every id', () => {
  for (const r of catalogRules()) {
    assert.equal(r.defaultSeverity, DEFAULT_RULES[r.id].severity, `${r.id}: defaultSeverity drifted from DEFAULT_RULES`);
  }
});

test('RULE_METADATA has no id outside DEFAULT_RULES (no stale/typo rule ids)', () => {
  for (const id of Object.keys(RULE_METADATA)) {
    assert.ok(DEFAULT_RULES[id] && 'severity' in DEFAULT_RULES[id], `${id}: present in rules-catalog.mjs but not a real DEFAULT_RULES entry`);
  }
});

test('listRules() with no root returns default severities unchanged', () => {
  const rules = listRules();
  const page001 = rules.find((r) => r.id === 'PAGE-001');
  assert.equal(page001.severity, 'warning');
});

test('listRules(root) reflects an architecture.yml severity override for the overridden rule only', () => {
  const dir = makeTempDir('rules-catalog-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\nrules:\n  PAGE-001: off\n');

  const rules = listRules(dir);
  const page001 = rules.find((r) => r.id === 'PAGE-001');
  const page002 = rules.find((r) => r.id === 'PAGE-002');

  assert.equal(page001.severity, 'off');
  assert.equal(page001.defaultSeverity, 'warning', 'defaultSeverity must stay the built-in default even when overridden');
  assert.equal(page002.severity, page002.defaultSeverity, 'an unlisted rule keeps its default severity');
});

test('listRules(root) with no architecture.yml behaves like listRules() with no root', () => {
  const dir = makeTempDir('rules-catalog-noconfig-');
  const withRoot = listRules(dir);
  const withoutRoot = listRules();
  assert.deepEqual(withRoot, withoutRoot);
});
