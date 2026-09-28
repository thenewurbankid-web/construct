import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { rulesIndex, ruleSeveritySave, ruleExceptionSave, globListSave } from './rulesApi.mjs';

const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('GET /api/rules lists every rule at its built-in default severity with no architecture.yml', () => {
  const dir = makeTempDir('rules-api-');
  const { status, body } = rulesIndex(dir);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.rules.length > 0);
  const page001 = body.rules.find((r) => r.id === 'PAGE-001');
  assert.equal(page001.severity, page001.defaultSeverity);
});

test('GET /api/rules reflects the open project\'s architecture.yml severity override', () => {
  const dir = makeTempDir('rules-api-override-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\nrules:\n  PAGE-001: off\n');
  const { body } = rulesIndex(dir);
  assert.equal(body.rules.find((r) => r.id === 'PAGE-001').severity, 'off');
});

// #395 slice B -- the Rules screen's one write path: change a single rule's severity.

test('ruleSeveritySave refuses an unknown rule id or an invalid severity before touching anything', () => {
  const dir = makeTempDir('rules-api-save-');
  assert.equal(ruleSeveritySave(dir, { ruleId: 'BOGUS-1', severity: 'error', commit: true }).status, 400);
  assert.equal(ruleSeveritySave(dir, { ruleId: 'PAGE-001', severity: 'critical', commit: true }).status, 400);
  assert.equal(fs.existsSync(path.join(dir, 'architecture.yml')), false);
});

test('ruleSeveritySave preview (commit false) writes nothing and returns the before/after text plus a contentHash', () => {
  const dir = makeTempDir('rules-api-save-');
  const { status, body } = ruleSeveritySave(dir, { ruleId: 'PAGE-001', severity: 'off', commit: false });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.after, /PAGE-001: ['"]?off['"]?/);
  assert.equal(fs.existsSync(path.join(dir, 'architecture.yml')), false);
  assert.equal(body.contentHash, hashOf(''));
});

test('ruleSeveritySave commit writes the change and is readable back through GET /api/rules', () => {
  const dir = makeTempDir('rules-api-save-');
  const { body: saved } = ruleSeveritySave(dir, { ruleId: 'PAGE-001', severity: 'off', contentHash: hashOf(''), commit: true });
  assert.equal(saved.ok, true);
  assert.equal(saved.severity, 'off');
  assert.equal(rulesIndex(dir).body.rules.find((r) => r.id === 'PAGE-001').severity, 'off');
});

test('ruleSeveritySave commit is refused (409) if architecture.yml changed on disk since it was loaded', () => {
  const dir = makeTempDir('rules-api-save-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\nrules:\n  PAGE-001: error\n');
  const stale = hashOf('');
  const { status, body } = ruleSeveritySave(dir, { ruleId: 'PAGE-001', severity: 'off', contentHash: stale, commit: true });
  assert.equal(status, 409);
  assert.equal(body.code, 'CHANGED_ON_DISK');
  assert.match(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'), /PAGE-001: error/);
});

test('ruleSeveritySave commit is refused (422) rather than writing a file validateArchitectureConfig would reject', () => {
  const dir = makeTempDir('rules-api-save-');
  const before = "version: 1\nexceptions:\n  - path: 'features/x/**'\n";
  fs.writeFileSync(path.join(dir, 'architecture.yml'), before);
  const { status, body } = ruleSeveritySave(dir, { ruleId: 'PAGE-001', severity: 'off', contentHash: hashOf(before), commit: true });
  assert.equal(status, 422);
  assert.equal(body.code, 'INVALID');
  assert.ok(body.errors.length > 0);
  assert.equal(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'), before);
});

// #395 slice C -- add/remove a scoped, time-boxed exception, as a diff, same shape as severity.

test('GET /api/rules lists exceptions with their list index, normalized expires, and an expired flag', () => {
  const dir = makeTempDir('rules-api-exceptions-');
  fs.writeFileSync(
    path.join(dir, 'architecture.yml'),
    "version: 1\nexceptions:\n  - path: 'features/legacy/**'\n    rule: PAGE-004\n    expires: '2999-01-01'\n    reason: migrating\n  - path: 'features/old/**'\n    rule: PAGE-004\n    expires: '2000-01-01'\n",
  );
  const { body } = rulesIndex(dir);
  assert.equal(body.exceptions.length, 2);
  assert.deepEqual(body.exceptions[0], { index: 0, path: 'features/legacy/**', rules: ['PAGE-004'], expires: '2999-01-01', reason: 'migrating', expired: false });
  assert.equal(body.exceptions[1].expired, true);
});

test('ruleExceptionSave add refuses a missing path, an unknown rule id, or a malformed expires before touching anything', () => {
  const dir = makeTempDir('rules-api-exceptions-');
  assert.equal(ruleExceptionSave(dir, { action: 'add', rule: 'PAGE-004', commit: true }).status, 400);
  assert.equal(ruleExceptionSave(dir, { action: 'add', path: 'features/x/**', rule: 'BOGUS-1', commit: true }).status, 400);
  assert.equal(ruleExceptionSave(dir, { action: 'add', path: 'features/x/**', rule: 'PAGE-004', expires: 'soon', commit: true }).status, 400);
  assert.equal(fs.existsSync(path.join(dir, 'architecture.yml')), false);
});

test('ruleExceptionSave add previews then commits a new exception, readable back through GET /api/rules', () => {
  const dir = makeTempDir('rules-api-exceptions-');
  const preview = ruleExceptionSave(dir, { action: 'add', path: 'features/legacy/**', rule: 'PAGE-004', reason: 'migrating', commit: false });
  assert.equal(preview.status, 200);
  assert.match(preview.body.after, /features\/legacy\/\*\*/);

  const saved = ruleExceptionSave(dir, { action: 'add', path: 'features/legacy/**', rule: 'PAGE-004', reason: 'migrating', contentHash: hashOf(''), commit: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.exceptions.length, 1);
  assert.equal(rulesIndex(dir).body.exceptions[0].reason, 'migrating');
});

test('ruleExceptionSave remove refuses a stale index (400) and commit is refused (409) on a stale contentHash', () => {
  const dir = makeTempDir('rules-api-exceptions-');
  const before = "version: 1\nexceptions:\n  - path: 'features/legacy/**'\n    rule: PAGE-004\n";
  fs.writeFileSync(path.join(dir, 'architecture.yml'), before);
  assert.equal(ruleExceptionSave(dir, { action: 'remove', index: 5, contentHash: hashOf(before), commit: true }).status, 400);
  assert.equal(ruleExceptionSave(dir, { action: 'remove', index: 0, contentHash: hashOf(''), commit: true }).status, 409);
  assert.equal(rulesIndex(dir).body.exceptions.length, 1);
});

test('ruleExceptionSave remove commits the removal, and a following remove of the same index is refused', () => {
  const dir = makeTempDir('rules-api-exceptions-');
  const before = "version: 1\nexceptions:\n  - path: 'features/legacy/**'\n    rule: PAGE-004\n";
  fs.writeFileSync(path.join(dir, 'architecture.yml'), before);
  const saved = ruleExceptionSave(dir, { action: 'remove', index: 0, contentHash: hashOf(before), commit: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.exceptions.length, 0);
  const after = fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8');
  assert.equal(ruleExceptionSave(dir, { action: 'remove', index: 0, contentHash: hashOf(after), commit: true }).status, 400);
});

// #395 slice D -- nonLayer/frozen glob lists (the "Advanced" disclosure), same add/remove-as-diff shape.

test('GET /api/rules lists nonLayer and frozen globs', () => {
  const dir = makeTempDir('rules-api-globs-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), "version: 1\nnonLayer:\n  - 'features/*/tests/**'\nfrozen:\n  - '../../src/design/**'\n");
  const { body } = rulesIndex(dir);
  assert.deepEqual(body.nonLayer, ['features/*/tests/**']);
  assert.deepEqual(body.frozen, ['../../src/design/**']);
});

test('globListSave refuses an unknown field or a blank glob before touching anything', () => {
  const dir = makeTempDir('rules-api-globs-');
  assert.equal(globListSave(dir, { field: 'bogus', action: 'add', glob: 'x/**', commit: true }).status, 400);
  assert.equal(globListSave(dir, { field: 'nonLayer', action: 'add', glob: '  ', commit: true }).status, 400);
  assert.equal(fs.existsSync(path.join(dir, 'architecture.yml')), false);
});

test('globListSave add previews then commits a nonLayer glob, readable back through GET /api/rules', () => {
  const dir = makeTempDir('rules-api-globs-');
  const preview = globListSave(dir, { field: 'nonLayer', action: 'add', glob: 'features/*/tests/**', commit: false });
  assert.equal(preview.status, 200);
  assert.match(preview.body.after, /features\/\*\/tests\/\*\*/);

  const saved = globListSave(dir, { field: 'nonLayer', action: 'add', glob: 'features/*/tests/**', contentHash: hashOf(''), commit: true });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.nonLayer, ['features/*/tests/**']);
  assert.deepEqual(rulesIndex(dir).body.nonLayer, ['features/*/tests/**']);
});

test('globListSave remove refuses a stale index and commit is refused (409) on a stale contentHash, for frozen', () => {
  const dir = makeTempDir('rules-api-globs-');
  const before = "version: 1\nfrozen:\n  - '../../src/design/**'\n";
  fs.writeFileSync(path.join(dir, 'architecture.yml'), before);
  assert.equal(globListSave(dir, { field: 'frozen', action: 'remove', index: 5, contentHash: hashOf(before), commit: true }).status, 400);
  assert.equal(globListSave(dir, { field: 'frozen', action: 'remove', index: 0, contentHash: hashOf(''), commit: true }).status, 409);
  assert.deepEqual(rulesIndex(dir).body.frozen, ['../../src/design/**']);
});

test('globListSave remove commits the removal', () => {
  const dir = makeTempDir('rules-api-globs-');
  const before = "version: 1\nfrozen:\n  - '../../src/design/**'\n";
  fs.writeFileSync(path.join(dir, 'architecture.yml'), before);
  const saved = globListSave(dir, { field: 'frozen', action: 'remove', index: 0, contentHash: hashOf(before), commit: true });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.frozen, []);
});
