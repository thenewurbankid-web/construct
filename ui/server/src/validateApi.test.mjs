import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleValidate, MAX_VIOLATIONS } from './validateApi.mjs';
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
