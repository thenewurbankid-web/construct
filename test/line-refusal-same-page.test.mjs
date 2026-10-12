// #906 (bench run data-qwen3-4b-r1, calls 34-44): a refusal points at the same page the builder asked about and offers
// the blocked step again once that page is fixed. (a) a no-fix refusal's correct call uses the request's own page,
// route and args; (b) the route-props refusal of a page whose library page needs props offers a real setCode, its
// title from the spec; (c) every offered fix is pre-checked through the same gate and the call that just failed is
// never offered; (d) a step refused because of a page is offered again (f1) once a setCode lands on that page.
import test from 'node:test';
// The type gate degrades to warnings past its budget; a loaded test machine must not turn the refusal into a warning.
process.env.LINE_TYPE_GATE_BUDGET_MS ??= '60000';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { createLinePlanService, sameStep, pageOfBlock } from '../packages/engine/line/planService.mjs';
import { REFUSAL_FIXES } from '../packages/engine/line/refusals.mjs';
import { PLAN_REFUSAL_CODES } from '../packages/engine/line/contract.mjs';
import { shapeRefusal, sameCall, badValueOf, renderReoffer, hintOf } from '../packages/engine/line/hints.mjs';
import { pageTitleOf } from '../packages/engine/line/featureText.mjs';
import { hashOf } from '../packages/engine/pagesEditor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WHY = 'A same-page refusal test step.';
const LIST = 'features/catalog/pages/ListPage.tsx';
const write = (root, rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ------------------------------------------------------------------------------------------------ (a) same page

const CODES = [...new Set([...Object.keys(REFUSAL_FIXES), ...PLAN_REFUSAL_CODES, 'NEEDS_FIX', 'PLAN_CONFLICT'])].sort();
const ROUTE_REQ = { tool: 'line.addRoute', args: { route: '/', page: LIST } };

test('(a) TYPE_ERROR on addRoute, baseOn and setCode: the correct call rewrites the request\'s own file, never another page', () => {
  const said = 'The code does not compile, so nothing was saved: ListPage is served at a route (app/page.tsx), so Next.js lets it take only params and searchParams as props, not the props it declares (features/catalog/pages/ListPage.tsx line 1).';
  const route = shapeRefusal({ code: 'TYPE_ERROR', sentence: said, ...ROUTE_REQ });
  assert.match(route.example, /^line\.setCode \{"file":"features\/catalog\/pages\/ListPage\.tsx","code":"<the whole file: ListPage takes no props, and passes the library page the props it needs>","contentHash":"<from read>"\}$/);
  assert.doesNotMatch(route.text, /\/cart|CartPage/);
  const based = shapeRefusal({ code: 'TYPE_ERROR', sentence: said, tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'catalog', name: 'ShelfPage' } });
  assert.match(based.example, /^line\.setCode \{"file":"features\/catalog\/pages\/ShelfPage\.tsx","code":"<the whole file: \/\/ @line-base pages\/ListPage, then ShelfPage, taking no props>"\}$/);
  const code = shapeRefusal({ code: 'TYPE_ERROR', sentence: said, tool: 'line.setCode', args: { file: LIST, code: 'export function ListPage() { return <X />; }', contentHash: 'abc' } });
  assert.match(code.example, /^line\.setCode \{"file":"features\/catalog\/pages\/ListPage\.tsx","code":"<the whole file, fixed where the error points>","contentHash":"abc"\}$/);
  assert.doesNotMatch(code.example, /return <X/, 'the code that failed is not echoed back as correct');
});

test('(a) every refusal code: a correct call for the refused tool keeps the request\'s own page and route (all but the bad one)', () => {
  for (const code of CODES) {
    const s = shapeRefusal({ code, sentence: 'Line could not do this.', ...ROUTE_REQ });
    if (hintOf(code)?.example || !s.example?.startsWith('line.addRoute ')) continue;
    const args = JSON.parse(s.example.slice('line.addRoute '.length));
    const bad = badValueOf(code, ROUTE_REQ)?.field;
    for (const k of ['route', 'page']) if (k !== bad) assert.equal(args[k], ROUTE_REQ.args[k], `${code}: ${s.example}`);
  }
  assert.deepEqual(sameCall('line.addRoute', { route: '/', page: LIST, why: 'x' }), { tool: 'line.addRoute', args: { route: '/', page: LIST } });
  assert.deepEqual(sameCall('line.addRoute', { route: '/', page: 'zz' }, ['page']).args, { route: '/', page: 'features/cart/pages/CartPage.tsx' });
  assert.equal(sameCall('line.nope', {}), null);
  assert.ok(hintOf('TYPE_ERROR').example);
});

test('(b) a page\'s title comes from its feature\'s spec: a quoted heading, else what the story wants, else the feature name', () => {
  const spec = '# catalog\n\n## As a shopper, I want to browse and search the products, so that I can find one to buy.\n\n- The product list page shows all products.\n';
  assert.equal(pageTitleOf(spec, 'catalog'), 'Products');
  assert.equal(pageTitleOf('## As a shopper, I want a cart I can change, so that I buy exactly what I want.\n\n1. The page at /cart has the heading "Your cart".\n', 'cart'), 'Your cart');
  assert.equal(pageTitleOf('## As a shopper, I want a cart I can change, so that I buy what I want.\n', 'cart'), 'Cart');
  assert.equal(pageTitleOf(null, 'order-history'), 'Order history');
});

test('(c, d) helpers: the same call ignores the plan\'s own fields and key order; a blocked step names the page it waits on', () => {
  assert.equal(sameStep({ tool: 'line.addRoute', args: { route: '/', page: LIST } }, { tool: 'line.addRoute', args: { page: LIST, route: '/', expect: ['x'], fixOf: 's1' } }), true);
  assert.equal(sameStep({ tool: 'line.addRoute', args: { route: '/', page: LIST } }, { tool: 'line.addRoute', args: { route: '/cart', page: LIST } }), false);
  assert.equal(pageOfBlock(ROUTE_REQ, { code: 'TYPE_ERROR' }), LIST);
  assert.equal(pageOfBlock({ tool: 'line.baseOn', args: {} }, { code: 'TYPE_ERROR', detail: 'features/x/pages/A.tsx:1 ROUTE_PROPS A is served' }), 'features/x/pages/A.tsx');
  assert.equal(pageOfBlock({ tool: 'line.setCode', args: { file: LIST } }, { code: 'TYPE_ERROR' }), null, 'a setCode is the change to the page itself');
  assert.equal(pageOfBlock(ROUTE_REQ, { code: 'UNKNOWN_ITEM' }), null);
  const text = renderReoffer([{ ref: 'f1', step: ROUTE_REQ, sentence: 'Now route / again: step 10 changed features/catalog/pages/ListPage.tsx, so it plans clean.', why: 'w', effect: 'e' }]);
  assert.deepEqual(text.split('\n'), ['Now route / again: step 10 changed features/catalog/pages/ListPage.tsx, so it plans clean.', 'Choice:', `  f1: line.addRoute {"route":"/","page":"${LIST}"}`, '      why: w', '      does: e', 'To apply it, send {"fix":"f1"}.']);
});

// ------------------------------------------------------------------------------------------------ the fixture

/** The bench's library ListPage (title required) and its catalog spec. */
const LIB_LIST = "import type { ReactNode } from 'react';\n\nexport type ListPageProps = {\n  title: string;\n  toolbar?: ReactNode;\n  children?: ReactNode;\n  empty?: ReactNode;\n};\n\nexport function ListPage({ title, toolbar, children, empty }: ListPageProps) {\n  return (\n    <main>\n      <h1>{title}</h1>\n      {toolbar ? <div>{toolbar}</div> : null}\n      {children ? <div>{children}</div> : empty}\n    </main>\n  );\n}\n";
const CATALOG_SPEC = '# catalog\n\n## As a shopper, I want to browse and search the products, so that I can find one to buy.\n\n- The product list page shows all products with their names and prices.\n- The product list page has a search input field.\n';

/**
 * The state of data-qwen3-4b-r1 before call 34: features catalog, cart and checkout, each page a line.baseOn wrapper of
 * the library ListPage (it passes its props on, and the library page needs a title), no route yet.
 */
async function benchProject() {
  const parent = fs.realpathSync(makeTempDir('line-same-page-'));
  const r = createLineProject(parent, { name: 'shop', firstFeature: 'catalog' });
  assert.equal(r.ok, true, r.sentence);
  const root = /** @type {string} */ (r.dir);
  write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, jsx: 'react-jsx', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true, types: [] } }));
  fs.symlinkSync(path.join(here, '..', 'node_modules'), path.join(root, 'node_modules'), 'dir');
  write(root, 'library/pages/ListPage.tsx', LIB_LIST);
  write(root, 'features/catalog/spec.md', CATALOG_SPEC);
  write(root, 'features/cart/spec.md', '# cart\n\n## As a shopper, I want a cart I can change, so that I buy exactly what I want.\n\n- The page at /cart has the heading "Your cart".\n');
  write(root, 'features/checkout/spec.md', '# checkout\n\n## As a shopper, I want to pay for my cart, so that my order ships.\n\n- The checkout page has a "Place order" button.\n');
  const svc = createLinePlanService({ root, commands: null, trace: null, records: null });
  for (const [feature, name] of [['catalog', 'ListPage'], ['cart', 'CartPage'], ['checkout', 'ConfirmationPage']]) {
    const added = /** @type {any} */ (await svc.addStep({ tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature, name }, why: WHY }, 'agent'));
    assert.equal(added.ok, true, added.sentence);
    if (added.steps.find((s) => s.id === added.stepId).state === 'waiting') await svc.approve(added.stepId, 'ui');
    const ran = /** @type {any} */ (await svc.runNext('agent'));
    assert.equal(ran.ok, true, ran.sentence);
  }
  assert.match(read(root, LIST), /\{\.\.\.props\}/);
  return { root, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

// ------------------------------------------------------------------------------------------------ (b, c, d) service

test('(b, c, d) plan service: route-props offers a setCode on the same page; the failing addRoute is never offered; once the setCode lands the route is offered again and lands', async () => {
  const { root, done } = await benchProject();
  try {
    const svc = createLinePlanService({ root, commands: null, trace: null, records: null });
    const wrapper = read(root, LIST);
    // (b) call 34: the route is refused, and f1 rewrites the SAME page, taking no props, the title from the spec.
    const r = /** @type {any} */ (await svc.addStep({ ...ROUTE_REQ, why: WHY }, 'agent'));
    assert.equal(r.code, 'TYPE_ERROR', r.sentence);
    assert.equal(r.fixes[0].id, 'TYPE_ERROR/route-props');
    assert.equal(r.fixes[0].step.tool, 'line.setCode');
    assert.equal(r.fixes[0].step.args.file, LIST);
    assert.equal(r.fixes[0].step.args.contentHash, hashOf(wrapper));
    assert.match(r.fixes[0].step.args.code, /export function ListPage\(\) \{\n {2}return <LibraryListPage title="Products" \/>;/);
    assert.match(r.text, /f1: line\.setCode \{"file":"features\/catalog\/pages\/ListPage\.tsx"/);
    assert.doesNotMatch(r.text, /A correct call|"route":"\/cart"/);
    // (c) call 36: the library path is refused; its nearest page's addRoute would fail the same gate, so it is not offered:
    // the page's own setCode takes its place, and no offered addRoute fails.
    const lib = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoute', args: { route: '/', page: 'library/pages/ListPage.tsx' }, why: WHY }, 'agent'));
    assert.equal(lib.code, 'UNKNOWN_ITEM');
    assert.ok(!lib.fixes.some((f) => sameStep(f.step, ROUTE_REQ)), JSON.stringify(lib.fixes.map((f) => f.step)));
    assert.equal(lib.fixes[0].step.tool, 'line.setCode');
    assert.equal(lib.fixes[0].step.args.file, LIST);
    assert.ok(lib.dropped.some((d) => d.code === 'TYPE_ERROR'), JSON.stringify(lib.dropped));
    for (const f of lib.fixes.filter((x) => x.step.tool === 'line.addRoute')) {
      const tried = /** @type {any} */ (await createLinePlanService({ root, commands: null, trace: null, records: null }).addStep({ ...f.step, why: WHY }, 'agent'));
      assert.notEqual(tried.code, 'TYPE_ERROR', `offered ${JSON.stringify(f.step)} fails: ${tried.sentence}`);
    }
    // (c) never the call that just failed: a request equal to its own fix is not offered back.
    // (d) the builder fixes the page by hand (call 41) and it lands (call 43): run-next offers the route again, as f1.
    const fixed = "// @line-base pages/ListPage\nimport { ListPage as LibraryListPage } from '../../../library/pages/ListPage';\n\nexport function ListPage() {\n  return <LibraryListPage title=\"Products\" />;\n}\n";
    const added = /** @type {any} */ (await svc.addStep({ tool: 'line.setCode', args: { file: LIST, code: fixed, contentHash: hashOf(wrapper) }, why: WHY }, 'agent'));
    assert.equal(added.ok, true, added.sentence);
    if (added.steps.find((s) => s.id === added.stepId).state === 'waiting') await svc.approve(added.stepId, 'ui');
    const ran = /** @type {any} */ (await svc.runNext('agent'));
    assert.equal(ran.ok, true, ran.sentence);
    assert.ok(ran.offer, 'run-next offers the blocked route');
    assert.deepEqual(ran.offer.fixes[0].step, ROUTE_REQ);
    assert.equal(ran.offer.fixes[0].ref, 'f1');
    assert.match(ran.offer.text, /^Now route \/ again: step \d+ changed features\/catalog\/pages\/ListPage\.tsx, so it plans clean\.\nChoice:\n {2}f1: line\.addRoute \{"route":"\/","page":"features\/catalog\/pages\/ListPage\.tsx"\}/);
    // The plan view carries it too, and a refusal of another call puts it first.
    const v = /** @type {any} */ (await svc.view());
    assert.deepEqual(v.offer.fixes[0].step, ROUTE_REQ);
    const other = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoute', args: { route: '/cart', page: 'library/pages/Nope.tsx' }, why: WHY }, 'agent'));
    assert.equal(other.ok, false);
    assert.deepEqual(other.fixes[0].step, ROUTE_REQ);
    assert.match(other.fixes[0].why, /rule blocked-step/);
    // {"fix":"f1"} adds the route, and it lands; then it is no longer offered.
    const picked = /** @type {any} */ (await svc.addStep({ fix: 'f1' }, 'agent'));
    assert.equal(picked.ok, true, picked.sentence);
    if (picked.steps.find((s) => s.id === picked.stepId).state === 'waiting') await svc.approve(picked.stepId, 'ui');
    const routed = /** @type {any} */ (await svc.runNext('agent'));
    assert.equal(routed.ok, true, routed.sentence);
    assert.match(read(root, 'app/page.tsx'), /ListPage/);
    assert.equal(routed.offer, undefined);
    assert.equal((/** @type {any} */ (await svc.view())).offer, undefined);
  } finally { done(); }
});

// ------------------------------------------------------------------------------------------------ replay 34-44

test('replay data-qwen3-4b-r1 calls 34-44 through plan-cli: every refusal stays on the catalog page, no f1 fails when sent, and the route is offered again and lands', async () => {
  const { root, done } = await benchProject();
  const { createPlanCli } = await import('../bench/ecommerce/driver/plan-cli.mjs');
  try {
    const log = path.join(root, '..', 'logs', 'calls.jsonl');
    const cli = () => createPlanCli({ project: root, log, builder: 'replay' }); // one process per call, as the bench runs it
    const add = (tool, args, why, fix) => cli().run('add', fix ? [] : [tool, JSON.stringify(args)], { why, ...(fix ? { fix } : {}) });
    /** No fix offered is the call that was just refused. */
    const notTheFailedCall = (out, req) => assert.ok(!(out.fixes ?? []).some((f) => sameStep(f.step, req)), out.sentence);

    // 34: addRoute "/" -> ListPage: refused, f1 rewrites the same page (before: "A correct call: line.addRoute {/cart ...}").
    const c34 = await add('line.addRoute', { page: LIST, route: '/' }, 'Set the root route to the catalog product list page');
    assert.equal(c34.code, 'TYPE_ERROR');
    assert.doesNotMatch(c34.sentence, /A correct call: line\.addRoute \{"route":"\/cart"/);
    assert.equal(c34.fixes[0].id, 'TYPE_ERROR/route-props');
    assert.equal(c34.fixes[0].step.args.file, LIST);
    notTheFailedCall(c34, ROUTE_REQ);
    // 35: {"fix":"f1"} (before: UNKNOWN_FIX, nothing was on offer): adds the same-page setCode, Auto approves it.
    // (The model's why had no full stop; the plan store refuses that on its own, PLAN_INVALID, so it gets one here.)
    const c35 = await add('', {}, 'Set root route to library ListPage to avoid props issues.', 'f1');
    assert.equal(c35.ok, true, c35.sentence);
    assert.equal(c35.state, 'ready');
    // 36: addRoute "/" -> the library file: refused; the addRoute that would fail is not offered (before: f1 was it).
    const c36 = await add('line.addRoute', { page: 'library/pages/ListPage.tsx', route: '/' }, "Set root route to library's ListPage to avoid props issues");
    assert.equal(c36.code, 'UNKNOWN_ITEM');
    assert.ok(!(c36.fixes ?? []).some((f) => sameStep(f.step, ROUTE_REQ)), c36.sentence);
    notTheFailedCall(c36, { tool: 'line.addRoute', args: { page: 'library/pages/ListPage.tsx', route: '/' } });
    // 43: run-next lands the setCode (call 35's fix): the blocked route is offered again as f1 (before: nothing).
    const c43 = await cli().run('run-next', []);
    assert.equal(c43.ok, true, c43.sentence);
    assert.equal(c43.landed, true, c43.sentence);
    assert.match(read(root, LIST), /<LibraryListPage title="Products" \/>/);
    assert.deepEqual(c43.fixes[0].step, ROUTE_REQ, c43.sentence);
    assert.match(c43.sentence, /Now route \/ again: step \d+ changed features\/catalog\/pages\/ListPage\.tsx, so it plans clean\./);
    assert.match(c43.sentence, /To apply it, send \{"fix":"f1"\}\./);
    // status shows it too.
    const st = await cli().run('status', []);
    assert.match(st.sentence, /Now route \/ again/);
    // The model sends f1: the route joins, lands, and app/page.tsx serves the catalog page.
    const again = await add('', {}, 'Route / again now that the page takes no props.', 'f1');
    assert.equal(again.ok, true, again.sentence);
    const landed = await cli().run('run-next', []);
    assert.equal(landed.landed, true, landed.sentence);
    assert.match(read(root, 'app/page.tsx'), /features\/catalog\/pages\/ListPage/);
    // 44: addRoute "/cart" -> CartPage (still a wrapper): refused, and f1 rewrites CartPage, its title from the cart spec.
    const c44 = await add('line.addRoute', { page: 'features/cart/pages/CartPage.tsx', route: '/cart' }, 'Set the cart route to serve the CartPage for /cart');
    assert.equal(c44.code, 'TYPE_ERROR');
    assert.equal(c44.fixes[0].step.args.file, 'features/cart/pages/CartPage.tsx');
    assert.match(c44.fixes[0].step.args.code, /title="Your cart"/);
    // calls.jsonl logs the offered fixes as before, and what the pre-check dropped.
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'call');
    const logged34 = calls.find((c) => c.args?.tool === 'line.addRoute' && c.args.args?.route === '/');
    assert.equal(logged34.result.fixes[0].id, 'TYPE_ERROR/route-props');
    assert.equal(logged34.result.fixes[0].recommended, true);
    const logged43 = calls.find((c) => c.cmd === 'run-next' && c.result.fixes);
    assert.deepEqual(logged43.result.fixes[0].step, ROUTE_REQ);
    const logged36 = calls.find((c) => c.args?.args?.page === 'library/pages/ListPage.tsx');
    assert.ok(logged36.result.dropped?.some((d) => d.code === 'TYPE_ERROR'), JSON.stringify(logged36.result));
    // Before/after text of call 34, for the record.
    if (process.env.SHOW_REPLAY) console.log(`AFTER call 34:\n${c34.sentence}\n\nAFTER call 36:\n${c36.sentence}\n\nAFTER call 43:\n${c43.sentence}`);
  } finally { done(); }
});
