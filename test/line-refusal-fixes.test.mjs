// bench-gaps (the e-commerce pilot's Line gaps): every refusal a builder's plan step can meet has a typed fix whose
// step lands, or is on the explicit "person decides" list with its reason (packages/engine/line/refusals.mjs). The
// scenarios run through the plan service, as plan-cli and Cockpit do: the refusal, its fix added as a step, run, landed.
import test from 'node:test';
// The type gate degrades to warnings past its budget; a loaded test machine must not turn the refusal into a warning.
process.env.LINE_TYPE_GATE_BUDGET_MS ??= '60000';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { createLinePlanService, needsYouSentence } from '../packages/engine/line/planService.mjs';
import { REFUSAL_FIXES, RULE_FIXES, BUILDER_MODULES } from '../packages/engine/line/refusals.mjs';
import { withViolationFixes } from '../packages/engine/line/fixes.mjs';
import { LINE_RULE_IDS } from '../packages/core/profiles/line/contract.mjs';
import { LINE_OFF_LAYER_RULES, validateLine } from '../packages/core/profiles/line/index.mjs';
import { catalogRules } from '../packages/core/rules-catalog.mjs';
import { parseAppLayout } from '../packages/engine/line/shell.mjs';
import { hashOf } from '../packages/engine/pagesEditor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lineDir = path.join(here, '..', 'packages', 'engine', 'line');
const project = () => {
  const parent = fs.realpathSync(makeTempDir('line-refusal-'));
  const r = createLineProject(parent, { name: 'shop', firstFeature: 'home' });
  assert.equal(r.ok, true, r.sentence);
  return { root: /** @type {string} */ (r.dir), done: () => fs.rmSync(parent, { recursive: true, force: true }) };
};
const write = (root, rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const svcOf = (root) => createLinePlanService({ root, commands: null, trace: null, records: null });
const WHY = 'A bench-gaps test step.';

/** Add a step and approve it (Auto, as plan-cli does). */
async function addApproved(svc, tool, args) {
  const r = /** @type {any} */ (await svc.addStep({ tool, args, why: WHY }, 'agent'));
  if (!r.ok) return r;
  const step = r.steps.find((s) => s.id === r.stepId);
  if (step.state === 'waiting') assert.equal((/** @type {any} */ (await svc.approve(r.stepId, 'ui'))).ok, true);
  return r;
}
/** Run the next step; returns its view. */
async function runOne(svc) {
  const r = /** @type {any} */ (await svc.runNext('agent'));
  assert.equal(r.ok, true, r.sentence);
  return r.steps.filter((s) => s.state !== 'ready' && s.state !== 'waiting').at(-1);
}
/** A refused add's first fix, added and run: it must land. */
async function fixLands(svc, refused) {
  assert.equal(refused.ok, false);
  assert.ok(Array.isArray(refused.fixes) && refused.fixes.length && refused.fixes[0].step, `${refused.code} carries a typed fix: ${refused.sentence}`);
  assert.equal(refused.fixes[0].rank, 1);
  const added = await addApproved(svc, refused.fixes[0].step.tool, refused.fixes[0].step.args);
  assert.equal(added.ok, true, added.sentence);
  const ran = await runOne(svc);
  assert.equal(ran.state, 'done', ran.sentence);
  assert.equal(ran.result.apply.ok, true, ran.sentence);
  return ran;
}

test('every refusal code a builder plan tool can throw is typed or on the person-decides list, with a reason', () => {
  const codes = new Set();
  for (const m of BUILDER_MODULES) {
    const src = fs.readFileSync(path.join(lineDir, `${m}.mjs`), 'utf8');
    for (const hit of src.matchAll(/new LineOpError\(/g)) {
      let depth = 0; let j = hit.index + 'new LineOpError'.length;
      for (; j < src.length; j += 1) { if (src[j] === '(') depth += 1; else if (src[j] === ')') { depth -= 1; if (!depth) break; } }
      for (const c of src.slice(hit.index, j).matchAll(/'([A-Z][A-Z_]{2,})'/g)) codes.add(c[1]);
    }
    for (const c of src.matchAll(/refusal\('([A-Z_]+)'/g)) codes.add(c[1]);
  }
  assert.ok(codes.size > 30, `found ${codes.size} codes`);
  for (const code of codes) {
    const e = REFUSAL_FIXES[code];
    assert.ok(e && (e.typed || e.person), `${code} is neither typed nor on the person-decides list`);
    for (const v of [e.typed, e.person].filter(Boolean)) assert.match(v, /^\S.{10,}/, `${code} says why`);
  }
});

test('every rule that can refuse a step under the Line profile is typed or person-decides; the expression rules are on with a typed fix (line-expressions)', () => {
  const layerErrors = catalogRules().filter((r) => (r.layers ?? []).some((l) => ['page', 'component', 'workflow'].includes(l)) && r.defaultSeverity === 'error').map((r) => r.id);
  for (const id of [...LINE_RULE_IDS, ...layerErrors, 'COMPONENT-005', 'COMPONENT-006', 'PAGE-008']) {
    const e = RULE_FIXES[id];
    assert.ok(e && (e.typed || e.person), `${id} is neither typed nor on the person-decides list`);
  }
  assert.deepEqual(LINE_OFF_LAYER_RULES, {});
  const { root, done } = project();
  try {
    write(root, 'library/components/List.tsx', '// @line-level atom\nexport function List({ xs }: { xs: string[] }) {\n  return <ul>{xs.map((x) => <li key={x}>{x}</li>)}</ul>;\n}\n');
    const hits = withViolationFixes(root, validateLine(root).violations.filter((v) => v.file === 'library/components/List.tsx' && v.rule === 'COMPONENT-005'));
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0].fixes?.[0].step, { tool: 'line.extractExpression', args: { file: 'library/components/List.tsx', name: 'XList' } });
    assert.match(hits[0].fixes?.[0].sentence ?? '', /new expression XList \(library\/expressions\/XList\.tsx\)/);
  } finally { done(); }
});

test('NAME_TAKEN on createFeature: the top fix uses the existing feature and lands its spec (gap 6)', async () => {
  const { root, done } = project();
  try {
    const svc = svcOf(root);
    const r = /** @type {any} */ (await svc.addStep({ tool: 'line.createFeature', args: { name: 'home', story: 'As a shopper, I want a home, so that I start.', points: ['HOME-1: it shows.'] }, why: WHY }, 'agent'));
    assert.equal(r.code, 'NAME_TAKEN');
    assert.match(r.sentence, /placeholder spec; use it/);
    assert.equal(r.fixes[0].id, 'NAME_TAKEN/use-existing');
    await fixLands(svc, r);
    assert.match(read(root, 'features/home/spec.md'), /## As a shopper, I want a home, so that I start\.\n\n- HOME-1: it shows\./);
  } finally { done(); }
});

test('UNKNOWN_ITEM on addRoute: no page yet offers line.baseOn, then the feature pages are the fixes (pilot Q4)', async () => {
  const { root, done } = project();
  try {
    const svc = svcOf(root);
    let r = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoute', args: { route: '/', page: 'home' }, why: WHY }, 'agent'));
    assert.equal(r.code, 'UNKNOWN_ITEM');
    assert.equal(r.fixes[0].step.tool, 'line.baseOn');
    await fixLands(svc, r);
    r = await svc.addStep({ tool: 'line.addRoute', args: { route: '/', page: 'ListPage' }, why: WHY }, 'agent');
    assert.deepEqual(r.fixes.map((f) => f.step.args.page), ['features/home/pages/HomePage.tsx']);
    await fixLands(svc, r);
    assert.match(read(root, 'app/page.tsx'), /features\/home\/pages\/HomePage/);
    r = await svc.addStep({ tool: 'line.addRoute', args: { route: '/x', page: 'features/home/pages/Missing.tsx' }, why: WHY }, 'agent');
    assert.ok(r.fixes.some((f) => f.step.tool === 'line.baseOn' && f.step.args.name === 'Missing'));
  } finally { done(); }
});

test('line.setCode on app/: the layout becomes line.setLayoutSlot, a route entry line.addRoute (pilot H1, gap 2)', async () => {
  const { root, done } = project();
  try {
    const svc = svcOf(root);
    write(root, 'library/components/CartLink.tsx', '// @line-level atom\nexport function CartLink() {\n  return <a href="/cart">Cart (0)</a>;\n}\n');
    const r = /** @type {any} */ (await svc.addStep({ tool: 'line.setCode', args: { file: 'app/layout.tsx', code: "import { CartLink } from '../library/components/CartLink';\nexport default function L({ children }: { children: any }) { return <html><body><CartLink />{children}</body></html>; }\n" }, why: WHY }, 'agent'));
    assert.equal(r.code, 'UNKNOWN_ITEM');
    assert.deepEqual(r.fixes[0].step, { tool: 'line.setLayoutSlot', args: { slot: 'nav', components: ['library/components/CartLink.tsx#CartLink'] } });
    await fixLands(svc, r);
    const layout = read(root, 'app/layout.tsx');
    assert.deepEqual(parseAppLayout(layout)?.slots, { nav: ['library/components/CartLink.tsx#CartLink'] });
    assert.match(layout, /<AppLayout nav=\{<><CartLink \/><\/>\}>\{children\}<\/AppLayout>/);
    assert.match(read(root, 'library/components/AppLayout.tsx'), /export function AppLayout\(\{ header, nav, footer, children \}/);
    // A second slot keeps the first; a bad slot offers each real one.
    await addApproved(svc, 'line.setLayoutSlot', { slot: 'footer', components: ['library/components/CartLink.tsx'] });
    assert.equal((await runOne(svc)).result.apply.ok, true);
    assert.deepEqual(Object.keys(parseAppLayout(read(root, 'app/layout.tsx'))?.slots ?? {}).sort(), ['footer', 'nav']);
    const bad = /** @type {any} */ (await svc.addStep({ tool: 'line.setLayoutSlot', args: { slot: 'top', components: ['library/components/CartLink.tsx'] }, why: WHY }, 'agent'));
    assert.deepEqual(bad.fixes.map((f) => f.step.args.slot), ['header', 'nav', 'footer']);
    write(root, 'features/home/pages/HomePage.tsx', "// @line-base pages/ListPage\nimport { ListPage } from '../../../library/pages/ListPage';\nexport function HomePage() { return <ListPage title=\"Home\" first=\"a\" />; }\n");
    const route = /** @type {any} */ (await svc.addStep({ tool: 'line.setCode', args: { file: 'app/cart/page.tsx', code: "export { HomePage as default } from '../../features/home/pages/HomePage';\n" }, why: WHY }, 'agent'));
    assert.deepEqual(route.fixes[0].step, { tool: 'line.addRoute', args: { route: '/cart', page: 'features/home/pages/HomePage.tsx' } });
    // A hand-written layout is the person's: Line will not rewrite it.
    write(root, 'app/layout.tsx', 'export default function L({ children }: { children: any }) { return children; }\n');
    const hand = /** @type {any} */ (await svc.addStep({ tool: 'line.setLayoutSlot', args: { slot: 'nav', components: ['library/components/CartLink.tsx'] }, why: WHY }, 'agent'));
    assert.equal(hand.code, 'NOT_LINE_LAYOUT');
    assert.ok(REFUSAL_FIXES.NOT_LINE_LAYOUT.person);
  } finally { done(); }
});

test('PAGE-003 and COMPONENT-003: the fix reaches the service through a usecase, and it lands (pilot H2/H3, gap 4)', async () => {
  const { root, done } = project();
  try {
    const svc = svcOf(root);
    write(root, 'library/services/cart.ts', 'export function cartCount(): number { return 0; }\n');
    // A feature page calling the library service directly (H2).
    await addApproved(svc, 'line.setCode', { file: 'features/home/pages/HomePage.tsx', code: "// @line-base pages/ListPage\nimport { cartCount } from '../../../library/services/cart';\nimport { ListPage } from '../../../library/pages/ListPage';\nexport function HomePage() { return <ListPage title={`Cart ${cartCount()}`} first=\"a\" />; }\n" });
    let ran = await runOne(svc);
    assert.equal(ran.state, 'needs-fix', ran.sentence);
    const opt = ran.result.options.find((o) => o.step);
    assert.equal(opt.recommended, true);
    assert.equal(opt.step.tool, 'line.amend');
    assert.equal(opt.step.args.fix.tool, 'line.useViaUsecase');
    // While it waits, the plan names the fix that exists (H4).
    await addApproved(svc, 'line.setCode', { file: 'library/services/other.ts', code: 'export const x = 1;\n' });
    const blocked = /** @type {any} */ (await svc.runNext('agent'));
    assert.equal(blocked.code, 'NEEDS_YOU');
    assert.match(blocked.sentence, /Add its fix \(send \{"fix":"f1"\}; f1 is the recommended one\)/);
    assert.doesNotMatch(blocked.text, /options\[|fixes\[/);
    await addApproved(svc, opt.step.tool, { ...opt.step.args, fixOf: ran.id });
    ran = await runOne(svc);
    assert.equal(ran.result.apply.ok, true, ran.sentence);
    assert.match(read(root, 'features/home/pages/HomePage.tsx'), /from '\.\.\/usecases\/cart'/);
    assert.match(read(root, 'features/home/usecases/cart.ts'), /export \* from '\.\.\/\.\.\/\.\.\/library\/services\/cart';/);
    // A library component reading the store (H3): a library usecase.
    const comp = "// @line-level atom\nimport { cartCount } from '../services/cart';\nexport function CartLink() { return <a href=\"/cart\">Cart ({cartCount()})</a>; }\n";
    while ((await svc.view()).steps.some((x) => x.state === 'ready')) await runOne(svc);
    const svc2 = svc;
    await addApproved(svc2, 'line.setCode', { file: 'library/components/CartLink.tsx', code: comp });
    ran = await runOne(svc2);
    assert.equal(ran.state, 'needs-fix', ran.sentence);
    assert.ok(ran.result.apply.findings.some((f) => f.rule === 'COMPONENT-003'));
    const fix = ran.result.options.find((o) => o.step);
    assert.equal(fix.step.args.fix.tool, 'line.useViaUsecase');
    await addApproved(svc2, fix.step.tool, { ...fix.step.args, fixOf: ran.id });
    assert.equal((await runOne(svc2)).result.apply.ok, true);
    assert.match(read(root, 'library/usecases/cart.ts'), /export \* from '\.\.\/services\/cart';/);
    assert.deepEqual(validateLine(root).violations.filter((v) => v.severity === 'error'), []);
  } finally { done(); }
});

test('needs-you sentence: names the typed fix only when one exists, else says plainly what the person decides (H4)', () => {
  const step = (options) => ({ id: 's3', n: 3, why: 'Change it.', result: { sentence: 'This needs you: 0 of 2 checks passed.', options } });
  assert.match(needsYouSentence(step([{ id: 'fix', step: { tool: 'line.promote', args: {} } }, { id: 'retry' }])), /Add its fix \(send \{"fix":"f1"\}; f1 is the recommended one\), try it again, or leave it as it is/);
  const none = needsYouSentence(step([{ id: 'fix', sentence: 'Pass it in as props instead.', step: null }, { id: 'leave' }]));
  assert.doesNotMatch(none, /fixOf/);
  assert.match(none, /Construct has no fix it can make for this, so the person decides: pass it in as props instead\. Then change the request and add it again, or leave it as it is with line\.leaveAsIs \{"stepId": "s3"\}\./);
});

test('TYPE_ERROR on line.setCode: an unresolved import is refused before it lands, with the library item as the fix (pilot Q6, gap 3)', async () => {
  const { root, done } = project();
  try {
    write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true, types: [] } }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    write(root, 'library/services/money.ts', 'export function dollars(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }\n');
    write(root, 'library/services/cart.ts', "import { dollars } from './money';\nexport const total = (): string => dollars(0);\n");
    const svc = svcOf(root);
    const t0 = Date.now();
    const r = /** @type {any} */ (await svc.addStep({ tool: 'line.setCode', args: { file: 'features/home/services/price.ts', code: "import { dollars } from 'library/services/money';\nexport const price = (c: number): string => dollars(c);\n" }, why: WHY }, 'agent'));
    assert.ok(Date.now() - t0 < 15000, `the type gate took ${Date.now() - t0} ms`);
    assert.equal(r.code, 'TYPE_ERROR');
    assert.match(r.sentence, /^The code does not compile, so nothing was saved: Cannot find module 'library\/services\/money'/);
    assert.match(r.detail, /TS2307/);
    assert.match(r.fixes[0].step.args.code, /from '\.\.\/\.\.\/\.\.\/library\/services\/money'/);
    await fixLands(svc, r);
    // An importer the change would break is checked too: money.ts loses dollars, cart.ts imports it.
    const src = read(root, 'library/services/money.ts');
    const broke = /** @type {any} */ (await svc.addStep({ tool: 'line.setCode', args: { file: 'library/services/money.ts', code: 'export const cents = 1;\n', contentHash: hashOf(src) }, why: WHY }, 'agent'));
    assert.equal(broke.code, 'TYPE_ERROR');
    assert.match(broke.detail, /library\/services\/(cart|price)|features\/home\/services\/price/);
    // A file with no type errors lands.
    const ok = /** @type {any} */ (await svc.addStep({ tool: 'line.setCode', args: { file: 'library/services/money.ts', code: `${src}export const zero = (): string => dollars(0);\n`, contentHash: hashOf(src) }, why: WHY }, 'agent'));
    assert.equal(ok.ok, true, ok.sentence);
    // A page a route serves may take only params and searchParams (Next.js's rule; the second pilot's next build
    // failed on a kept line.baseOn signature): refused, with "take no props" as the fix when it ignores them.
    write(root, 'features/home/pages/Home.ts', 'export function Home(): string | null { return null; }\n');
    write(root, 'app/page.ts', "export { Home as default } from '../features/home/pages/Home';\n");
    const page = read(root, 'features/home/pages/Home.ts');
    const routed = /** @type {any} */ (await svc.addStep({ tool: 'line.setCode', args: { file: 'features/home/pages/Home.ts', code: 'export function Home(_props: { title: string }): null { return null; }\n', contentHash: hashOf(page) }, why: WHY }, 'agent'));
    assert.equal(routed.code, 'TYPE_ERROR');
    assert.match(routed.sentence, /Home is served at a route \(app\/page\.ts\), so Next\.js lets it take only params and searchParams as props/);
    assert.equal(routed.fixes[0].id, 'TYPE_ERROR/route-props');
    assert.match(routed.fixes[0].step.args.code, /export function Home\(\): null/);
    await fixLands(svc, routed);
  } finally { done(); }
});

test('"Did you mean ...?": an unknown item, an unknown feature or a bad name lands through its nearest-id fix, no model (im2)', async () => {
  const { root, done } = project();
  try {
    const svc = svcOf(root);
    const refusedThenLands = async (tool, args, code, field, want) => {
      const r = /** @type {any} */ (await svc.addStep({ tool, args, why: WHY }, 'agent'));
      assert.equal(r.code, code, `${tool}: ${r.sentence}`);
      assert.equal(r.fixes[0].step.args[field], want, `${tool} suggests ${want}`);
      assert.match(r.fixes[0].sentence, /^Did you mean /);
      return fixLands(svc, r);
    };
    await refusedThenLands('line.baseOn', { libraryId: 'pages/ListPag', feature: 'home', name: 'HomePage' }, 'UNKNOWN_ITEM', 'libraryId', 'pages/ListPage');
    await refusedThenLands('line.baseOn', { libraryId: 'components/Card', feature: 'hme', name: 'HomeCard' }, 'UNKNOWN_FEATURE', 'feature', 'home');
    await refusedThenLands('line.baseOn', { libraryId: 'components/Button', feature: 'home', name: 'buy button' }, 'BAD_NAME', 'name', 'BuyButton');
    await refusedThenLands('line.promote', { featureItemId: 'home/components/HomeCrd' }, 'UNKNOWN_ITEM', 'featureItemId', 'home/components/HomeCard');
    write(root, 'features/home/components/Plain.tsx', '// @line-base components/Card\nexport function Plain() { return null; }\n');
    await refusedThenLands('line.setBase', { file: 'features/home/components/Plain.tsx', libraryId: 'components/Buton' }, 'UNKNOWN_ITEM', 'libraryId', 'components/Button');
    await refusedThenLands('line.createFeature', { name: 'Shopping Cart', story: 'As a shopper, I want a cart, so that I can buy.', points: ['CART-1: it holds products.'] }, 'BAD_FEATURE', 'name', 'shopping-cart');
    await refusedThenLands('line.setCode', { file: 'features/shoping-cart/spec.md', code: '# shopping-cart\n\n## As a shopper, I want a cart, so that I can buy.\n\n- CART-1: it holds products.\n- CART-2: it keeps them.\n' }, 'UNKNOWN_FEATURE', 'file', 'features/shopping-cart/spec.md');
    // Nothing close enough: no guess.
    const far = /** @type {any} */ (await svc.addStep({ tool: 'line.baseOn', args: { libraryId: 'pages/Zzzzzzzzzz', feature: 'home', name: 'X' }, why: WHY }, 'agent'));
    assert.equal(far.code, 'UNKNOWN_ITEM');
    assert.equal(far.fixes, undefined);
  } finally { done(); }
});

/** A project that type-checks with real React types (the repo's node_modules, linked): the route-props gate runs. */
const typedProject = () => {
  const p = project();
  write(p.root, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, jsx: 'react-jsx', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true, types: [] } }));
  fs.symlinkSync(path.join(here, '..', 'node_modules'), path.join(p.root, 'node_modules'), 'dir');
  // A library page whose props are all optional, so a bare wrapper of it compiles with none.
  write(p.root, 'library/pages/ShelfPage.tsx', 'export function ShelfPage({ title }: { title?: string }) {\n  return <main><h1>{title ?? "Shelf"}</h1></main>;\n}\n');
  return p;
};

/** The pass-through page line.baseOn wrote before #907 (a page taking its library page's props): hand-written now. */
const passThrough = (lib, name) => `// @line-base pages/${lib}\nimport type { ComponentProps } from 'react';\nimport { ${lib} } from '../../../library/pages/${lib}';\n\nexport function ${name}(props: ComponentProps<typeof ${lib}> & object) {\n  return <${lib} {...props} />;\n}\n`;

test('ROUTE_PROPS on line.addRoute: a pass-through page served at a route is refused as setCode refuses it, and its fix lands (pilot-qwen-7b-r2 R2)', async () => {
  const { root, done } = typedProject();
  try {
    const svc = svcOf(root);
    write(root, 'features/home/pages/HomePage.tsx', passThrough('ShelfPage', 'HomePage'));
    const wrapper = read(root, 'features/home/pages/HomePage.tsx');
    assert.match(wrapper, /export function HomePage\(props: ComponentProps<typeof ShelfPage> & object\)/);
    const r = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoute', args: { route: '/', page: 'features/home/pages/HomePage.tsx' }, why: WHY }, 'agent'));
    assert.equal(r.code, 'TYPE_ERROR', r.sentence);
    assert.match(r.sentence, /^The code does not compile, so nothing was saved: HomePage is served at a route \(app\/page\.tsx\), so Next\.js lets it take only params and searchParams as props, not title/);
    assert.equal(r.fixes[0].id, 'TYPE_ERROR/route-props');
    assert.equal(r.fixes[0].ref, 'f1');
    assert.match(r.fixes[0].sentence, /^Make HomePage take no props \(it only passes props on\), so its route can serve it\. Then add the route \/ again\.$/);
    assert.equal(r.fixes[0].step.tool, 'line.setCode');
    assert.equal(r.fixes[0].step.args.contentHash, hashOf(wrapper));
    assert.match(r.fixes[0].step.args.code, /export function HomePage\(\) \{\n {2}return <ShelfPage \/>;/);
    assert.doesNotMatch(r.fixes[0].step.args.code, /ComponentProps/);
    assert.equal(fs.existsSync(path.join(root, 'app/page.tsx')), false, 'nothing was written');
    await fixLands(svc, r);
    const routed = await addApproved(svc, 'line.addRoute', { route: '/', page: 'features/home/pages/HomePage.tsx' });
    assert.equal(routed.ok, true, routed.sentence);
    assert.equal((await runOne(svc)).state, 'done');
    assert.match(read(root, 'app/page.tsx'), /export \{ HomePage as default \}/);
    // A library page whose props are required: rendered bare it would not compile, so no fix is offered (the page's
    // content is the builder's to write), but the route is still refused.
    write(root, 'features/home/pages/ListView.tsx', passThrough('ListPage', 'ListView'));
    const listed = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoute', args: { route: '/list', page: 'features/home/pages/ListView.tsx' }, why: WHY }, 'agent'));
    assert.equal(listed.code, 'TYPE_ERROR');
    assert.match(listed.sentence, /ListView is served at a route \(app\/list\/page\.tsx\)/);
    assert.equal(listed.fixes, undefined);
  } finally { done(); }
});

test('ROUTE_PROPS on line.baseOn: a new page that a route entry already imports lands, since baseOn writes it taking no props (#907; pilot-qwen-7b-r2 R2)', async () => {
  const { root, done } = typedProject();
  try {
    write(root, 'app/shelf/page.tsx', "export { ShelfView as default } from '../../features/home/pages/ShelfView';\n");
    const svc = svcOf(root);
    const r = await addApproved(svc, 'line.baseOn', { libraryId: 'pages/ShelfPage', feature: 'home', name: 'ShelfView' });
    assert.equal(r.ok, true, r.sentence);
    assert.equal((await runOne(svc)).state, 'done');
    assert.match(read(root, 'features/home/pages/ShelfView.tsx'), /^\/\/ @line-base pages\/ShelfPage\n[\s\S]*export function ShelfView\(\) \{/);
  } finally { done(); }
});

test('a typed fix is added by its ref or id ({fix: "f1"}); an unknown ref is refused with the refs on offer (pilot-qwen-7b-r2 R1)', async () => {
  const { root, done } = project();
  try {
    const svc = svcOf(root);
    const none = /** @type {any} */ (await svc.addStep({ fix: 'f1', why: WHY }, 'agent'));
    assert.equal(none.code, 'UNKNOWN_FIX');
    assert.match(none.sentence, /^There is no fix f1 to add: the last step added was not refused with fixes/);
    const r = /** @type {any} */ (await svc.addStep({ tool: 'line.baseOn', args: { libraryId: 'pages/ListPag', feature: 'home', name: 'HomePage' }, why: WHY }, 'agent'));
    assert.equal(r.code, 'UNKNOWN_ITEM');
    assert.deepEqual(r.fixes.map((f) => f.ref), r.fixes.map((_f, i) => `f${i + 1}`));
    const bad = /** @type {any} */ (await svc.addStep({ fix: 'f9', tool: 'fixes[0].step' }, 'agent'));
    assert.equal(bad.code, 'UNKNOWN_FIX');
    assert.match(bad.sentence, /^There is no fix f9; the last refusal offered f1 \(Did you mean pages\/ListPage\?.*Send one of those refs, for example \{"fix": "f1"\}\.$/);
    // The offer outlives a refused pick; it is picked by its stable id too. A refusal writes nothing into the project.
    assert.equal(fs.existsSync(path.join(root, 'line/plans')), false);
    const again = /** @type {any} */ (await svc.addStep({ fix: r.fixes[0].id }, 'agent'));
    assert.equal(again.ok, true, again.sentence);
    const step = again.steps.find((s) => s.id === again.stepId);
    assert.equal(step.tool, 'line.baseOn');
    assert.deepEqual({ ...step.args, expect: undefined }, { ...r.fixes[0].step.args, expect: undefined });
    assert.equal(step.why, r.fixes[0].sentence);
    if (step.state === 'waiting') assert.equal((/** @type {any} */ (await svc.approve(again.stepId, 'ui'))).ok, true);
    const ran = await runOne(svc);
    assert.equal(ran.result.apply.ok, true, ran.sentence);
    assert.match(read(root, 'features/home/pages/HomePage.tsx'), /@line-base pages\/ListPage/);
    // A landed add clears the offer: f1 now names nothing.
    const stale = /** @type {any} */ (await svc.addStep({ fix: 'f1' }, 'agent'));
    assert.equal(stale.code, 'UNKNOWN_FIX');
  } finally { done(); }
});

test('plan-cli: a refusal lists each choice with its id and exact step, says how to send one, and calls.jsonl keeps the fixes (R1, #885 owner shape)', async () => {
  const { root, done } = project();
  const { createPlanCli } = await import('../bench/ecommerce/driver/plan-cli.mjs');
  try {
    write(root, 'features/home/pages/HomePage.tsx', 'export function HomePage() { return null; }\n');
    write(root, 'features/home/pages/AboutPage.tsx', 'export function AboutPage() { return null; }\n');
    const log = path.join(root, '..', 'calls.jsonl');
    const cli = createPlanCli({ project: root, log, builder: 'test' });
    const out = await cli.run('add', ['line.addRoute', JSON.stringify({ route: '/', page: 'home/HomePage' })], { why: WHY });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'UNKNOWN_ITEM');
    const lines = out.sentence.split('\n');
    assert.equal(lines[0], 'Refused (UNKNOWN_ITEM): "home/HomePage" is not a feature page file.');
    assert.match(lines[1], /^Rule: /);
    assert.equal(lines[2], 'Choices, recommended first:');
    for (const f of out.fixes) {
      const line = lines.find((l) => l.startsWith(`  ${f.ref}: `));
      assert.ok(line, `${f.ref} is listed: ${out.sentence}`);
      assert.ok(line.includes(`${f.step.tool} ${JSON.stringify(f.step.args)}`), `${f.ref} shows its exact step: ${line}`);
    }
    assert.match(lines[3], /^ {2}f1: line\.addRoute \{"route":"\/","page":"features\/home\/pages\/HomePage\.tsx"\}/);
    assert.equal(out.fixes[0].recommended, true);
    // #888: the first add of a tool and layer also shows its rules card, after the refusal.
    const apply = lines.indexOf('To apply one, send {"fix":"f1"}.');
    assert.ok(apply > 3, out.sentence);
    assert.equal(lines[apply + 1], 'Rules for line.addRoute (page):');
    assert.match(lines[apply + 2], /^- A route serves one feature page file, .*\. Example: /);
    assert.doesNotMatch(out.sentence, /fixes\[/);
    const call = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'call').at(-1);
    assert.deepEqual(call.result.fixes.map((f) => [f.ref, f.id, f.step, f.recommended]), out.fixes.map((f) => [f.ref, f.id, f.step, f.recommended === true]));
    // The id it sends adds the recommended step, from a fresh one-shot process too (the offer is kept by the log).
    const picked = await createPlanCli({ project: root, log, builder: 'test' }).run('add', [], { fix: 'f1' });
    assert.equal(picked.ok, true, picked.sentence);
  } finally { done(); }
});
