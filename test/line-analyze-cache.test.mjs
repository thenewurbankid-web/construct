// Line logic verification step 7 (speed): analyzeClosure cached by content (characterize/analyzeCache.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { analyzeClosure } from '../packages/engine/line/characterize/analyze.mjs';
import { createAnalysisCache, analysisKey } from '../packages/engine/line/characterize/analyzeCache.mjs';

function app() {
  const root = makeTempDir('construct-analyze-cache-');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/limits.ts'), 'export const LIMIT = 18;\n');
  fs.writeFileSync(path.join(root, 'src/age.ts'), "import { LIMIT } from './limits';\nexport function isAdult(age: number) { return age >= LIMIT && age < 120; }\n");
  return root;
}

const counting = () => {
  const calls = [];
  return { calls, analyze: (root, closure) => { calls.push(closure.files.join(',')); return analyzeClosure(root, closure); } };
};

test('a second call on an unchanged file does not recompute; the cached result equals a fresh one', (t) => {
  const root = app();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = counting();
  const cache = createAnalysisCache({ analyze: c.analyze });
  const first = cache.analyze(root, { files: ['src/age.ts'] });
  const second = cache.analyze(root, { files: ['src/age.ts'] });
  assert.equal(c.calls.length, 1);
  assert.deepEqual(cache.stats, { hits: 1, misses: 1, size: 1 });
  assert.deepEqual(second, first);
  assert.ok(second.pools.numbers.includes(120));
  // a caller editing its copy does not change the next caller's
  second.pools.numbers.push(999);
  assert.ok(!cache.analyze(root, { files: ['src/age.ts'] }).pools.numbers.includes(999));
});

test('a changed file recomputes, and so does a change in a file it imports', (t) => {
  const root = app();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = counting();
  const cache = createAnalysisCache({ analyze: c.analyze });
  cache.analyze(root, { files: ['src/age.ts'] });
  fs.writeFileSync(path.join(root, 'src/age.ts'), "import { LIMIT } from './limits';\nexport function isAdult(age: number) { return age >= LIMIT && age < 130; }\n");
  const changed = cache.analyze(root, { files: ['src/age.ts'] });
  assert.equal(c.calls.length, 2);
  assert.ok(changed.pools.numbers.includes(130));
  const k = analysisKey(root, { files: ['src/age.ts'] });
  fs.writeFileSync(path.join(root, 'src/limits.ts'), 'export const LIMIT = 21;\n');
  assert.notEqual(analysisKey(root, { files: ['src/age.ts'] }), k);
  cache.analyze(root, { files: ['src/age.ts'] });
  assert.equal(c.calls.length, 3);
  // routes are part of the key too
  cache.analyze(root, { files: ['src/age.ts'], routes: [{ route: '/a/:id', entry: 'src/age.ts' }] });
  assert.equal(c.calls.length, 4);
});

test('the cache is bounded: the least recently used entry goes first', (t) => {
  const root = app();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = counting();
  const cache = createAnalysisCache({ max: 1, analyze: c.analyze });
  cache.analyze(root, { files: ['src/age.ts'] });
  cache.analyze(root, { files: ['src/limits.ts'] });
  assert.equal(cache.stats.size, 1);
  cache.analyze(root, { files: ['src/age.ts'] });
  assert.equal(c.calls.length, 3);
});
