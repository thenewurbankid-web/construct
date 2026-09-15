import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, findProjectRoot, DEFAULT_RULES } from '../src/config.mjs';
import { ConstructError, EXIT_CODES } from '../src/diagnostics.mjs';

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-config-'));
}

test('loadConfig returns defaults when architecture.yml is absent', () => {
  const dir = tmpProject();
  const config = loadConfig(dir);
  assert.equal(config.version, 1);
  assert.equal(config.preset, 'strict-nextjs');
  assert.deepEqual(config.rules, DEFAULT_RULES);
  assert.deepEqual(config.exceptions, []);
});

test('loadConfig merges a valid architecture.yml, overriding severities', () => {
  const dir = tmpProject();
  fs.writeFileSync(
    path.join(dir, 'architecture.yml'),
    'rules:\n  PAGE-004: warning\n  PURE-001: off\n',
  );
  const config = loadConfig(dir);
  assert.equal(config.rules['PAGE-004'].severity, 'warning');
  assert.equal(config.rules['PURE-001'].severity, 'off');
  // Unrelated rule defaults are preserved, including their descriptive name.
  assert.equal(config.rules['ROUTE-001'].severity, 'error');
  assert.equal(config.rules['PAGE-004'].name, DEFAULT_RULES['PAGE-004'].name);
});

test('loadConfig accepts an object-form rule entry carrying extra fields', () => {
  const dir = tmpProject();
  fs.writeFileSync(
    path.join(dir, 'architecture.yml'),
    'rules:\n  PAGE-004: { severity: warning, note: "temporary" }\n',
  );
  const config = loadConfig(dir);
  assert.equal(config.rules['PAGE-004'].severity, 'warning');
  assert.equal(config.rules['PAGE-004'].note, 'temporary');
});

test('loadConfig throws a ConstructError on malformed YAML', () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules:\n  PAGE-004: [error\n');
  assert.throws(
    () => loadConfig(dir),
    (err) => {
      assert.ok(err instanceof ConstructError);
      assert.equal(err.exitCode, EXIT_CODES.USAGE_ERROR);
      assert.match(err.message, /Failed to parse architecture\.yml/);
      return true;
    },
  );
});

test('loadConfig throws with a "did you mean" suggestion for an unknown rule id', () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules:\n  PAGE-04: error\n');
  assert.throws(
    () => loadConfig(dir),
    (err) => {
      assert.ok(err instanceof ConstructError);
      assert.equal(err.exitCode, EXIT_CODES.USAGE_ERROR);
      assert.match(err.message, /Unknown rule 'PAGE-04'/);
      assert.match(err.message, /did you mean 'PAGE-004'\?/);
      return true;
    },
  );
});

test('loadConfig throws for an invalid severity value', () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules:\n  PAGE-004: critical\n');
  assert.throws(
    () => loadConfig(dir),
    (err) => {
      assert.ok(err instanceof ConstructError);
      assert.equal(err.exitCode, EXIT_CODES.USAGE_ERROR);
      assert.match(err.message, /Invalid severity 'critical'/);
      return true;
    },
  );
});

test('findProjectRoot discovers a monorepo parent config from a nested subdirectory', () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules: {}\n');
  const nested = path.join(dir, 'packages', 'app', 'src');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findProjectRoot(nested), dir);
});

test('findProjectRoot returns null when no architecture.yml exists up to the filesystem root', () => {
  const dir = tmpProject(); // freshly created tmp dir has no architecture.yml, and neither does its os.tmpdir() ancestry
  assert.equal(findProjectRoot(dir), null);
});
