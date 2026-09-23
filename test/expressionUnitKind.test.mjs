import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listUnits, summarizeUnit } from '../packages/engine/unitSummary.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

// #530 -- `expression` (features/*/expressions/**, packages/core/config.mjs's DEFAULT_LAYERS) is a
// real file-layer kind `ctx.layerOf` already classifies correctly, but `FILE_LAYER_KINDS`/`LAYER_DESC`
// (packages/engine/units/kinds/code.mjs) and the `NOISY` set (packages/engine/unitSummary.mjs) never
// picked it up, so `construct summarize`/`listUnits`/`/api/units` couldn't address or list one --
// every other layer with files (component, hook, service, domain, page, controller, workflow) already
// could. Strictly additive: no other kind's behavior changes.
function project() {
  const dir = makeTempDir('construct-expression-kind-');
  const write = (rel, content) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  write('architecture.yml', 'features:\n  root: features\n');
  // A real `defineExpression(...)`-built unit (#500/#503's typed-contracts factory shape), the same
  // convention every other layer's fixture in this repo uses.
  write(
    'features/cart/expressions/ShowForRole.tsx',
    `function defineExpression(name, fn) { fn.unitName = name; fn.unitLayer = 'expression'; return fn; }\n` +
      `/** Renders its children only when the current role matches. */\n` +
      `export const ShowForRole = defineExpression('ShowForRole', ({ children, role }) => (role === 'admin' ? children : null));\n`,
  );
  write('features/cart/pages/CartPage.tsx', `export default function CartPage() { return null; }\n`);
  return dir;
}

test('listUnits(kind: "expression") lists the real Expression unit with kind/path/name', () => {
  const dir = project();
  const r = listUnits(dir, { kind: 'expression' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.kind, 'expression');
  assert.equal(r.count, 1);
  assert.deepEqual(r.units[0], {
    kind: 'expression',
    id: 'features/cart/expressions/ShowForRole.tsx',
    name: 'ShowForRole.tsx',
    path: 'features/cart/expressions/ShowForRole.tsx',
    ref: 'expression:features/cart/expressions/ShowForRole.tsx',
  });
});

test('the kind index lists "expression" alongside the other file-layer kinds, description included', () => {
  const dir = project();
  const r = listUnits(dir);
  assert.equal(r.ok, true);
  const expr = r.kinds.find((k) => k.kind === 'expression');
  assert.ok(expr, 'expression missing from the kind index');
  assert.equal(expr.count, 1);
  assert.match(expr.description, /expression/i);
  // 'expression' is noisy (one per file, like component/hook/...) so it's excluded from the flat
  // low-cardinality `units` list, same as every other file-layer kind already is.
  assert.ok(!r.units.some((u) => u.kind === 'expression'));
});

test('summarizeUnit resolves an Expression by path and by feature/name, with the same sections other file-layer kinds get', () => {
  const dir = project();
  const byPath = summarizeUnit(dir, 'expression:features/cart/expressions/ShowForRole.tsx');
  assert.equal(byPath.ok, true, JSON.stringify(byPath));
  assert.equal(byPath.kind, 'expression');
  assert.equal(byPath.sections.file.layer, 'expression');
  assert.equal(byPath.sections.file.path, 'features/cart/expressions/ShowForRole.tsx');
  assert.match(byPath.sections.file.purpose, /role/);
  assert.deepEqual(byPath.sections.exports.map((e) => e.name), ['ShowForRole']);
  assert.ok('dependencies' in byPath.sections);
  assert.ok('rules' in byPath.sections);
  assert.ok('tests' in byPath.sections);
  assert.ok(byPath.health);

  const byName = summarizeUnit(dir, 'expression:cart/ShowForRole');
  assert.equal(byName.ok, true, JSON.stringify(byName));
  assert.equal(byName.sections.file.path, 'features/cart/expressions/ShowForRole.tsx');
});

test('an unqualified path resolve for a real expression file no longer says UNKNOWN_KIND', () => {
  const dir = project();
  const r = summarizeUnit(dir, 'features/cart/expressions/ShowForRole.tsx');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.kind, 'expression');
});
