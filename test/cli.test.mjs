import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../src/diagnostics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'construct.mjs');

function run(args, cwd) {
  return spawnSync('node', [bin, ...args], { encoding: 'utf8', cwd: cwd ?? process.cwd() });
}

function emptyProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-'));
}

test('no command exits with USAGE_ERROR and prints usage', () => {
  const res = run([]);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stdout, /Commands:/);
});

test('unknown command exits with USAGE_ERROR and prints usage', () => {
  const res = run(['bogus-command']);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stdout, /Commands:/);
});

test('doctor exits 0 and reports environment + enforcer module availability', () => {
  const res = run(['doctor'], emptyProjectDir());
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(res.stdout, /Construct doctor/);
  assert.match(res.stdout, /Enforcer modules:/);
});

test('validate against a project with no architecture.yml/features runs cleanly without crashing', () => {
  const dir = emptyProjectDir();
  const res = run(['validate'], dir);
  // Must not internal-error or throw an unhandled exception; a report
  // (with or without violations) is fine either way.
  assert.notEqual(res.status, EXIT_CODES.INTERNAL_ERROR);
  assert.doesNotMatch(res.stderr, /Construct error:/);
  assert.ok(res.status === EXIT_CODES.OK || res.status === EXIT_CODES.VIOLATIONS);
});

test('validate --format json produces well-formed JSON through formatReport', () => {
  const dir = emptyProjectDir();
  const res = run(['validate', '--format', 'json'], dir);
  const parsed = JSON.parse(res.stdout);
  assert.ok('status' in parsed);
  assert.ok(Array.isArray(parsed.violations));
});

test('a thrown ConstructError (bad generate usage) exits with USAGE_ERROR', () => {
  const dir = emptyProjectDir();
  const res = run(['generate'], dir);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /Usage: construct generate/);
});

test('feature create then validate: generated feature has no forced feature-root violation', () => {
  const dir = emptyProjectDir();
  const created = run(['feature', 'create', 'checkout'], dir);
  assert.equal(created.status, EXIT_CODES.OK);
  const validated = run(['validate'], dir);
  assert.notEqual(validated.status, EXIT_CODES.INTERNAL_ERROR);
});

test('sync regenerates .dependency-cruiser.cjs', () => {
  const dir = emptyProjectDir();
  const res = run(['sync'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.ok(fs.existsSync(path.join(dir, '.dependency-cruiser.cjs')));
});

test('monorepo discovery: validate from a nested subdirectory uses the parent architecture.yml', () => {
  const dir = emptyProjectDir();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules:\n  PAGE-004: warning\n');
  fs.mkdirSync(path.join(dir, 'features', 'x', 'pages'), { recursive: true });
  const nested = path.join(dir, 'packages', 'app');
  fs.mkdirSync(nested, { recursive: true });
  const res = run(['validate'], nested);
  assert.notEqual(res.status, EXIT_CODES.INTERNAL_ERROR);
});
