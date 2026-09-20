import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { featureFlow, flowFilePaths, clearFlowCache } from './flowApi.mjs';
import { viewProjectFile } from './projectNav.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

// The repo's own flow fixture: routes /billing, /billing/history, /checkout (fan-out orders+billing),
// and ui-kit, which no route reaches. Copied so a test can also add a symlink and an unrelated file.
const FIXTURE = path.resolve(import.meta.dirname, '../../../fixtures/flow-react-spa');

function makeProject() {
  const root = makeTempDir('construct-flow-');
  fs.cpSync(FIXTURE, root, { recursive: true });
  clearFlowCache();
  return root;
}

test('a real feature returns its flow: routes as roots, a fan-out, project-relative paths only', () => {
  const root = makeProject();
  const { status, body } = featureFlow(root, 'billing');
  assert.equal(status, 200);
  assert.equal(body.feature, 'billing');
  assert.equal(body.routeAdapter, true);
  assert.deepEqual(body.routes.map((r) => r.route), ['/billing', '/billing/history', '/checkout']);
  const checkout = body.routes.find((r) => r.route === '/checkout');
  assert.equal(checkout.fanOut, true);
  assert.deepEqual(checkout.features.map((f) => f.feature), ['orders', 'billing']);
  const text = JSON.stringify(body);
  assert.ok(!text.includes(root), 'no absolute project path leaks');
  assert.ok(!/"file":"\//.test(text) && !text.includes('..'), 'every file is project-relative');
});

test('a feature no route reaches carries the info-level note, not routes', () => {
  const { status, body } = featureFlow(makeProject(), 'ui-kit');
  assert.equal(status, 200);
  assert.deepEqual(body.routes, []);
  assert.equal(body.notes[0].code, 'no-route');
  assert.equal(body.notes[0].severity, 'info');
});

test('an unknown feature is a 404 and never reaches summarize', () => {
  const root = makeProject();
  assert.equal(featureFlow(root, 'nope').status, 404);
  assert.equal(featureFlow(root, 'shared-not-real').status, 404);
});

test('traversal, absolute, NUL, ref-syntax and non-string names are refused (400) before any lookup', () => {
  const root = makeProject();
  for (const bad of ['..', '../orders', 'orders/../billing', '/etc/passwd', 'C:\\x', 'billing\0', 'feature:billing', 'billing#x', '', undefined, null, 7, ['billing']]) {
    const r = featureFlow(root, bad);
    assert.equal(r.status, 400, `refuses ${JSON.stringify(bad)}`);
    assert.equal(r.body.ok, false);
  }
});

test('the flow is cached until a source file changes', () => {
  const root = makeProject();
  const first = featureFlow(root, 'billing').body;
  assert.equal(featureFlow(root, 'billing').body, first, 'same object: served from cache');
  const file = path.join(root, 'features/billing/hooks/useBilling.ts');
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\n// touched\n`);
  assert.notEqual(featureFlow(root, 'billing').body, first, 'recomputed after an edit');
});

test('flowFilePaths lists exactly the drawn files and refuses a bad feature', () => {
  const root = makeProject();
  const { files } = flowFilePaths(root, 'billing');
  assert.ok(files.has('features/billing/controllers/BillingController.tsx'));
  assert.ok(files.has('features/shared/components/CurrencyLabel.tsx'));
  assert.ok(files.has('src/App.tsx'));
  assert.ok(!files.has('features/billing/types.ts'), 'types.ts is not drawn');
  assert.equal(flowFilePaths(root, '../x').refusal.status, 400);
  assert.equal(flowFilePaths(root, 'ghost').refusal.status, 404);
});

test('opening a drawn file reads it through the shared project guard; a symlink out of the root is refused', () => {
  const root = makeProject();
  const view = viewProjectFile(root, 'features/billing/hooks/useBilling.ts');
  assert.equal(view.path, 'features/billing/hooks/useBilling.ts');
  assert.equal(typeof view.source, 'string');
  const outside = makeTempDir('construct-flow-outside-');
  fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const S = 1;\n');
  fs.symlinkSync(path.join(outside, 'secret.ts'), path.join(root, 'features/billing/hooks/link.ts'));
  assert.throws(() => viewProjectFile(root, 'features/billing/hooks/link.ts'), /not a readable source file/);
  assert.throws(() => viewProjectFile(root, '../etc/passwd'), /not a readable source file/);
});
