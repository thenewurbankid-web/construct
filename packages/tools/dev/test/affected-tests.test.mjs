// #929 -- affected-tests.mjs: the pre-merge test subset, over a small fixture graph on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../../test-utils/tmpdir.mjs';
import { buildGraph, selectTests, summarizeTap, isTestHelper, SHARED_THRESHOLD } from '../affected-tests.mjs';

function repo(files) {
  const root = makeTempDir('construct-affected-');
  for (const [f, src] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), src); }
  return root;
}

const FILES = {
  'packages/core/a.mjs': "import { b } from './b.mjs';\nexport const a = () => b;\n",
  'packages/core/b.mjs': "export * from './c.mjs';\nexport const b = 1;\n",
  'packages/core/c.mjs': 'export const c = 2;\n',
  'packages/core/data.json': '{"x":1}\n',
  'packages/core/reader.mjs': "import fs from 'node:fs';\nexport const read = () => fs.readFileSync(new URL('./rules.yml', import.meta.url));\n",
  'packages/core/rules.yml': 'a: 1\n',
  'packages/cli/run.mjs': "import('../core/c.mjs');\n",
  'packages/other/z.mjs': 'export const z = 0;\n',
  'test/a.test.mjs': "import { a } from '../packages/core/a.mjs';\n// fixture source in a template literal is not an import\nconst s = `import x from '../packages/other/z'`;\n",
  'test/json.test.mjs': "import d from '../packages/core/data.json' with { type: 'json' };\n",
  'test/reader.test.mjs': "import { read } from '../packages/core/reader.mjs';\n",
  'test/cli.test.mjs': "import path from 'node:path';\nconst cli = path.join('packages', 'cli', 'run.mjs');\n",
  'test/z.test.mjs': "import { z } from '../packages/other/z.mjs';\n",
  'test/tsc-error-ratchet.test.mjs': '',
  'test/api-coverage.test.mjs': '',
  'test/validate.characterization.test.mjs': '',
  'test/thing.golden.test.mjs': '',
};
const TESTS = Object.keys(FILES).filter((f) => f.endsWith('.test.mjs')).sort();

function select(changed, files = FILES) {
  const root = repo(files);
  const tests = Object.keys(files).filter((f) => f.endsWith('.test.mjs')).sort();
  const { deps, text } = buildGraph(root, tests, { files: Object.keys(files) });
  const r = selectTests({ changed, tests, deps, text });
  return { ...r, files: r.selected.map((s) => s.file), why: Object.fromEntries(r.selected.map((s) => [s.file, s.reason])) };
}

test('a transitive change (through a re-export) selects its importers, the CLI spawner and the guards, and nothing unrelated', () => {
  const r = select(['packages/core/c.mjs']);
  assert.deepEqual(r.full, []);
  assert.ok(r.files.includes('test/a.test.mjs'), 'a -> b -> (export *) c');
  assert.match(r.why['test/a.test.mjs'], /reaches packages\/core\/c\.mjs \(via packages\/core\/a\.mjs -> packages\/core\/b\.mjs\)/);
  assert.ok(r.files.includes('test/cli.test.mjs'), 'names packages/cli/run.mjs, which dynamically imports c');
  for (const g of ['test/tsc-error-ratchet.test.mjs', 'test/api-coverage.test.mjs']) assert.match(r.why[g], /guard/);
  for (const g of ['test/validate.characterization.test.mjs', 'test/thing.golden.test.mjs']) assert.match(r.why[g], /golden\/characterization/);
  for (const n of ['test/z.test.mjs', 'test/json.test.mjs', 'test/reader.test.mjs']) assert.ok(!r.files.includes(n), n);
});

test('golden tests ride along only for packages/core or packages/engine changes; a changed test selects itself', () => {
  const r = select(['packages/other/z.mjs', 'test/json.test.mjs']);
  assert.deepEqual(r.files, ['test/api-coverage.test.mjs', 'test/json.test.mjs', 'test/tsc-error-ratchet.test.mjs', 'test/z.test.mjs']);
  assert.equal(r.why['test/json.test.mjs'], 'changed test file');
});

test('non-code changes: an imported JSON is a graph edge; a YAML read by name reaches the reader and its tests', () => {
  assert.ok(select(['packages/core/data.json']).files.includes('test/json.test.mjs'));
  const r = select(['packages/core/rules.yml']);
  assert.ok(r.files.includes('test/reader.test.mjs'));
  assert.ok(!r.files.includes('test/a.test.mjs'));
});

test('a manifest, lockfile or the runner advises the full suite and selects everything', () => {
  for (const c of ['package.json', 'ui/server/package.json', 'package-lock.json', 'packages/tools/dev/run-tests.mjs']) {
    const r = select([c]);
    assert.equal(r.full.length, 1, c);
    assert.deepEqual(r.files, TESTS);
  }
});

test('a shared helper is full-suite only past the threshold', () => {
  const files = { 'test-utils/h.mjs': 'export const h = 1;\n' };
  for (let i = 0; i < SHARED_THRESHOLD; i++) files[`test/h${i}.test.mjs`] = "import { h } from '../test-utils/h.mjs';\n";
  files['test/other.test.mjs'] = '';
  assert.ok(isTestHelper('test-utils/h.mjs') && isTestHelper('fixtures/x/a.ts') && isTestHelper('test/shared.mjs') && !isTestHelper('test/a.test.mjs'));
  const r = select(['test-utils/h.mjs'], files);
  assert.match(r.full[0], /shared helper\/fixture test-utils\/h\.mjs reaches 20 tests/);
  assert.equal(r.files.length, SHARED_THRESHOLD + 1);
  delete files['test/h0.test.mjs'];
  const below = select(['test-utils/h.mjs'], files);
  assert.deepEqual(below.full, []);
  assert.equal(below.files.length, SHARED_THRESHOLD - 1);
});

test('summarizeTap reads the counts and the failing names', () => {
  const tap = ['TAP version 13', '# Subtest: s', '    not ok 1 - breaks things', '    ok 2 - fine', 'not ok 1 - s', 'ok 2 - t # SKIP', '# pass 3', '# fail 2', '# skipped 1', '# todo 0'].join('\n');
  assert.deepEqual(summarizeTap(tap), { pass: 3, fail: 2, skip: 1, failing: ['breaks things', 's'] });
});
