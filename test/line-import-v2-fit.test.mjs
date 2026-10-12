// Line Import v2's fit (iv2-fit, packages/engine/line/importV2/fit.mjs) on a temp copy of examples/import-v2-shop:
// every unit of a logic map goes to exactly one block by the fitting rules (CONTRACT.md "Fit"), the rest is listed
// with a sentence, and the proposal's plan steps all land through the writer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { readRouteFamily } from '../packages/engine/line/importV2/route.mjs';
import { fitLogic, planFitSteps, sharedFiles, closureFolder } from '../packages/engine/line/importV2/fit.mjs';
import { assertFitProposal } from '../packages/engine/line/importV2/contract.mjs';
import { createLinePlanRegistry } from '../packages/engine/line/planTools.mjs';
import { fitPlanSteps } from '../packages/engine/line/importLoop.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOP = path.join(REPO, 'examples/import-v2-shop');
const CLIENT = 'src/app/[locale]/orders/OrdersClient.tsx';
const copy = () => { const dir = makeTempDir('construct-iv2-fit-'); fs.cpSync(SHOP, dir, { recursive: true }); return dir; };

/** A logic map of the shop's /orders feature files (money.ts is shared with /home, so it is never mapped) in the prototype's shape (docs/line/import-v2/logicmap.mjs), lines found from the code. */
function shopMap(app) {
  const units = [];
  const add = (file, fn, kind, needle, detail = needle) => {
    const lines = fs.readFileSync(path.join(app, file), 'utf8').split('\n');
    const line = lines.findIndex((l) => l.includes(needle)) + 1;
    assert.ok(line > 0, `${needle} in ${file}`);
    units.push({ id: `${file}#${fn}:${kind}:${units.length + 1}`, file, fn, kind, line, detail });
  };
  add(CLIENT, 'buildOrdersUrl', 'branch', "if (tab !== 'all')");
  add(CLIENT, 'buildOrdersUrl', 'navigation', "params.set('tab', tab)");
  add(CLIENT, 'OrdersClient', 'state', 'useState(');
  add(CLIENT, 'OrdersClient', 'url-read', "searchParams.get('tab')");
  add(CLIENT, 'OrdersClient', 'data', 'useOrdersQuery(tab)');
  add(CLIENT, 'changeTab', 'navigation', 'router.replace(');
  add(CLIENT, 'open', 'navigation', 'router.push(');
  add(CLIENT, 'OrdersClient', 'branch', 'if (!data)');
  add(CLIENT, 'OrdersClient', 'export', 'export default function OrdersClient');
  add('src/app/[locale]/orders/page.tsx', 'OrdersPage', 'export', 'export default function OrdersPage');
  add('src/app/[locale]/orders/detail/page.tsx', 'OrderDetailPage', 'export', 'export default function OrderDetailPage');
  add('src/hooks/useOrders.ts', 'useOrdersQuery', 'export', 'export function useOrdersQuery');
  add('src/hooks/useOrders.ts', 'useOrdersQuery', 'state', 'useState<');
  add('src/hooks/useOrders.ts', 'useOrdersQuery', 'effect', 'useEffect(');
  add('src/hooks/useOrders.ts', 'useOrdersQuery', 'io', 'fetch(');
  add('src/components/OrdersView.tsx', 'OrdersView', 'export', 'export function OrdersView');
  add('src/components/OrdersView.tsx', 'OrdersView', 'render-if', '{empty &&', 'empty'); // the prototype's detail: the left side
  add('src/components/OrdersView.tsx', 'OrdersView', 'branch', '{first ?');
  add('src/components/OrdersView.tsx', 'OrdersView', 'handler', "onClick={() => onTab('open')}");
  add('src/hooks/useOrders.ts', '<module>', 'storage', "import { useEffect");
  return { units };
}

const blockOf = (p, id) => p.blocks.find((b) => b.units.includes(id));

test('fit: every unit goes to exactly one block by the fitting rules, and the one no rule claims is listed with a sentence', () => {
  const app = copy();
  const closure = readRouteFamily(app, '/orders');
  const map = shopMap(app);
  const p = fitLogic(map, closure);
  assertFitProposal(p, map.units.map((u) => u.id));
  assert.equal(p.feature, 'orders');
  const where = (i) => { const b = blockOf(p, map.units[i].id); return b ? `${b.kind}:${b.name}` : 'unassigned'; };
  assert.deepEqual(map.units.map((u, i) => `${u.fn}/${u.kind} -> ${where(i)}`), [
    'buildOrdersUrl/branch -> workflow:OrdersFlow', // 4. URL state
    'buildOrdersUrl/navigation -> workflow:OrdersFlow',
    'OrdersClient/state -> workflow:OrdersFlow', // a component that reads the URL keeps its state in the flow
    'OrdersClient/url-read -> workflow:OrdersFlow',
    'OrdersClient/data -> usecase:useOrdersClient', // 3. the component's logic
    'changeTab/navigation -> workflow:OrdersFlow', // navigation between views, no user-goal effects
    'open/navigation -> workflow:OrdersFlow',
    'OrdersClient/branch -> component:OrdersClient', // 5. its JSX part
    'OrdersClient/export -> component:OrdersClient',
    'OrdersPage/export -> page:OrdersPage',
    'OrderDetailPage/export -> page:OrderDetailPage',
    'useOrdersQuery/export -> service:useOrdersQuery', // 1. a data hook
    'useOrdersQuery/state -> service:useOrdersQuery',
    'useOrdersQuery/effect -> service:useOrdersQuery',
    'useOrdersQuery/io -> service:useOrdersQuery',
    'OrdersView/export -> component:OrdersView',
    'OrdersView/render-if -> component:OrdersView',
    'OrdersView/branch -> component:OrdersView',
    'OrdersView/handler -> component:OrdersView',
    '<module>/storage -> unassigned',
  ]);
  assert.match(p.unassigned[0].sentence, /^The storage at line 1 of useOrders\.ts runs at the top of the module, outside any function, so no block owns it yet\.$/);
  assert.ok(!p.blocks.some((b) => b.name === 'money'), 'money.ts is shared with /home: referenced, never fitted');
  assert.equal(p.blocks.find((b) => b.name === 'useOrdersQuery').area, 'feature');
  assert.match(p.blocks.find((b) => b.name === 'OrdersView').sentence, /^OrdersView is a component: it renders JSX with its render-ifs and handlers \(4 units from OrdersView\.tsx\), 2 interactive slots, showing parts on empty\.$/);
  assert.deepEqual(closure.shared, ['src/types/order.ts', 'src/utils/money.ts']);
  assert.deepEqual([...sharedFiles(closure)], [], 'no feature file is imported from outside the family');
});

// Rule 2 (pure -> domain) on a feature that owns money.ts: /home and /orders as ONE feature, so money.ts is the
// feature's (no other route reaches it) and is fitted, not referenced as shared.
test('fit: pure transforms of a file only the feature uses become a domain (two routes, one feature)', () => {
  const app = copy();
  const closure = readRouteFamily(app, ['/home', '/orders'], { feature: 'shop' });
  assert.ok(closure.files.includes('src/utils/money.ts') && !closure.shared.includes('src/utils/money.ts'));
  const units = [];
  const add = (fn, kind, needle) => {
    const line = fs.readFileSync(path.join(app, 'src/utils/money.ts'), 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;
    assert.ok(line > 0, needle);
    units.push({ id: `src/utils/money.ts#${fn}:${kind}:${units.length + 1}`, file: 'src/utils/money.ts', fn, kind, line, detail: needle });
  };
  add('formatTotal', 'export', 'export function formatTotal');
  add('formatTotal', 'branch', 'sum > 1000 ?');
  add('label', 'export', 'export function label');
  const p = fitLogic({ units }, closure);
  assertFitProposal(p, units.map((u) => u.id));
  assert.equal(p.feature, 'shop');
  assert.deepEqual(units.map((u) => { const b = blockOf(p, u.id); return b ? `${b.kind}:${b.name}` : 'unassigned'; }), ['domain:money', 'domain:money', 'domain:money']);
  const { steps } = planFitSteps(p, { folder: closureFolder(closure), closure });
  assert.deepEqual(steps.map((s) => `${s.tool} ${s.args.from} ${s.args.name}`), ['line.import.extractDomain utils/money.ts money']);
  assert.deepEqual(steps[0].args.names, ['formatTotal', 'label']);
});

test('fit -> plan: the proposal becomes extract steps that all land through the writer, in the import folder', async () => {
  const app = copy();
  const closure = readRouteFamily(app, '/orders');
  const p = fitLogic(shopMap(app), closure);
  const { steps, skipped } = planFitSteps(p, { folder: closureFolder(closure), closure });
  assert.deepEqual(steps.map((s) => `${s.tool} ${s.args.from} ${s.args.name}`), [
    'line.import.extractService hooks/useOrders.ts useOrdersQuery',
    'line.import.extractWorkflow app/[locale]/orders/OrdersClient.tsx OrdersFlow',
    'line.import.splitPage app/[locale]/orders/OrdersClient.tsx useOrdersClient',
  ]);
  assert.ok(!steps.some((st) => st.args.from === 'utils/money.ts'), 'the shared money.ts is never moved');
  assert.ok(skipped.every((s) => /[.?!]$/.test(s.sentence)));
  const reg = createLinePlanRegistry({ root: app });
  const mark = await reg.call('line.import.mark', { folder: 'src', features: [p.feature] });
  assert.equal(mark.apply.ok, true, mark.sentence);
  for (const s of steps) {
    const r = await reg.call(s.tool, s.args);
    assert.equal(r.apply.ok, true, `${s.id} ${s.tool}: ${r.sentence}`);
    assert.equal(r.passed, r.total, `${s.id}: ${r.sentence}`);
  }
  assert.ok(fs.existsSync(path.join(app, 'src/utils/money.ts')), 'money.ts stays where it is');
  for (const f of ['features/orders/services/useOrdersQuery.ts', 'library/workflows/OrdersFlow.ts', 'features/orders/workflows/OrdersFlow.ts', 'features/orders/usecases/useOrdersClient.tsx']) {
    assert.ok(fs.existsSync(path.join(app, 'src', f)), f);
  }
});

test('(follow-up c) fit steps follow Import\'s moves: a block Import already landed whole in its logic kind is dropped, others are re-pointed', () => {
  const fit = { steps: [
    { tool: 'line.import.extractService', args: { folder: 'src', from: 'adapters/ordersAdapter.ts', name: 'ordersAdapter', feature: 'orders' }, sentence: 'Moves ordersAdapter of feature orders into a service.', blocks: ['service:ordersAdapter'] },
    { tool: 'line.import.extractDomain', args: { folder: 'src', from: 'utils/money.ts', name: 'money', names: ['formatTotal'], feature: 'orders' }, sentence: 'Moves formatTotal of money.ts into a domain of feature orders.', blocks: ['domain:money'] },
    { tool: 'line.import.extractUsecase', args: { folder: 'src', from: 'lib/flow.ts', name: 'useFlow', feature: 'orders' }, sentence: 'Moves the flow of flow.ts into a usecase.', blocks: ['usecase:useFlow'] },
  ] };
  const planSteps = [
    { tool: 'line.import.toFeature', args: { mode: 'move', from: 'adapters/ordersAdapter.ts', kind: 'services', name: 'ordersAdapter', feature: 'orders' } },
    { tool: 'line.import.toLibrary', args: { from: 'utils/money.ts', kind: 'domains', name: 'money' } },
    { tool: 'line.import.toFeature', args: { mode: 'move', from: 'lib/flow.ts', kind: 'workflows', name: 'flow', feature: 'orders', base: 'components/X' } },
  ];
  const out = fitPlanSteps(fit, planSteps);
  assert.deepEqual(out.map((s) => `${s.tool} ${s.args.from}`), ['line.import.extractUsecase lib/flow.ts'], 'the service and the domain already landed whole; a based move is not followed');
  const moved = fitPlanSteps({ steps: [{ ...fit.steps[1], tool: 'line.import.extractUsecase' }] }, planSteps);
  assert.deepEqual(moved.map((s) => s.args.from), ['library/domains/money.ts'], 'a block of another kind follows the file to where Import moved it');
});
