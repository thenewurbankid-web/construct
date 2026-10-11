// `npm test` (packages/tools/dev/run-tests.mjs): node --test's own file patterns, minus nested git checkouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { testFiles } from '../packages/tools/dev/run-tests.mjs';

test('npm test: node --test\'s default patterns, with no nested checkout, dot folder, test fixture or node_modules', () => {
  const root = makeTempDir('construct-run-tests-');
  const put = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), ''); };
  for (const f of ['a.test.mjs', 'b-test.js', 'c_test.cjs', 'test-d.mjs', 'test.js', 'test/helpers/e.mjs', 'f.test.ts', 'src/g.spec.mjs', 'h.mjs']) put(f);
  put('copy/.git/HEAD'); put('copy/x.test.mjs');
  put('wt/.git'); put('wt/y.test.mjs');
  put('.claude/z.test.mjs');
  put('node_modules/pkg/w.test.mjs');
  put('test/fixtures/app/src/hook.ts');
  assert.deepEqual(testFiles(root), ['a.test.mjs', 'b-test.js', 'c_test.cjs', 'f.test.ts', 'test-d.mjs', 'test.js', 'test/helpers/e.mjs']);
});
