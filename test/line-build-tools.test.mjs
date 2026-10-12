// bench-ecom M1: the three Line tools for building an app (packages/engine/line/build.mjs) and LINE-OWNER's route entry.
// Each tool is a pure planner (refusals are one sentence with a code, nothing written) and a plan step that lands
// through the checked writer; an app-router route entry that only re-exports a feature page belongs to that feature.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { planCreateFeature, planAddRoute, planSetCode, routeFolders } from '../packages/engine/line/build.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { LINE_PLAN_TOOLS, assertStagedChange } from '../packages/engine/line/contract.mjs';
import { entryById } from '../packages/engine/line/toolRegistry.mjs';
import { lineToolSpecs } from '../packages/engine/line/planTools.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';
import { hashOf } from '../packages/engine/pagesEditor.mjs';

const project = () => {
  const parent = fs.realpathSync(makeTempDir('line-build-'));
  const r = createLineProject(parent, { name: 'shop', firstFeature: 'home' });
  assert.equal(r.ok, true, r.sentence);
  return { root: /** @type {string} */ (r.dir), done: () => fs.rmSync(parent, { recursive: true, force: true }) };
};
const refusal = (fn, code) => assert.throws(fn, (e) => e.name === 'LineOpError' && e.code === code && /^\S.*[.?!]$/.test(e.sentence));
const write = (root, rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const rules = (root) => validateLine(root).violations.map((v) => `${v.rule} ${v.file}`);

test('the three tools are in the one registry, the plan contract and the spec, each a write plan step', () => {
  for (const name of ['line.createFeature', 'line.addRoute', 'line.setCode']) {
    assert.equal(LINE_PLAN_TOOLS.find((t) => t.name === name)?.kind, 'write', name);
    const e = entryById(name);
    assert.ok(e && e.kind === 'write' && e.writes === 'project' && e.surfaces.plan, name);
    const spec = lineToolSpecs().find((t) => t.name === name);
    assert.ok(spec && spec.args.type === 'object' && /[.]$/.test(spec.describe), name);
  }
});

test('createFeature: spec.md in the spec format; a taken name, a bad name and no points are refused', () => {
  const { root, done } = project();
  try {
    const c = planCreateFeature(root, { name: 'cart', story: 'As a shopper, I want a cart, so that I can buy.', points: ['Add a product.', 'Remove it.'] });
    assertStagedChange(c);
    assert.deepEqual(c.files.map((f) => f.path), ['features/cart/spec.md']);
    assert.equal(c.files[0].content, '# cart\n\n## As a shopper, I want a cart, so that I can buy.\n\n- Add a product.\n- Remove it.\n');
    refusal(() => planCreateFeature(root, { name: 'home', story: 'S.', points: ['P.'] }), 'NAME_TAKEN');
    refusal(() => planCreateFeature(root, { name: '../x', story: 'S.', points: ['P.'] }), 'BAD_FEATURE');
    refusal(() => planCreateFeature(root, { name: 'cart', story: 'S.', points: [] }), 'BAD_ARGS');
  } finally { done(); }
});

test('addRoute: the route entry re-exports the page and the page gets @line-route; bad routes and pages are refused', () => {
  const { root, done } = project();
  try {
    write(root, 'features/home/pages/ProductPage.tsx', "// @line-base pages/ListPage\nimport { ListPage } from '../../../library/pages/ListPage';\n\nexport function ProductPage() {\n  return <ListPage title=\"P\" first=\"a\" />;\n}\n");
    const c = planAddRoute(root, { route: '/products/:id', page: 'features/home/pages/ProductPage.tsx' });
    assert.deepEqual(c.files.map((f) => f.path), ['app/products/[id]/page.tsx', 'features/home/pages/ProductPage.tsx']);
    assert.equal(c.files[0].content, "export { ProductPage as default } from '../../../features/home/pages/ProductPage';\n");
    assert.match(String(c.files[1].content), /^\/\/ @line-base pages\/ListPage\n\/\/ @line-route \/products\/:id\n/);
    assert.equal(routeFolders('/'), '');
    refusal(() => planAddRoute(root, { route: 'products', page: 'features/home/pages/ProductPage.tsx' }), 'BAD_ROUTE');
    refusal(() => planAddRoute(root, { route: '/x', page: 'library/pages/ListPage.tsx' }), 'UNKNOWN_ITEM');
    refusal(() => planAddRoute(root, { route: '/x', page: 'features/home/pages/Missing.tsx' }), 'UNKNOWN_ITEM');
  } finally { done(); }
});

test('setCode: creates a file of a known kind, replaces one only at its hash, refuses elsewhere and unparsable code', () => {
  const { root, done } = project();
  try {
    const c = planSetCode(root, { file: 'features/home/services/cart.ts', code: 'export const n = 1;' });
    assert.deepEqual(c.files, [{ path: 'features/home/services/cart.ts', content: 'export const n = 1;\n' }]);
    const lib = 'library/components/Button.tsx';
    const src = fs.readFileSync(path.join(root, lib), 'utf8');
    refusal(() => planSetCode(root, { file: lib, code: 'export const x = 1;' }), 'STALE');
    assert.equal(planSetCode(root, { file: lib, code: 'export const x = 1;', contentHash: hashOf(src) }).files[0].path, lib);
    refusal(() => planSetCode(root, { file: lib, code: src, contentHash: hashOf(src) }), 'NO_CHANGE');
    for (const file of ['app/page.tsx', 'package.json', 'features/home/misc/a.ts', '../x.ts', 'library/Button.tsx']) refusal(() => planSetCode(root, { file, code: 'x' }), 'UNKNOWN_ITEM');
    refusal(() => planSetCode(root, { file: 'features/home/services/b.ts', code: 'export const = ;' }), 'BAD_CODE');
    refusal(() => planSetCode(root, { file: 'library/fixtures/p.json', code: '{nope' }), 'BAD_CODE');
    assert.equal(planSetCode(root, { file: 'features/home/spec.md', code: '# home\n', contentHash: hashOf(fs.readFileSync(path.join(root, 'features/home/spec.md'), 'utf8')) }).files.length, 1);
  } finally { done(); }
});

test('LINE-OWNER: a route entry that only re-exports a feature page is owned; any other app page is an orphan', () => {
  const { root, done } = project();
  try {
    write(root, 'features/home/pages/HomePage.tsx', "// @line-base pages/ListPage\nimport { ListPage } from '../../../library/pages/ListPage';\n\nexport function HomePage() {\n  return <ListPage title=\"Home\" first=\"a\" />;\n}\n");
    write(root, 'app/page.tsx', "export { HomePage as default } from '../features/home/pages/HomePage';\n");
    assert.deepEqual(rules(root), []);
    write(root, 'app/page.tsx', "import { HomePage } from '../features/home/pages/HomePage';\nexport default function Page() { return <HomePage />; }\n");
    assert.deepEqual(rules(root), ['LINE-OWNER app/page.tsx']);
    write(root, 'app/page.tsx', "export { ListPage as default } from '../library/pages/ListPage';\n");
    assert.deepEqual(rules(root), ['LINE-OWNER app/page.tsx']);
  } finally { done(); }
});

test('as plan steps: each lands through the writer, and a feature page without a base is refused with a fix', async () => {
  const { root, done } = project();
  try {
    const svc = createLinePlanService({ root, commands: null, trace: null, records: null });
    const run = async (tool, args) => {
      const a = await svc.addStep({ tool, args }, 'agent');
      assert.equal(a.ok, true, /** @type {any} */ (a).sentence);
      assert.equal((await svc.approve(/** @type {any} */ (a).stepId, 'ui')).ok, true);
      const v = await svc.runNext('agent');
      return /** @type {any} */ (v).steps.find((s) => s.id === /** @type {any} */ (a).stepId);
    };
    // Found by the bench pilot: points sent as one string got "must be a non-empty string", which it was.
    const bad = /** @type {any} */ (await svc.addStep({ tool: 'line.createFeature', args: { name: 'x', story: 'S.', points: '1. One.' } }, 'agent'));
    assert.equal(bad.code, 'BAD_ARGS');
    assert.match(bad.sentence, /points must be a JSON list of 1 to 50 non-empty strings/);
    assert.equal((await run('line.createFeature', { name: 'cart', story: 'As a shopper, I want a cart, so that I can buy.', points: ['Add a product.'] })).state, 'done');
    assert.equal((await run('line.baseOn', { libraryId: 'pages/ListPage', feature: 'cart', name: 'CartPage' })).state, 'done');
    assert.equal((await run('line.addRoute', { route: '/cart', page: 'features/cart/pages/CartPage.tsx' })).state, 'done');
    assert.equal((await run('line.setCode', { file: 'features/cart/services/cartStore.ts', code: 'export const none = 0;' })).state, 'done');
    const refused = await run('line.setCode', { file: 'features/cart/pages/Nope.tsx', code: 'export function Nope() { return <div />; }' });
    assert.equal(refused.state, 'needs-fix');
    assert.ok(!fs.existsSync(path.join(root, 'features/cart/pages/Nope.tsx')));
    assert.deepEqual(rules(root), []);
  } finally { done(); }
});
