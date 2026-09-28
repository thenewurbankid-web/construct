import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleLintBuffer, MAX_VIOLATIONS } from './lintBufferApi.mjs';
import { createLogBuffer } from './logBuffer.mjs';

const base = { origin: 'http://localhost:3000', clientOrigin: 'http://localhost:3000' };
const v = (severity, i = 0) => ({ rule: 'PAGE-004', module: 'architecture', severity, file: `features/a/pages/P${i}.tsx`, line: 3, message: 'm', why: 'w', suggestedFix: 'f' });

test('refuses a foreign origin, a missing project, and a missing file/source', () => {
  assert.equal(handleLintBuffer({ ...base, origin: 'http://evil.example', projectDir: '/x', file: 'a.tsx', source: '' }).status, 403);
  assert.equal(handleLintBuffer({ ...base, projectDir: null, file: 'a.tsx', source: '' }).status, 400);
  assert.equal(handleLintBuffer({ ...base, projectDir: '/x', findRoot: () => null, file: 'a.tsx', source: '' }).status, 400);
  assert.equal(handleLintBuffer({ ...base, projectDir: '/proj', findRoot: () => '/proj', source: '' }).status, 400);
  assert.equal(handleLintBuffer({ ...base, projectDir: '/proj', findRoot: () => '/proj', file: 'a.tsx' }).status, 400);
});

test('containment: a file outside the project root is refused with the workspace error status', () => {
  const r = handleLintBuffer({
    ...base, projectDir: '/proj', findRoot: () => '/proj', file: '../../etc/passwd', source: 'x',
    lint: () => ({ violations: [] }),
  });
  assert.equal(r.status, 403);
});

test('maps the core result, only exposing the documented fields, and logs it', () => {
  const log = createLogBuffer();
  let seenArgs;
  const r = handleLintBuffer({
    ...base, projectDir: '/proj', findRoot: () => '/proj', file: 'features/a/pages/P0.tsx', source: 'export const x = 1;', log,
    lint: (root, file, source) => { seenArgs = { root, file, source }; return { violations: [v('error'), v('warning', 1)] }; },
  });
  assert.equal(seenArgs.root, '/proj');
  assert.equal(seenArgs.source, 'export const x = 1;');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.total, 2);
  assert.deepEqual(Object.keys(r.body.violations[0]).sort(), ['file', 'line', 'message', 'module', 'rule', 'severity', 'suggestedFix', 'why']);
  assert.match(log.read()[0].text, /2 violation\(s\), 1 error/);
});

test('caps the list and flags truncation; a throwing lint becomes a 500 with a generic message', () => {
  const many = Array.from({ length: MAX_VIOLATIONS + 5 }, (_, i) => v('warning', i));
  const r = handleLintBuffer({
    ...base, projectDir: '/p', findRoot: () => '/p', file: 'a.tsx', source: 'x', log: createLogBuffer(),
    lint: () => ({ violations: many }),
  });
  assert.equal(r.body.violations.length, MAX_VIOLATIONS);
  assert.equal(r.body.truncated, true);

  const bad = handleLintBuffer({
    ...base, projectDir: '/p', findRoot: () => '/p', file: 'a.tsx', source: 'x', log: createLogBuffer(),
    lint: () => { throw new Error('/secret/path boom'); },
  });
  assert.equal(bad.status, 500);
  assert.ok(!JSON.stringify(bad.body).includes('/secret'));
});

test('an unsaved file with no on-disk counterpart is allowed (mustExist: false)', () => {
  let seenFile;
  const r = handleLintBuffer({
    ...base, projectDir: '/proj', findRoot: () => '/proj', file: 'features/a/pages/New.tsx', source: 'x',
    lint: (root, file) => { seenFile = file; return { violations: [] }; },
  });
  assert.equal(r.status, 200);
  assert.equal(seenFile, '/proj/features/a/pages/New.tsx');
});
