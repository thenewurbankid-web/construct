import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { rulesIndex, ruleSeveritySave } from './rulesApi.mjs';

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
