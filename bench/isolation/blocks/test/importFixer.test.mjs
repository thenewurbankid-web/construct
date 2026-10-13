// importFixer on the real r1 failures (C and D final attempts, copied to fixtures/r1/): tsc before and after, and
// proof that only import declarations changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { makeWorkspace, runTsc, loadTask, HERE } from '../../lib/workspace.mjs';
import { fixImports, scopeAllows } from '../importFixer.mjs';

const ts = createRequire(import.meta.url)('typescript');
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/r1');
const wsFor = (name) => join(HERE, '.work', 'test-importFixer', name);
const withoutImports = (text) => {
  const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return sf.statements.filter((s) => !ts.isImportDeclaration(s)).map((s) => s.getText(sf)).join('\n');
};
const setup = (file) => {
  const task = loadTask(file.slice(2, -4));
  const ws = wsFor(file);
  const before = readFileSync(join(FIX, file), 'utf8');
  makeWorkspace(ws, task, before);
  return { task, ws, before };
};

// r1 rows (results/r1.jsonl): C t07 :31 wrong paths, C t10 :34 useState/Button, D t05 :41 / t07 :43 / t12 :48 React UMD,
// D t10 :46 Button imported from the wrong module.
const WIRING = ['C-t07-picks-page-list.tsx', 'C-t10-browse-paging.tsx', 'D-t05-book-add-to-picks.tsx', 'D-t07-picks-page-list.tsx', 'D-t10-browse-paging.tsx', 'D-t12-browse-genre-filter.tsx'];

for (const file of WIRING) {
  test(`${file}: tsc fails before, is clean after, and only imports changed`, () => {
    const { task, ws, before } = setup(file);
    assert.equal(runTsc(ws).ok, false, 'fixture should fail tsc as in r1');
    const r = fixImports(ws, task.target);
    assert.equal(r.changed, true);
    assert.ok(r.log.length > 0, 'every change is logged');
    assert.deepEqual(runTsc(ws).errors, []);
    assert.equal(withoutImports(r.body), withoutImports(before), 'function bodies untouched');
  });
}

test('fragments (C t05 :29, C t08 :32) are left alone: nothing to import, the fragment stays a fragment', () => {
  for (const file of ['C-t05-book-add-to-picks.tsx', 'C-t08-picks-page-empty.tsx']) {
    const { task, ws, before } = setup(file);
    const r = fixImports(ws, task.target);
    assert.equal(r.body, before, file);
  }
});

test('scope rule: another feature only through its index.ts', () => {
  assert.equal(scopeAllows('/x', 'features/book/pages/BookPage.tsx', '../../picks/store/picksStore').ok, false);
  assert.equal(scopeAllows('/x', 'features/book/pages/BookPage.tsx', '../../picks').ok, true);
  assert.equal(scopeAllows('/x', 'features/book/pages/BookPage.tsx', '../../../library/components/Button').ok, true);
  assert.equal(scopeAllows('/x', 'features/picks/pages/PicksPage.tsx', '../store/picksStore').ok, true);
});

test('a direct cross-feature import is rewritten to the index when the index exports the names', () => {
  const { task, ws } = setup('D-t05-book-add-to-picks.tsx');
  writeFileSync(join(ws, 'features/picks/index.ts'), "export * from './store/picksStore';\n");
  const r = fixImports(ws, task.target);
  assert.match(r.body, /from '\.\.\/\.\.\/picks'/);
  assert.ok(r.log.some((l) => l.action === 'rewrote'));
  assert.deepEqual(runTsc(ws).errors, []);
});
