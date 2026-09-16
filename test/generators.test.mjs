import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFeature, generateLayer, generateVertical } from '../src/generators.mjs';
import { validateArchitecture } from '../src/architecture-enforcer.mjs';
import { ConstructError } from '../src/diagnostics.mjs';

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-generators-'));
}

// Canonical dependency order: controller's template imports a same-named
// page, so page must be generated first or IMPORT-001 (dangling import)
// fires — every other layer's stub is self-contained.
const LAYERS = ['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller'];

test('createFeature scaffolds the full layer folder set plus types/index', () => {
  const dir = tmpProject();
  const base = createFeature(dir, 'checkout');
  for (const folder of ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components']) {
    assert.ok(fs.existsSync(path.join(base, folder)), `missing folder: ${folder}`);
  }
  assert.ok(fs.existsSync(path.join(base, 'types.ts')));
  assert.ok(fs.existsSync(path.join(base, 'index.ts')));
});

test('createFeature PascalCases a hyphenated feature name into a valid type identifier', () => {
  const dir = tmpProject();
  const base = createFeature(dir, 'cpo-v2');
  const typesContent = fs.readFileSync(path.join(base, 'types.ts'), 'utf8');
  assert.match(typesContent, /^export type CpoV2Id = string;$/m);
  assert.doesNotMatch(typesContent, /-/);
});

test('generateLayer writes every layer into the right folder with expected naming', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  for (const layer of LAYERS) {
    const file = generateLayer(dir, layer, 'Checkout', 'checkout');
    assert.ok(fs.existsSync(file));
    if (layer === 'hook') assert.match(file, /useCheckout\.tsx$/);
    else if (layer === 'page') assert.match(file, /CheckoutPage\.tsx$/);
    else if (layer === 'controller') assert.match(file, /CheckoutController\.tsx$/);
    else assert.match(file, /Checkout\.tsx$/);
  }
});

test('generateLayer throws on an unknown layer name', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  assert.throws(() => generateLayer(dir, 'nope', 'Checkout', 'checkout'), /Unknown layer/);
});

// ---- generateVertical: one logical unit across several layers -------------

test('generateVertical scaffolds every requested layer regardless of the order given', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const files = generateVertical(dir, 'Checkout', 'checkout', ['controller', 'page', 'hook', 'domain']);
  assert.equal(files.length, 4);
  for (const f of files) assert.ok(fs.existsSync(f));
  assert.match(files[0], /domain[/\\]Checkout\.tsx$/);
  assert.match(files[1], /hooks[/\\]useCheckout\.tsx$/);
  assert.match(files[2], /pages[/\\]CheckoutPage\.tsx$/);
  assert.match(files[3], /controllers[/\\]CheckoutController\.tsx$/);
});

test('generateVertical throws on an unknown layer name before writing anything', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  assert.throws(() => generateVertical(dir, 'Checkout', 'checkout', ['domain', 'nope']), /Unknown layer/);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Checkout.tsx')), false);
});

test('generateVertical requesting a controller without its page fails fast with IMPORT-001', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  assert.throws(
    () => generateVertical(dir, 'Checkout', 'checkout', ['domain', 'hook', 'controller']),
    (err) => err.message.includes('IMPORT-001'),
  );
});

test('generateVertical deduplicates a layer listed twice', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const files = generateVertical(dir, 'Checkout', 'checkout', ['domain', 'domain']);
  assert.equal(files.length, 1);
});

// ---- idempotent-clean composition: generated code passes the enforcer -----

test('a freshly generated feature + every layer produces zero architecture violations', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  for (const layer of LAYERS) generateLayer(dir, layer, 'Checkout', 'checkout');
  const res = validateArchitecture(dir);
  const errors = res.violations.filter((v) => v.severity === 'error');
  assert.deepEqual(errors, [], `expected zero error-severity violations, got: ${JSON.stringify(errors)}`);
});

test('re-running the enforcer against generated output alone (scoped) is also clean', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const files = LAYERS.map((layer) => generateLayer(dir, layer, 'Checkout', 'checkout'));
  const rels = files.map((f) => path.relative(dir, f).replaceAll(path.sep, '/'));
  const res = validateArchitecture(dir, { files: rels });
  assert.deepEqual(res.violations, []);
});

// ---- per-layer template override hook -------------------------------------

test('a templates/<layer> file overrides the built-in template', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'templates', 'component.tsx'), 'export function {{Name}}() { return <span>{{name}}</span>; }\n');
  const file = generateLayer(dir, 'component', 'Widget', 'checkout');
  const content = fs.readFileSync(file, 'utf8');
  assert.match(content, /export function Widget\(\)/);
  assert.match(content, /<span>Widget<\/span>/);
});

test('architecture.yml `templates:` map takes precedence and resolves a relative path', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  fs.mkdirSync(path.join(dir, 'custom-templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'custom-templates', 'my-domain.ts'), 'export function {{Name}}() { return {{name}}Total; }\n');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'templates:\n  domain: custom-templates/my-domain.ts\n');
  const file = generateLayer(dir, 'domain', 'Order', 'checkout');
  assert.match(fs.readFileSync(file, 'utf8'), /export function Order\(\)/);
});

test('post-generation self-check throws a ConstructError when a custom template violates architecture', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'templates', 'domain.ts'), 'export function {{Name}}() { return fetch("/x"); }\n');
  assert.throws(() => generateLayer(dir, 'domain', 'Bad', 'checkout'), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /DOMAIN-001/);
    assert.equal(err.violations[0].rule, 'DOMAIN-001');
    return true;
  });
});
