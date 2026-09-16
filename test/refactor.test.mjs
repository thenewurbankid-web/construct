import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFeature, generateLayer } from '../src/generators.mjs';
import { moveLayerFile, renameLayerFile } from '../src/refactor.mjs';
import { validateArchitecture } from '../src/architecture-enforcer.mjs';
import { ConstructError } from '../src/diagnostics.mjs';

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-refactor-'));
}

test('moveLayerFile relocates the file and updates another file that imports it', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  generateLayer(dir, 'domain', 'Foo', 'checkout');
  generateLayer(dir, 'hook', 'Bar', 'checkout');
  const hookFile = path.join(dir, 'features', 'checkout', 'hooks', 'useBar.tsx');
  fs.writeFileSync(hookFile, `import { Foo } from '../domain/Foo';\nexport function useBar() { return Foo(); }\n`);

  const result = moveLayerFile(dir, 'checkout', 'Foo', 'domain', 'service');
  assert.equal(result.from, 'features/checkout/domain/Foo.tsx');
  assert.equal(result.to, 'features/checkout/services/Foo.tsx');
  assert.equal(result.importersUpdated, 1);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx')), false);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'services', 'Foo.tsx')), true);
  assert.match(fs.readFileSync(hookFile, 'utf8'), /from '\.\.\/services\/Foo'/);

  const res = validateArchitecture(dir);
  assert.equal(res.violations.some((v) => v.rule === 'IMPORT-001'), false);
});

test('moveLayerFile re-resolves the moved file\'s own same-layer relative import', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  generateLayer(dir, 'domain', 'Helper', 'checkout');
  const fooFile = path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx');
  fs.writeFileSync(fooFile, `import { Helper } from './Helper';\nexport function Foo() { return Helper(); }\n`);

  const result = moveLayerFile(dir, 'checkout', 'Foo', 'domain', 'service');
  const moved = fs.readFileSync(path.join(dir, result.to), 'utf8');
  assert.match(moved, /from '\.\.\/domain\/Helper'/);

  const res = validateArchitecture(dir);
  assert.equal(res.violations.some((v) => v.rule === 'IMPORT-001'), false);
});

test('moveLayerFile throws if the source file does not exist', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  assert.throws(() => moveLayerFile(dir, 'checkout', 'Nope', 'domain', 'service'), ConstructError);
});

test('moveLayerFile throws if the target already exists', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  generateLayer(dir, 'domain', 'Foo', 'checkout');
  generateLayer(dir, 'service', 'Foo', 'checkout');
  assert.throws(() => moveLayerFile(dir, 'checkout', 'Foo', 'domain', 'service'), ConstructError);
});

test('moveLayerFile throws when --from and --to are the same layer', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  generateLayer(dir, 'domain', 'Foo', 'checkout');
  assert.throws(() => moveLayerFile(dir, 'checkout', 'Foo', 'domain', 'domain'), ConstructError);
});

test('renameLayerFile renames within the same layer and updates importers', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  generateLayer(dir, 'domain', 'Foo', 'checkout');
  generateLayer(dir, 'hook', 'Bar', 'checkout');
  const hookFile = path.join(dir, 'features', 'checkout', 'hooks', 'useBar.tsx');
  fs.writeFileSync(hookFile, `import { Foo } from '../domain/Foo';\nexport function useBar() { return Foo(); }\n`);

  const result = renameLayerFile(dir, 'checkout', 'Foo', 'Baz', 'domain');
  assert.equal(result.to, 'features/checkout/domain/Baz.tsx');
  assert.equal(result.importersUpdated, 1);
  assert.match(fs.readFileSync(hookFile, 'utf8'), /from '\.\.\/domain\/Baz'/);
});

test('renameLayerFile applies the target layer naming convention (hook keeps its use- prefix)', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  generateLayer(dir, 'hook', 'Foo', 'checkout');
  const result = renameLayerFile(dir, 'checkout', 'Foo', 'Bar', 'hook');
  assert.equal(result.to, 'features/checkout/hooks/useBar.tsx');
});
