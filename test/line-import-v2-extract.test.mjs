// Line Import v2's extract tools (iv2-fit, packages/engine/line/importV2/extract.mjs) on a temp copy of
// examples/import-v2-shop, each run as a plan tool of the one registry (planTools.mjs runChange -> applyChange): it lands
// through Construct's writer inside the import folder, the old file keeps working (imports back, re-exports), the code
// still compiles, and a step that cannot run is refused in one sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLinePlanRegistry, CHANGE_TOOLS, isDeferred } from '../packages/engine/line/planTools.mjs';
import { conditionsOf, CONDITION_TOOLS } from '../packages/engine/line/conditions.mjs';
import { exprProblem, LINE_PLAN_TOOLS } from '../packages/engine/line/contract.mjs';
import { entryById } from '../packages/engine/line/toolRegistry.mjs';
import { EXTRACT_TOOLS, planExtractStep, extractTarget } from '../packages/engine/line/importV2/extract.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOP = path.join(REPO, 'examples/import-v2-shop');
const CLIENT = 'app/[locale]/orders/OrdersClient.tsx';

/** A temp copy of the shop with src marked as a Line folder (Import's first step), and its registry. */
async function shop() {
  const app = makeTempDir('construct-iv2-extract-');
  fs.cpSync(SHOP, app, { recursive: true });
  const reg = createLinePlanRegistry({ root: app });
  const mark = await reg.call('line.import.mark', { folder: 'src', features: ['orders'] });
  assert.equal(mark.apply.ok, true, mark.sentence);
  const read = (rel) => fs.readFileSync(path.join(app, 'src', rel), 'utf8');
  return { app, reg, read };
}

/** Syntax errors of a TS/TSX source (none expected). */
const syntaxErrors = (rel, src) => /** @type {any} */ (ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)).parseDiagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));

/** Real type errors of the given src files (no React here, so only files without JSX or React imports). */
function typeErrors(app, rels) {
  const program = ts.createProgram(rels.map((r) => path.join(app, 'src', r)), { strict: true, noEmit: true, baseUrl: app, paths: { '@/*': ['./src/*'] }, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [] });
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

test('the extract tools are in the one registry, the plan contract and the conditions, each planned in its import folder', () => {
  for (const tool of EXTRACT_TOOLS) {
    assert.ok(entryById(tool)?.surfaces.plan, `${tool} is a plan tool of the catalog`);
    assert.ok(LINE_PLAN_TOOLS.some((t) => t.name === tool), `${tool} is in LINE_PLAN_TOOLS`);
    assert.equal(CHANGE_TOOLS[tool], 'planExtractStep');
    assert.ok(isDeferred(tool), 'planned when it runs, in the import folder');
    assert.ok(CONDITION_TOOLS.includes(tool));
    const c = conditionsOf(tool, { from: 'a/b.ts', name: 'x', feature: 'orders', names: ['f'], component: 'X' }, { features: 'features', library: 'library' });
    assert.equal(exprProblem(c.pre), null); assert.equal(exprProblem(c.post), null);
  }
  assert.equal(extractTarget({ features: 'features', library: 'library' }, 'line.import.splitPage', { from: 'a/B.tsx', name: 'useB', feature: 'orders' }), 'features/orders/usecases/useB.tsx');
  assert.equal(extractTarget(undefined, 'line.import.extractDomain', { from: 'a/b.ts', name: 'money' }), 'library/domains/money.ts');
});

test('extractDomain: pure functions move into a domain with the helpers only they use; the old file imports back and re-exports; it compiles', async () => {
  const { app, reg, read } = await shop();
  const r = await reg.call('line.import.extractDomain', { folder: 'src', from: 'utils/money.ts', names: ['formatTotal'], name: 'money' });
  assert.equal(r.apply.ok, true, r.sentence);
  assert.equal(r.passed, r.total, 'its checks (validate, the planned files with the post) pass');
  assert.deepEqual(r.apply.files.sort(), ['src/library/domains/money.ts', 'src/utils/money.ts']);
  const moved = read('library/domains/money.ts');
  assert.match(moved, /export function formatTotal/);
  assert.match(moved, /function round/, 'the helper only it uses moves with it');
  assert.match(moved, /export const CURRENCY/, 'a value it uses moves too, so the new file never imports the old one');
  assert.match(moved, /import type \{ Order \} from '@\/types\/order';/);
  const old = read('utils/money.ts');
  assert.match(old, /import \{ CURRENCY \} from '\.\.\/library\/domains\/money';/, 'what the old file still uses is imported back');
  assert.match(old, /export \{ CURRENCY, formatTotal \} from '\.\.\/library\/domains\/money';/, 'what it exported is re-exported');
  assert.match(old, /export function label/);
  assert.doesNotMatch(old, /function round/);
  assert.deepEqual(typeErrors(app, ['utils/money.ts', 'library/domains/money.ts', 'app/[locale]/home/page.tsx'].slice(0, 2)), []);
});

test('extractService and extractUsecase: data hooks into a feature service, orchestration into a usecase, through the writer', async () => {
  const { reg, read } = await shop();
  const s = await reg.call('line.import.extractService', { folder: 'src', from: 'hooks/useOrders.ts', names: ['useOrdersQuery'], name: 'ordersApi', feature: 'orders' });
  assert.equal(s.apply.ok, true, s.sentence);
  assert.match(read('features/orders/services/ordersApi.ts'), /export function useOrdersQuery[\s\S]*fetch\(/);
  assert.match(read('features/orders/services/ordersApi.ts'), /^import \{ useEffect, useState \} from 'react';$/m);
  assert.match(read('hooks/useOrders.ts'), /export \{ useOrdersQuery \} from '\.\.\/features\/orders\/services\/ordersApi';/);
  const u = await reg.call('line.import.extractUsecase', { folder: 'src', from: CLIENT, names: ['buildOrdersUrl'], name: 'ordersUrl', feature: 'orders' });
  assert.equal(u.apply.ok, true, u.sentence);
  assert.match(read('features/orders/usecases/ordersUrl.tsx'), /export function buildOrdersUrl/);
  assert.match(read(CLIENT), /import \{ buildOrdersUrl \} from '\.\.\/\.\.\/\.\.\/features\/orders\/usecases\/ordersUrl';/);
  for (const f of ['features/orders/services/ordersApi.ts', 'hooks/useOrders.ts', 'features/orders/usecases/ordersUrl.tsx', CLIENT]) assert.deepEqual(syntaxErrors(f, read(f)), [], f);
});

test('splitPage: the logic before the JSX becomes a use<Name> hook (a usecase); the component keeps what it renders', async () => {
  const { reg, read } = await shop();
  const r = await reg.call('line.import.splitPage', { folder: 'src', from: CLIENT, component: 'OrdersClient', name: 'useOrdersClient', feature: 'orders' });
  assert.equal(r.apply.ok, true, r.sentence);
  const hook = read('features/orders/usecases/useOrdersClient.tsx');
  assert.match(hook, /export function useOrdersClient\(\) \{/);
  assert.match(hook, /useRouter\(\)[\s\S]*useOrdersQuery\(tab\)/);
  assert.match(hook, /return \{ data, total, changeTab, open \};/);
  assert.match(hook, /const TABS = /, 'a module value only the logic uses moves with it');
  const comp = read(CLIENT);
  assert.match(comp, /const \{ data, total, changeTab, open \} = useOrdersClient\(\);\n {2}if \(!data\)/);
  assert.doesNotMatch(comp, /useRouter|useState|TABS/, 'what only the logic used is gone from the component');
  assert.match(comp, /^'use client';/);
  // Typed props: `({...}: OrdersViewProps)` becomes `(props: OrdersViewProps)`, destructured on each side.
  const v = await reg.call('line.import.splitPage', { folder: 'src', from: 'components/OrdersView.tsx', component: 'OrdersView', name: 'useOrdersView', feature: 'orders' });
  assert.equal(v.apply.ok, true, v.sentence);
  const vh = read('features/orders/usecases/useOrdersView.tsx');
  assert.match(vh, /import type \{ OrdersViewProps \} from '\.\.\/\.\.\/\.\.\/components\/OrdersView';/);
  assert.match(vh, /export function useOrdersView\(props: OrdersViewProps\) \{\n {2}const \{ orders \} = props;/);
  const vc = read('components/OrdersView.tsx');
  assert.match(vc, /export interface OrdersViewProps/, 'the props type both sides use stays and is exported');
  assert.match(vc, /export function OrdersView\(props: OrdersViewProps\) \{\n {2}const \{ orders, total, onOpen, onTab \} = props;\n {2}const \{ first, empty \} = useOrdersView\(props\);/);
  for (const f of ['features/orders/usecases/useOrdersClient.tsx', CLIENT, 'features/orders/usecases/useOrdersView.tsx', 'components/OrdersView.tsx']) assert.deepEqual(syntaxErrors(f, read(f)), [], f);
});

test('extractWorkflow: the URL state and navigation become an xstate workflow in the library, with the feature workflow based on it', async () => {
  const { reg, read } = await shop();
  const r = await reg.call('line.import.extractWorkflow', { folder: 'src', from: CLIENT, component: 'OrdersClient', name: 'OrdersFlow', feature: 'orders' });
  assert.equal(r.apply.ok, true, r.sentence);
  const lib = read('library/workflows/OrdersFlow.ts');
  assert.match(lib, /import \{ setup \} from 'xstate';/);
  assert.match(lib, /initial: 'orders'/);
  assert.match(lib, /OPEN_DETAIL: "detail"|OPEN_DETAIL: 'detail'/);
  assert.match(lib, /tab: string \| null/);
  assert.equal(read('features/orders/workflows/OrdersFlow.ts'), "// @line-base workflows/OrdersFlow\nexport * from '../../../library/workflows/OrdersFlow';\n");
  assert.deepEqual(syntaxErrors('OrdersFlow.ts', lib), []);
});

test('each extract tool refuses in one sentence, and a refused step writes nothing', async () => {
  const { app, reg, read } = await shop();
  const before = read('utils/money.ts');
  const one = (s) => assert.match(s, /^[^\n]+[.?!]$/, s);
  const cases = [
    ['line.import.extractDomain', { folder: 'src', from: 'utils/money.ts', names: ['nope'], name: 'money' }, /there is no top-level nope in money\.ts, so it cannot be moved; name one of its functions\./],
    ['line.import.extractService', { folder: 'src', from: 'utils/missing.ts', names: ['x'], name: 'api' }, /there is no file utils\/missing\.ts in the import folder\./],
    ['line.import.extractUsecase', { folder: 'src', from: CLIENT, names: ['OrdersClient'], name: 'x' }, /the default export of OrdersClient\.tsx is OrdersClient; move the whole file with line\.moveFile instead\./],
    ['line.import.splitPage', { folder: 'src', from: 'components/OrdersView.tsx', component: 'OrdersView', name: 'ordersView' }, /a hook's name starts with "use"/],
    ['line.import.splitPage', { folder: 'src', from: 'app/[locale]/orders/page.tsx', component: 'OrdersPage', name: 'useOrdersPage' }, /the component OrdersPage has no logic before its JSX, so there is nothing to move into a hook\./],
  ];
  for (const [tool, args, re] of cases) {
    const r = await reg.call(tool, args);
    assert.equal(r.apply.ok, false, tool);
    assert.match(r.apply.sentence, re);
    one(r.apply.sentence);
  }
  // Untyped props cannot move into a typed hook.
  fs.writeFileSync(path.join(app, 'src/components/Loose.tsx'), 'export function Loose({ a }) {\n  const b = a + 1;\n  return <p>{b}</p>;\n}\n');
  assert.throws(() => planExtractStep(path.join(app, 'src'), { tool: 'line.import.splitPage', args: { from: 'components/Loose.tsx', component: 'Loose', name: 'useLoose' } }), (e) => e.code === 'NO_PROPS_TYPE' && /^The props of Loose have no type, so its logic cannot move into a typed hook; give them a type first\.$/.test(e.sentence));
  // A workflow needs xstate in the app.
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"shop","dependencies":{"react":"19"}}\n');
  const w = await reg.call('line.import.extractWorkflow', { folder: 'src', from: CLIENT, component: 'OrdersClient', name: 'OrdersFlow', feature: 'orders' });
  assert.match(w.apply.sentence, /the app does not depend on xstate, so a Line workflow would not compile in it; add xstate to its package\.json first/);
  // The pre: the new file must not exist yet.
  fs.mkdirSync(path.join(app, 'src/library/domains'), { recursive: true });
  fs.writeFileSync(path.join(app, 'src/library/domains/money.ts'), 'export const taken = 1;\n');
  const p = await reg.call('line.import.extractDomain', { folder: 'src', from: 'utils/money.ts', names: ['formatTotal'], name: 'money' });
  assert.equal(p.apply.ok, false);
  assert.match(p.apply.sentence, /^Nothing was saved: this step cannot run as the project stands: library\/domains\/money\.ts already exists\.$/);
  assert.equal(read('utils/money.ts'), before, 'nothing written by any refused step');
});

test('moved code is copied literally: `$\'`, `$&` and `$`` in strings survive (found on the opportunity copy)', async () => {
  const { app, read } = await shop();
  const fn = "function price(n: number): string {\n  return `$${n}` + '$&' + \"$'\" + '$`';\n}";
  fs.writeFileSync(path.join(app, 'src/utils/price.ts'), `${fn}\n\nexport function total(n: number): string {\n  return price(n);\n}\n`);
  const change = planExtractStep(path.join(app, 'src'), { tool: 'line.import.extractDomain', args: { from: 'utils/price.ts', names: ['price', 'total'], name: 'price' } });
  const moved = change.files.find((f) => f.path === 'library/domains/price.ts').content;
  assert.ok(moved.includes(`export ${fn}`), moved);
  assert.equal(read('utils/price.ts').includes(fn), true, 'planning writes nothing');
});
