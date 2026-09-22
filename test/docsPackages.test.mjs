import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGES, findDocsRepoRoot, packageForRelativePath, docsPathFor } from '../src/docsPackages.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

test('PACKAGES stays in sync with site/lib/apiDocs.mjs API_PACKAGES (id + dirs)', async () => {
  const { API_PACKAGES } = await import('../site/lib/apiDocs.mjs');
  assert.deepEqual(PACKAGES.map((p) => p.id), API_PACKAGES.map((p) => p.id), 'package ids and order match');
  for (const pkg of PACKAGES) {
    const real = API_PACKAGES.find((p) => p.id === pkg.id);
    assert.deepEqual(pkg.dirs, real.dirs.map((d) => d.dir), `${pkg.id}: dirs match site/lib/apiDocs.mjs`);
  }
});

test('packageForRelativePath: longest-prefix match, no match for an unrelated path', () => {
  assert.equal(packageForRelativePath('src/engine/pipeline.mjs').id, 'engine', 'the more specific "src/engine" wins over "src"');
  assert.equal(packageForRelativePath('src/cli.mjs').id, 'core');
  assert.equal(packageForRelativePath('ui/client/features/auth/index.ts').id, 'cockpit-client-features');
  assert.equal(packageForRelativePath('ui/client/components/ui/Input.jsx').id, 'cockpit-client-shared');
  assert.equal(packageForRelativePath('docs/API-DOCS.md'), null);
  assert.equal(packageForRelativePath('some/random/project/features/checkout'), null);
});

test('findDocsRepoRoot: finds this repository from a real subdirectory, null for an ordinary project', () => {
  assert.equal(findDocsRepoRoot(path.join(REPO_ROOT, 'ui', 'client', 'features', 'auth')), REPO_ROOT);
  const plain = makeTempDir('docs-packages-test-');
  assert.equal(findDocsRepoRoot(plain), null);
  fs.rmSync(plain, { recursive: true, force: true });
});

test('docsPathFor: a real path in this repo resolves; an ordinary project never does', () => {
  assert.equal(docsPathFor(REPO_ROOT, path.join(REPO_ROOT, 'ui/client/features/auth')), 'developers/api/cockpit-client-features/');
  assert.equal(docsPathFor(REPO_ROOT, path.join(REPO_ROOT, 'src/engine/pipeline.mjs')), 'developers/api/engine/');
  const plain = makeTempDir('docs-packages-test-');
  fs.mkdirSync(path.join(plain, 'features/checkout'), { recursive: true });
  assert.equal(docsPathFor(plain, path.join(plain, 'features/checkout')), null);
  fs.rmSync(plain, { recursive: true, force: true });
});
