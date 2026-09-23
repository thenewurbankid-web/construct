import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { handleValidate, handleValidateForProject, MAX_VIOLATIONS } from './validateApi.mjs';
import { ExecutionError } from './coreExecutor.mjs';
import { createLogBuffer } from './logBuffer.mjs';

const base = { origin: 'http://localhost:3000', clientOrigin: 'http://localhost:3000' };
const v = (severity, i = 0) => ({ rule: 'PAGE-006', module: 'architecture', severity, file: `features/a/pages/P${i}.tsx`, line: 3, message: 'm', why: 'w', suggestedFix: 'f', expected: [] });

test('refuses a foreign origin and reports a missing project', () => {
  assert.equal(handleValidate({ ...base, origin: 'http://evil.example', projectDir: '/x' }).status, 403);
  assert.equal(handleValidate({ ...base, projectDir: null }).status, 400);
  assert.equal(handleValidate({ ...base, projectDir: '/x', findRoot: () => null }).status, 400);
});

test('maps the core result, only exposing the documented fields, and logs it', () => {
  const log = createLogBuffer();
  let seenRoot;
  const r = handleValidate({
    ...base, projectDir: '/proj', log, findRoot: () => '/proj',
    validate: (root) => { seenRoot = root; return { ok: false, violations: [v('error'), v('warning', 1)] }; },
  });
  assert.equal(seenRoot, '/proj');
  assert.equal(r.status, 200);
  assert.equal(r.body.passed, false);
  assert.equal(r.body.total, 2);
  assert.deepEqual(Object.keys(r.body.violations[0]).sort(), ['file', 'line', 'message', 'module', 'rule', 'severity', 'suggestedFix', 'why']);
  assert.match(log.read()[0].text, /2 violation\(s\), 1 error/);
});

test('caps the list and flags truncation; a throwing validator becomes a 500 with a generic message', () => {
  const many = Array.from({ length: MAX_VIOLATIONS + 5 }, (_, i) => v('warning', i));
  const r = handleValidate({ ...base, projectDir: '/p', findRoot: () => '/p', validate: () => ({ ok: true, violations: many }), log: createLogBuffer() });
  assert.equal(r.body.violations.length, MAX_VIOLATIONS);
  assert.equal(r.body.truncated, true);
  const bad = handleValidate({ ...base, projectDir: '/p', findRoot: () => '/p', validate: () => { throw new Error('/secret/path boom'); }, log: createLogBuffer() });
  assert.equal(bad.status, 500);
  assert.ok(!JSON.stringify(bad.body).includes('/secret'));
});

// #541: the execution-mode wrapper the /api/validate route uses.
const projectWith = (yml) => {
  const dir = makeTempDir('construct-validate-mode-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml);
  return dir;
};

test('mode engine (the default) is handleValidate unchanged, and the body says which mode ran', async () => {
  const dir = projectWith('project:\n  framework: react-spa\n');
  const r = await handleValidateForProject({ ...base, projectDir: dir, findRoot: () => dir, log: createLogBuffer(), execute: () => { throw new Error('must not spawn in engine mode'); } });
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, 'engine');
  assert.equal(typeof r.body.passed, 'boolean');
});

test('mode cli goes through the executor, logs "via CLI", and shapes the same body plus mode', async () => {
  const dir = projectWith('project:\n  execution:\n    mode: cli\n');
  const log = createLogBuffer();
  let seen;
  const r = await handleValidateForProject({
    ...base, projectDir: dir, findRoot: () => dir, log,
    execute: async (root, opts) => { seen = { root, mode: opts.mode }; return { ok: false, violations: [v('error')] }; },
  });
  assert.deepEqual(seen, { root: dir, mode: 'cli' });
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, 'cli');
  assert.equal(r.body.passed, false);
  assert.equal(r.body.total, 1);
  assert.match(log.read()[0].text, /via CLI/);
});

test('mode cli: a CLI failure is a 502 carrying the CLI\'s own words, never an empty 200', async () => {
  const dir = projectWith('project:\n  execution:\n    mode: cli\n');
  const log = createLogBuffer();
  const r = await handleValidateForProject({ ...base, projectDir: dir, findRoot: () => dir, log, execute: async () => { throw new ExecutionError('CLI_FAILED', 'The construct CLI exited with code 2: boom'); } });
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /exited with code 2: boom/);
  assert.equal(log.read()[0].level, 'error');
  const other = await handleValidateForProject({ ...base, projectDir: dir, findRoot: () => dir, log: createLogBuffer(), execute: async () => { throw new Error('/secret/path'); } });
  assert.equal(other.status, 500);
  assert.equal(other.body.error, 'Validation could not run.');
});

test('an unknown project.execution.mode is a 400 naming the value; origin and missing-project checks are unchanged', async () => {
  const dir = projectWith('project:\n  execution:\n    mode: bogus\n');
  const r = await handleValidateForProject({ ...base, projectDir: dir, findRoot: () => dir, log: createLogBuffer() });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Unknown project\.execution\.mode 'bogus'/);
  assert.equal((await handleValidateForProject({ ...base, origin: 'http://evil.example', projectDir: dir })).status, 403);
  assert.equal((await handleValidateForProject({ ...base, projectDir: null })).status, 400);
});
