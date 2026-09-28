// #470 -- expectedFiles() must name exactly the files the real generators write. The test runs the real generators in a
// throwaway project and compares, so a template or path change that drifts from the derivation fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFeature, generateLayer, generateVertical } from '../packages/core/generators.mjs';
import { expectedFiles, DERIVED_FLOWS } from '../packages/core/plan-touches.mjs';
import { PLAN_FLOWS } from '../packages/core/plan.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { ingestPage } from '../packages/engine/pageTransformer.mjs';
import { generateWorkflow } from '../packages/engine/workflowGenerator.mjs';
import { generateController } from '../packages/engine/controllerBinder.mjs';
import { moveLayerFile, renameLayerFile } from '../packages/core/refactor.mjs';
import { importVertical } from '../packages/core/import.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const CHECKOUT_DESCRIPTOR = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'fixtures', 'workflow-graphs', 'checkout.json'), 'utf8'));

const CONTROLLER_PAGE_PROPS_SOURCE = `export interface CheckoutPageProps {
  onCategoryChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  value: string;
  onReset: () => void;
}
`;
const CONTROLLER_HOOK_SOURCE = `import { useState } from 'react';

export function useCheckout() {
  const [category, setCategory] = useState('');
  const [value, setValue] = useState('');

  function onSubmit() {
    setCategory('');
  }

  return { setCategory, value, onSubmit };
}
`;
const CONTROLLER_PAGE_SOURCE = `import type { CheckoutPageProps } from './CheckoutPageProps';

export function CheckoutPage({ onCategoryChange, onSubmit, value, onReset }: CheckoutPageProps) {
  return (
    <form onSubmit={onSubmit}>
      <input value={value} onChange={onCategoryChange} />
      <button type="button" onClick={onReset}>Reset</button>
    </form>
  );
}
`;

const tree = (root) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
};
const paths = (list) => list.map((f) => f.path).sort();
const added = (root, before) => tree(root).filter((f) => !before.includes(f));

test('create.feature: derives exactly the files createFeature writes', () => {
  const root = makeTempDir('og470-');
  const before = tree(root);
  const want = expectedFiles(root, 'create.feature', { name: 'wishlist' });
  createFeature(root, 'wishlist');
  assert.deepEqual(paths(want), added(root, before));
  assert.ok(want.every((f) => f.change === 'create'));
});

test('create.unit: derives exactly the file generateLayer writes, for every layer', () => {
  const root = makeTempDir('og470-');
  createFeature(root, 'wishlist');
  for (const layer of ['domain', 'service', 'workflow', 'hook', 'component', 'page']) {
    const before = tree(root);
    const want = expectedFiles(root, 'create.unit', { layer, name: 'itemRules', feature: 'wishlist' });
    generateLayer(root, layer, 'itemRules', 'wishlist');
    assert.deepEqual(paths(want), added(root, before), layer);
    assert.equal(want[0].layer, layer);
  }
});

test('create.layer: derives the files generateVertical writes, in any listed order, as a list or a comma string', () => {
  const root = makeTempDir('og470-');
  createFeature(root, 'wishlist');
  const before = tree(root);
  const want = expectedFiles(root, 'create.layer', { name: 'cart', feature: 'wishlist', layers: 'page, domain,service' });
  generateVertical(root, 'cart', 'wishlist', ['page', 'domain', 'service']);
  assert.deepEqual(paths(want), added(root, before));
  assert.deepEqual(want.map((f) => f.layer), ['domain', 'service', 'page'], 'canonical layer order, like the generator');
  assert.deepEqual(expectedFiles(root, 'create.layer', { name: 'cart', feature: 'wishlist', layers: ['service', 'domain', 'page'] }), want);
});

// #677 -- a feature that doesn't exist yet is scaffolded first (generators.mjs's ensureFeatureExists), so the
// plan preview must declare its types.ts/index.ts too, or the approval gate would refuse a file the step is
// actually about to write.
test('#677: create.unit derives the feature\'s types.ts/index.ts too when the feature does not exist yet', () => {
  const root = makeTempDir('og677-');
  const before = tree(root);
  const want = expectedFiles(root, 'create.unit', { layer: 'domain', name: 'itemRules', feature: 'wishlist' });
  generateLayer(root, 'domain', 'itemRules', 'wishlist');
  assert.deepEqual(paths(want), added(root, before));
  assert.ok(want.some((f) => f.path === 'features/wishlist/types.ts' && f.change === 'create'));
  assert.ok(want.some((f) => f.path === 'features/wishlist/index.ts' && f.change === 'create'));
});

test('#677: create.layer derives the feature\'s types.ts/index.ts too when the feature does not exist yet', () => {
  const root = makeTempDir('og677-');
  const before = tree(root);
  const want = expectedFiles(root, 'create.layer', { name: 'cart', feature: 'wishlist', layers: 'domain,service' });
  generateVertical(root, 'cart', 'wishlist', ['domain', 'service']);
  assert.deepEqual(paths(want), added(root, before));
  assert.ok(want.some((f) => f.path === 'features/wishlist/types.ts' && f.change === 'create'));
  assert.ok(want.some((f) => f.path === 'features/wishlist/index.ts' && f.change === 'create'));
});

test('#677: an already-existing feature is not re-declared (nothing new to create)', () => {
  const root = makeTempDir('og677-');
  createFeature(root, 'wishlist');
  const want = expectedFiles(root, 'create.unit', { layer: 'domain', name: 'itemRules', feature: 'wishlist' });
  assert.equal(want.length, 1);
  assert.equal(want[0].path, 'features/wishlist/domain/ItemRules.ts');
});

test('the features folder comes from architecture.yml', () => {
  const root = makeTempDir('og470-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'features:\n  root: src/features\n');
  // Feature created ahead of time, so this test stays about the custom root, independent of #677's
  // missing-feature prepend (covered separately above).
  createFeature(root, 'billing');
  const before = tree(root);
  const want = expectedFiles(root, 'create.unit', { layer: 'domain', name: 'x', feature: 'billing' });
  assert.equal(want[0].path, 'src/features/billing/domain/X.ts');
  generateLayer(root, 'domain', 'x', 'billing');
  assert.ok(added(root, before).includes(want[0].path));
});

test('an incomplete or illegal step derives nothing (null), never a guess; other flows are not derived', () => {
  const root = makeTempDir('og470-');
  assert.equal(expectedFiles(root, 'create.unit', { layer: 'domain', name: 'x' }), null, 'no feature yet');
  assert.equal(expectedFiles(root, 'create.unit', { layer: 'nope', name: 'x', feature: 'f' }), null);
  assert.equal(expectedFiles(root, 'create.layer', { name: 'x', feature: 'f', layers: '' }), null);
  assert.equal(expectedFiles(root, 'create.layer', { name: 'x', feature: 'f', layers: 'domain,bogus' }), null);
  assert.equal(expectedFiles(root, 'create.feature', { name: '   ' }), null);
  assert.equal(expectedFiles(root, 'create.feature', { name: '1 bad name!' }), null, 'the generator would refuse it, so nothing is declared');
  assert.equal(expectedFiles(root, 'refactor.move', { name: 'x', feature: 'f', from: 'domain', to: 'service' }), null);
  assert.equal(expectedFiles(root, 'summarize.list', {}), null);
  for (const id of DERIVED_FLOWS) assert.ok(PLAN_FLOWS[id]?.writes, `${id} is a real writing flow`);
});

// #610 -- the six remaining writing flows: run the real generator in a scratch project and compare against what
// expectedFiles declared ahead of time, exactly like #470's create.feature/create.unit/create.layer tests above.

test('create.page.from: derives exactly the files ingestPage writes', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  // CheckoutExport.tsx imports its own Card component -- a prerequisite the fixture always needs, unrelated to what's under test here.
  fs.mkdirSync(path.join(root, 'features', 'checkout', 'components'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'features', 'checkout', 'components', 'Card.tsx'),
    `export function Card({ children }: { children: React.ReactNode }) {\n  return <div className="card">{children}</div>;\n}\n`,
  );
  const from = path.join(REPO_ROOT, 'fixtures', 'subframe-export', 'CheckoutExport.tsx');
  const before = tree(root);
  const want = expectedFiles(root, 'create.page.from', { name: 'Checkout', feature: 'checkout', from });
  ingestPage(root, 'Checkout', 'checkout', from);
  assert.deepEqual(paths(want), added(root, before));
  assert.ok(want.every((f) => f.change === 'create'));
});

test('#677: create.page.from derives the feature\'s types.ts/index.ts too when the feature does not exist yet', () => {
  const root = makeTempDir('og610-');
  // No relative imports of its own, so the only thing under test is the feature scaffold (same fixture pageTransformer.test.mjs uses for this).
  const from = path.join(root, 'PlainExport.tsx');
  fs.writeFileSync(from, `export function PlainExport() {\n  return (<button onClick={() => {}}>Go</button>);\n}\n`);
  const before = tree(root);
  const want = expectedFiles(root, 'create.page.from', { name: 'Checkout', feature: 'nope', from });
  ingestPage(root, 'Checkout', 'nope', from);
  assert.deepEqual(paths(want), added(root, before));
  assert.ok(want.some((f) => f.path === 'features/nope/types.ts' && f.change === 'create'));
  assert.ok(want.some((f) => f.path === 'features/nope/index.ts' && f.change === 'create'));
});

test('create.page.from: a missing --from source derives nothing (null)', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  assert.equal(expectedFiles(root, 'create.page.from', { name: 'Checkout', feature: 'checkout', from: path.join(root, 'nope.tsx') }), null);
});

test('create.workflow.from: derives exactly the file generateWorkflow writes', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  const descriptorPath = path.join(REPO_ROOT, 'fixtures', 'workflow-graphs', 'checkout.json');
  const before = tree(root);
  const want = expectedFiles(root, 'create.workflow.from', { name: 'Checkout', feature: 'checkout', from: descriptorPath });
  generateWorkflow(root, 'Checkout', 'checkout', CHECKOUT_DESCRIPTOR);
  assert.deepEqual(paths(want), added(root, before));
  assert.ok(want.every((f) => f.change === 'create'));
});

test('create.workflow.from --state-union: derives the workflow file plus the typed state union file', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  const descriptorPath = path.join(REPO_ROOT, 'fixtures', 'workflow-graphs', 'checkout.json');
  const before = tree(root);
  const want = expectedFiles(root, 'create.workflow.from', { name: 'Checkout', feature: 'checkout', from: descriptorPath, stateUnion: true });
  generateWorkflow(root, 'Checkout', 'checkout', CHECKOUT_DESCRIPTOR, { stateUnion: true });
  assert.deepEqual(paths(want), added(root, before));
  assert.ok(want.some((f) => f.path === 'features/checkout/workflows/CheckoutWorkflowState.ts' && f.change === 'create'));
});

test('create.workflow.from --state-union: a pre-existing state-union file already generated by a prior run is declared modify, not create', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  const descriptorPath = path.join(REPO_ROOT, 'fixtures', 'workflow-graphs', 'checkout.json');
  generateWorkflow(root, 'Checkout', 'checkout', CHECKOUT_DESCRIPTOR, { stateUnion: true });
  const stateFile = path.join(root, 'features', 'checkout', 'workflows', 'CheckoutWorkflowState.ts');
  const before = fs.readFileSync(stateFile, 'utf8');
  const want = expectedFiles(root, 'create.workflow.from', { name: 'Checkout', feature: 'checkout', from: descriptorPath, stateUnion: true });
  generateWorkflow(root, 'Checkout', 'checkout', CHECKOUT_DESCRIPTOR, { stateUnion: true });
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before, 'regenerated identically, so this is really the modify-in-place case');
  assert.ok(want.some((f) => f.path === 'features/checkout/workflows/CheckoutWorkflowState.ts' && f.change === 'modify'));
});

test('create.workflow.from: an invalid descriptor derives nothing (null), same as compileWorkflow throwing before any write', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  const badPath = path.join(root, 'bad-descriptor.json');
  fs.writeFileSync(badPath, JSON.stringify({ states: {} }));
  assert.equal(expectedFiles(root, 'create.workflow.from', { name: 'Checkout', feature: 'checkout', from: badPath }), null);
});

test('create.controller.bind: derives exactly the file generateController writes', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  fs.writeFileSync(path.join(root, 'features', 'checkout', 'pages', 'CheckoutPageProps.ts'), CONTROLLER_PAGE_PROPS_SOURCE);
  fs.writeFileSync(path.join(root, 'features', 'checkout', 'pages', 'CheckoutPage.tsx'), CONTROLLER_PAGE_SOURCE);
  fs.writeFileSync(path.join(root, 'features', 'checkout', 'hooks', 'useCheckout.tsx'), CONTROLLER_HOOK_SOURCE);
  const before = tree(root);
  const want = expectedFiles(root, 'create.controller.bind', { name: 'Checkout', feature: 'checkout' });
  generateController(root, 'Checkout', 'checkout');
  assert.deepEqual(paths(want), added(root, before));
  assert.deepEqual(want, [{ path: 'features/checkout/controllers/CheckoutController.tsx', change: 'create' }]);
});

test('create.controller.bind: a missing prerequisite (page, props or hook) derives nothing (null)', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  assert.equal(expectedFiles(root, 'create.controller.bind', { name: 'Checkout', feature: 'checkout' }), null);
  fs.writeFileSync(path.join(root, 'features', 'checkout', 'pages', 'CheckoutPageProps.ts'), CONTROLLER_PAGE_PROPS_SOURCE);
  assert.equal(expectedFiles(root, 'create.controller.bind', { name: 'Checkout', feature: 'checkout' }), null, 'hook and page still missing');
});

test('refactor.move: derives the moved file and every rewritten importer, as move / modify -- never create', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  generateLayer(root, 'domain', 'Foo', 'checkout');
  generateLayer(root, 'hook', 'Bar', 'checkout');
  const hookFile = path.join(root, 'features', 'checkout', 'hooks', 'useBar.tsx');
  fs.writeFileSync(hookFile, `import { Foo } from '../domain/Foo';\nexport function useBar() { return Foo(); }\n`);

  const want = expectedFiles(root, 'refactor.move', { name: 'Foo', feature: 'checkout', from: 'domain', to: 'service' });
  const result = moveLayerFile(root, 'checkout', 'Foo', 'domain', 'service');

  assert.deepEqual(want.filter((f) => f.change === 'move').map((f) => f.path).sort(), [result.from, result.to].sort());
  assert.deepEqual(
    want.filter((f) => f.change === 'modify').map((f) => f.path).sort(),
    result.files.filter((f) => f !== result.from && f !== result.to).sort(),
  );
  assert.equal(want.length, want.filter((f) => f.change === 'move').length + want.filter((f) => f.change === 'modify').length);
});

test('refactor.rename: derives the renamed file and every rewritten importer, as move / modify', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  generateLayer(root, 'domain', 'Foo', 'checkout');

  const want = expectedFiles(root, 'refactor.rename', { name: 'Foo', feature: 'checkout', newName: 'Baz', layer: 'domain' });
  const result = renameLayerFile(root, 'checkout', 'Foo', 'Baz', 'domain');

  assert.deepEqual(want.filter((f) => f.change === 'move').map((f) => f.path).sort(), [result.from, result.to].sort());
  assert.deepEqual(
    want.filter((f) => f.change === 'modify').map((f) => f.path).sort(),
    result.files.filter((f) => f !== result.from && f !== result.to).sort(),
  );
});

test('refactor.move: a missing source file derives nothing (null), same as moveLayerFile throwing', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  assert.equal(expectedFiles(root, 'refactor.move', { name: 'Nope', feature: 'checkout', from: 'domain', to: 'service' }), null);
});

test('import.unit: derives exactly the files generateVertical writes via importVertical, for every requested layer', async () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  const sourceDir = makeTempDir('og610-src-');
  const sourceFile = path.join(sourceDir, 'OldGate.tsx');
  fs.writeFileSync(sourceFile, `export function useOldGate() { return true; }\n`);

  const before = tree(root);
  const want = expectedFiles(root, 'import.unit', { name: 'CpoAccess', feature: 'checkout', from: sourceFile, layers: 'domain,hook' });
  await importVertical(root, 'CpoAccess', 'checkout', ['domain', 'hook'], sourceFile);
  assert.deepEqual(paths(want), added(root, before));
  assert.ok(want.every((f) => f.change === 'create'));
  assert.deepEqual(want.map((f) => f.layer), ['domain', 'hook'], 'canonical layer order, like create.layer');
});

test('import.unit: a target file that already has real (non-stub) content derives nothing (null), same as importVertical refusing', async () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  generateLayer(root, 'domain', 'CpoAccess', 'checkout'); // real generated content, no TODO(import) breadcrumb
  const sourceDir = makeTempDir('og610-src-');
  const sourceFile = path.join(sourceDir, 'OldGate.tsx');
  fs.writeFileSync(sourceFile, `export function useOldGate() { return true; }\n`);
  assert.equal(expectedFiles(root, 'import.unit', { name: 'CpoAccess', feature: 'checkout', from: sourceFile, layers: 'domain' }), null);
  await assert.rejects(() => importVertical(root, 'CpoAccess', 'checkout', ['domain'], sourceFile));
});

test('import.unit: a missing --from source derives nothing (null)', () => {
  const root = makeTempDir('og610-');
  createFeature(root, 'checkout');
  assert.equal(expectedFiles(root, 'import.unit', { name: 'Foo', feature: 'checkout', from: path.join(root, 'nope.tsx'), layers: 'domain' }), null);
});
