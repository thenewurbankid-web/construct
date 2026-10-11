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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOP = path.join(REPO, 'examples/import-v2-shop');
const CLIENT = 'src/app/[locale]/orders/OrdersClient.tsx';
const copy = () => { const dir = makeTempDir('construct-iv2-fit-'); fs.cpSync(SHOP, dir, { recursive: true }); return dir; };

/** A logic map of the shop in the prototype's shape (docs/line/import-v2/logicmap.mjs), lines found from the code. */
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
  add('src/utils/money.ts', 'formatTotal', 'export', 'export function formatTotal');
  add('src/utils/money.ts', 'formatTotal', 'branch', 'sum > 1000 ?');
  add('src/utils/money.ts', 'label', 'export', 'export function label');
  add('src/components/OrdersView.tsx', 'OrdersView', 'export', 'export function OrdersView');
  add('src/components/OrdersView.tsx', 'OrdersView', 'render-if', '{empty &&', 'empty'); // the prototype's detail: the left side
  add('src/components/OrdersView.tsx', 'OrdersView', 'branch', '{first ?');
  add('src/components/OrdersView.tsx', 'OrdersView', 'handler', "onClick={() => onTab('open')}");
  add('src/utils/money.ts', '<module>', 'storage', "import type { Order }");
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
    'formatTotal/export -> domain:money', // 2. pure
    'formatTotal/branch -> domain:money',
    'label/export -> domain:money',
    'OrdersView/export -> component:OrdersView',
    'OrdersView/render-if -> component:OrdersView',
    'OrdersView/branch -> component:OrdersView',
    'OrdersView/handler -> component:OrdersView',
    '<module>/storage -> unassigned',
  ]);
  assert.match(p.unassigned[0].sentence, /^The storage at line 1 of money\.ts runs at the top of the module, outside any function, so no block owns it yet\.$/);
  assert.equal(p.blocks.find((b) => b.name === 'money').area, 'library', 'money.ts is used by /home too');
  assert.equal(p.blocks.find((b) => b.name === 'useOrdersQuery').area, 'feature');
  assert.match(p.blocks.find((b) => b.name === 'OrdersView').sentence, /^OrdersView is a component: it renders JSX with its render-ifs and handlers \(4 units from OrdersView\.tsx\), 2 interactive slots, showing parts on empty\.$/);
  assert.deepEqual([...sharedFiles(closure)], ['src/utils/money.ts'], 'only money.ts is imported from outside the family');
});

test('fit -> plan: the proposal becomes extract steps that all land through the writer, in the import folder', async () => {
  const app = copy();
  const closure = readRouteFamily(app, '/orders');
  const p = fitLogic(shopMap(app), closure);
  const { steps, skipped } = planFitSteps(p, { folder: closureFolder(closure), closure });
  assert.deepEqual(steps.map((s) => `${s.tool} ${s.args.from} ${s.args.name}`), [
    'line.import.extractService hooks/useOrders.ts useOrdersQuery',
    'line.import.extractDomain utils/money.ts money',
    'line.import.extractWorkflow app/[locale]/orders/OrdersClient.tsx OrdersFlow',
    'line.import.splitPage app/[locale]/orders/OrdersClient.tsx useOrdersClient',
  ]);
  assert.deepEqual(steps[1].args.names, ['formatTotal', 'label']);
  assert.ok(skipped.every((s) => /[.?!]$/.test(s.sentence)));
  const reg = createLinePlanRegistry({ root: app });
  const mark = await reg.call('line.import.mark', { folder: 'src', features: [p.feature] });
  assert.equal(mark.apply.ok, true, mark.sentence);
  for (const s of steps) {
    const r = await reg.call(s.tool, s.args);
    assert.equal(r.apply.ok, true, `${s.id} ${s.tool}: ${r.sentence}`);
    assert.equal(r.passed, r.total, `${s.id}: ${r.sentence}`);
  }
  for (const f of ['features/orders/services/useOrdersQuery.ts', 'library/domains/money.ts', 'library/workflows/OrdersFlow.ts', 'features/orders/workflows/OrdersFlow.ts', 'features/orders/usecases/useOrdersClient.tsx']) {
    assert.ok(fs.existsSync(path.join(app, 'src', f)), f);
  }
});
