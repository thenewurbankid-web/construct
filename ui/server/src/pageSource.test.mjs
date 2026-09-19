import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readPageSource } from './pageSource.mjs';
import { PagesEditorError, hashOf } from './pagesEditor.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

function makeProject(pageSource) {
  const root = makeTempDir('construct-page-source-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n');
  fs.mkdirSync(path.join(root, 'features/billing/pages'), { recursive: true });
  fs.mkdirSync(path.join(root, 'features/billing/services'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features/billing/pages/HomePage.tsx'), pageSource);
  fs.writeFileSync(path.join(root, 'features/billing/services/Secret.ts'), 'export const secret = 1;\n');
  return root;
}

test('returns the full source, its hash, and diagnostics for a page', () => {
  const src = 'export function HomePage() {\n  const s: string = 5;\n  return <p>{s}</p>;\n}\n';
  const root = makeProject(src);
  const r = readPageSource(root, 'billing', 'HomePage.tsx');
  assert.equal(r.source, src);
  assert.equal(r.contentHash, hashOf(src));
  assert.ok(r.diagnostics.some((d) => d.code === 'TS2322' && d.line === 2));
});

test('is read-only: the file on disk is untouched', () => {
  const src = 'export const x: number = "no";\n';
  const root = makeProject(src);
  const file = path.join(root, 'features/billing/pages/HomePage.tsx');
  const mtime = fs.statSync(file).mtimeMs;
  readPageSource(root, 'billing', 'HomePage.tsx');
  assert.equal(fs.readFileSync(file, 'utf8'), src);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
});

test('path scoping: escaping pages/ is rejected, same as every other pages route', () => {
  const root = makeProject('export const a = 1;\n');
  assert.throws(() => readPageSource(root, 'billing', '../services/Secret.ts'), PagesEditorError);
  assert.throws(() => readPageSource(root, 'billing', '/etc/passwd'), PagesEditorError);
  assert.throws(() => readPageSource(root, '../x', 'HomePage.tsx'), PagesEditorError);
  assert.throws(() => readPageSource(root, 'billing', 'Missing.tsx'), (e) => e instanceof PagesEditorError && e.status === 404);
});
