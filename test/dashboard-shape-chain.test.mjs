// #627 -- the whole Requirement chain for the DASHBOARD shape, run for real: the sentence "A manager wants an overview of orders with totals"
// goes through parseRequirement, placeCard (a read worded as an overview of one data object is offered dashboard | scaffold; the rules provider
// suggests dashboard), planFromBlocks, and the plan's own commands (planToCommand, run through the CLI) in a fresh `construct init` project with
// the typed-contracts phase 1 rules ON. Then: `construct validate` reports no error and no warning, `tsc --noEmit` passes, the proof RUNS green
// (`construct test proof`: every tile and every panel shown, the states, the controller, the service), and a deliberately broken tile makes it
// FAIL with a message that names the tile. A second run in a fresh project writes the same bytes. Same guard as test/list-shape-chain.test.mjs:
// a lane without react-dom skips with the reason. The data source is `endpoint` here (the first test), `local` and `openapi` follow.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { proofStatus } from '../packages/core/proof.mjs';
import { planTouches } from '../packages/core/plan.mjs';
import { NEEDS_RUNTIME, execute, featureFiles, initProject, planFor, projectFiles, run, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const SENTENCE = 'A manager wants an overview of orders with totals';
const FEATURE = 'features/orders-dashboard';
const FIELDS = 'id:string,total:number';
const plan = (dir, source = 'endpoint') => planFor(dir, SENTENCE, 'orders-dashboard', 'dashboard', source);
const TITLES = ['Create feature orders-dashboard', 'Create domain OrdersDashboard', 'Create service OrdersDashboard', 'Create hook OrdersDashboard', 'Create component OrdersDashboard', 'Create page OrdersDashboard', 'Create controller OrdersDashboard', 'Add @line/construct-core to package.json', "Export the orders-dashboard feature's public API (sync)", 'Wire the OrdersDashboard screen into the route entry (/orders-dashboard)', 'Type-check the project', 'Prove the OrdersDashboard screen', 'Run the proof of OrdersDashboard'];

test('the sentence becomes a plan of 13 steps, runs, and gives an overview that validates, type-checks, renders and is PROVEN', NEEDS_RUNTIME, async (t) => {
  const dir = initProject('react-spa', 'dashboard');
  const { placed, planned, offer } = await plan(dir);
  assert.deepEqual(offer.options.map((o) => o.id), ['dashboard', 'scaffold'], 'a read worded as an overview is offered dashboard | scaffold');
  assert.deepEqual([offer.shape, offer.default, offer.unit, offer.entity, offer.fields], ['dashboard', 'dashboard', 'OrdersDashboard', 'Order', FIELDS]);
  assert.deepEqual(placed.decisions, [{ question: 'q-shape', option: 'dashboard', by: 'decision-model', provider: 'rules' }], 'who decided is recorded');
  assert.deepEqual(planned.plan.steps.map((s) => s.title), TITLES);
  assert.deepEqual(planned.plan.steps.slice(1, 7).map((s) => [s.args.shape, s.args.entity, s.args.fields]), Array(6).fill(['dashboard', 'Order', FIELDS]), 'every unit carries the shape');
  assert.deepEqual(planned.wiring, { dependency: 's8', sync: 's9', routes: [{ name: 'OrdersDashboard', route: '/orders-dashboard', step: 's10', file: 'src/App.tsx' }] }, 'the wiring step applies to a dashboard plan too');
  assert.deepEqual(planned.proof.steps, [{ name: 'OrdersDashboard', kind: 'render', proofStep: 's12', verifiedBy: 's13' }]);

  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const written = featureFiles(dir);
  const declared = planTouches(planned.plan).files.map((f) => f.path).sort();
  const after = projectFiles(dir);
  assert.deepEqual(Object.keys(after).filter((f) => after[f] !== before[f]).sort(), declared, 'every file the commands created or changed is a file the plan declared: nothing was done by hand');
  assert.equal(declared.length, 20, 'index.ts, the fourteen files of the shape (types.ts among them), the proof, architecture.yml, package.json, .dependency-cruiser.cjs and src/App.tsx');

  await t.test('the files it wrote', () => {
    const files = Object.keys(written).filter((f) => f.startsWith(`${FEATURE}/`)).map((f) => f.slice(FEATURE.length + 1));
    assert.deepEqual(files.filter((f) => f !== 'index.ts').sort(), ['components/OrdersDashboardLine.component.tsx', 'components/OrdersDashboardNotice.component.tsx', 'components/OrdersDashboardPanel.component.tsx', 'components/OrdersDashboardTile.component.tsx', 'components/OrdersDashboardTiles.component.tsx', 'controllers/OrdersDashboardController.controller.tsx', 'domain/OrdersDashboard.domain.ts', 'expressions/OrdersDashboardByStatus.expression.tsx', 'expressions/OrdersDashboardPanelList.expression.tsx', 'expressions/OrdersDashboardTileRow.expression.tsx', 'hooks/useOrdersDashboard.state.ts', 'pages/OrdersDashboardPage.page.tsx', 'services/OrdersDashboard.service.ts', 'tests/generated/OrdersDashboardScreen.proof.test.ts', 'types.ts']);
    assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
    const at = (f) => written[`${FEATURE}/${f}`];
    assert.match(at('domain/OrdersDashboard.domain.ts'), /defineDomain<\{ summary: OrderSummary \}, OrdersDashboardView>\('describeOrdersDashboard'/);
    assert.match(at('domain/OrdersDashboard.domain.ts'), /\{ key: 'total', label: 'Sum of total', value: show\(summary\.total\.sum\) \}/);
    assert.match(at('services/OrdersDashboard.service.ts'), /defineService\('fetchOrdersDashboard', async \(\{ signal \}/);
    assert.match(at('services/OrdersDashboard.service.ts'), /fetch\('\/api\/orders\/summary', \{ signal \}\)/);
    assert.match(at('hooks/useOrdersDashboard.state.ts'), /useTrackedState<OrdersDashboardState>/);
    assert.match(at('pages/OrdersDashboardPage.page.tsx'), /definePage</);
    assert.doesNotMatch(at('pages/OrdersDashboardPage.page.tsx'), /services\/|fetch\(/, 'the page only composes props');
    assert.match(at('expressions/OrdersDashboardByStatus.expression.tsx'), /defineExpression</);
    assert.match(at('controllers/OrdersDashboardController.controller.tsx'), /defineController</);
    assert.match(at('types.ts'), /export interface OrderSummary \{\n {2}count: number;\n {2}total: \{ sum: number; average: number; max: number \};\n\}/, 'the typed summary');
  });

  await t.test('the route entry and the barrel were wired by the plan', () => {
    assert.match(fs.readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8'), /<Route path="\/orders-dashboard" element=\{<OrdersDashboardController \/>\} \/>/);
    assert.match(fs.readFileSync(path.join(dir, 'features', 'orders-dashboard', 'index.ts'), 'utf8'), /OrdersDashboardController/);
  });

  await t.test('construct validate: no error and no warning, with the phase 1 rules on', () => {
    const report = validateJson(dir);
    assert.deepEqual(report.violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
    assert.equal(report.status, 'passed');
  });

  await t.test('tsc --noEmit passes on the features (the proof included) and the route entry', () => {
    const tsc = typeCheck(dir, ['src/App.tsx']);
    assert.equal(tsc.status, 0, tsc.output);
  });

  const proofRun = (name) => run(['test', 'proof', 'orders-dashboard', '--format', 'json', ...(name ? ['--name', name] : [])], dir);

  await t.test('the proof passes: node --test on the generated screen, no browser, and the chain is complete', () => {
    const res = proofRun();
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const result = JSON.parse(res.stdout);
    assert.deepEqual(result.counts, { total: 10, passed: 10, failed: 0, notRun: 0 });
    assert.deepEqual(result.tests.map((x) => x.title.replace(/^OrdersDashboard /, '')), ['screen: the loading state', 'screen: the error state, with role alert', 'screen: the ready state, with every tile and every panel', 'domain: the tiles and panels of a summary, in order', 'controller: renders the loading state first', 'service: a good answer is the summary', 'service: a 500 is an error result', 'service: a wrong shape is an error result', 'service: a network failure is an error result', "service: the caller's AbortSignal reaches fetch"]);
    assert.deepEqual(result.chain, proofStatus([{ id: 'proof', result: { ok: true, counts: result.counts } }]));
    assert.equal(result.chain.complete, true);
  });

  await t.test('the proof file: locked, named Name.layer.ext, from the entity fields, and a person can read it', () => {
    const file = path.join(dir, 'features', 'orders-dashboard', 'tests', 'generated', 'OrdersDashboardScreen.proof.test.ts');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
    for (const want of ['const SUMMARY: OrderSummary = { count: 2, total: { sum: 19.5, average: 9.75, max: 12.5 } };', '["Sum of total", "<li><span>Sum of total</span><strong>19.5</strong></li>"]', '["Total", "<section aria-label=\\"Total\\"><h2>Total</h2>"', "expectMarkup('The tile \"' + label"]) assert.ok(text.includes(want), want);
    const gen = run(['create', 'proof', 'OrdersDashboard', '--feature', 'orders-dashboard', '--shape', 'dashboard', '--entity', 'Order', '--fields', FIELDS], dir);
    assert.equal(gen.status, 0, `${gen.stdout}${gen.stderr}`);
    assert.equal(fs.readFileSync(file, 'utf8'), text, 'regenerating writes the same bytes');
  });

  await t.test('a broken screen FAILS the proof, and the message names the tile or the state that is wrong', () => {
    const feature = path.join(dir, 'features', 'orders-dashboard');
    const tile = path.join(feature, 'components', 'OrdersDashboardTile.component.tsx');
    const domain = path.join(feature, 'domain', 'OrdersDashboard.domain.ts');
    const expression = path.join(feature, 'expressions', 'OrdersDashboardByStatus.expression.tsx');
    const cases = [
      // The sum tile is labelled wrongly: the count tile is still right, so the message names the tile that is not.
      { file: domain, from: "label: 'Sum of total'", to: "label: 'Total sum'", titles: ['OrdersDashboard screen: the ready state, with every tile and every panel'], state: ['The tile "Sum of total" does not show <li><span>Sum of total</span><strong>19.5</strong></li>.'] },
      // Every tile shows its label but not its number.
      { file: tile, from: '<strong>{value}</strong>', to: '<strong>{label}</strong>', titles: ['OrdersDashboard screen: the ready state, with every tile and every panel'], state: ['The tile "Orders" does not show <li><span>Orders</span><strong>2</strong></li>.'] },
      // The ready branch is gone: the page shows the loading notice for a summary it has.
      { file: expression, from: "  if (state.status === 'error')", to: "  if (state.status === 'ready') return <OrdersDashboardNotice role=\"status\" text=\"Loading orders dashboard...\" />;\n  if (state.status === 'error')", titles: ['OrdersDashboard screen: the ready state, with every tile and every panel'], state: ['ready', 'loading'] },
    ];
    for (const c of cases) {
      const good = fs.readFileSync(c.file, 'utf8');
      const broken = good.replace(c.from, c.to);
      assert.notEqual(broken, good, `the branch was there: ${c.from}`);
      fs.writeFileSync(c.file, broken);
      try {
        const res = proofRun();
        assert.equal(res.status, 1, 'exit 1: the proof ran and failed');
        const result = JSON.parse(res.stdout);
        const failed = result.tests.filter((x) => x.status === 'failed');
        assert.ok(c.titles.every((title) => failed.some((x) => x.title === title)), `${c.titles} failed: ${failed.map((x) => x.title)}`);
        const own = failed.find((x) => x.title === c.titles[0]);
        assert.equal(own.failure.kind, 'app', 'the app behaved differently: not a harness problem');
        if (c.state.length === 1) assert.equal(own.failure.summary, c.state[0]);
        else assert.deepEqual([own.failure.expected, own.failure.reached], c.state);
        assert.equal(result.chain.complete, false);
      } finally {
        fs.writeFileSync(c.file, good);
      }
    }
    assert.equal(proofRun().status, 0, 'and the proof is green again once the screen is');
  });

  await t.test('a file the proof binds to gone is a CONVENTION failure, not a product bug', () => {
    const page = path.join(dir, 'features', 'orders-dashboard', 'pages', 'OrdersDashboardPage.page.tsx');
    fs.renameSync(page, `${page}.off`);
    try {
      const result = JSON.parse(proofRun().stdout);
      assert.equal(result.tests[0].failure.kind, 'convention');
      assert.match(result.tests[0].failure.selector, /OrdersDashboardPage\.page/);
    } finally {
      fs.renameSync(`${page}.off`, page);
    }
    assert.equal(proofRun().status, 0);
  });

  await t.test('the screen renders: the tile row and the panel, from the summary', async () => {
    const { build } = await import('esbuild');
    fs.mkdirSync(path.join(dir, 'smoke'));
    fs.writeFileSync(path.join(dir, 'smoke', 'entry.tsx'), [
      "import { renderToString } from 'react-dom/server';",
      "import { OrdersDashboardPage } from '../features/orders-dashboard/pages/OrdersDashboardPage.page';",
      "import { describeOrdersDashboard } from '../features/orders-dashboard/domain/OrdersDashboard.domain';",
      "import type { OrdersDashboardState } from '../features/orders-dashboard/types';",
      'export const page = (state: OrdersDashboardState) => renderToString(<OrdersDashboardPage state={state} />);',
      'export { describeOrdersDashboard };',
    ].join('\n'));
    const reactDir = fs.realpathSync(path.join(dir, 'node_modules', 'react'));
    await build({ entryPoints: [path.join(dir, 'smoke', 'entry.tsx')], outfile: path.join(dir, 'smoke', 'entry.cjs'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', alias: { react: reactDir }, absWorkingDir: dir, logLevel: 'silent' });
    const screen = createRequire(import.meta.url)(path.join(dir, 'smoke', 'entry.cjs'));
    const summary = { count: 3, total: { sum: 30, average: 10, max: 15.256 } };
    const view = screen.describeOrdersDashboard({ summary });
    assert.equal(screen.page({ status: 'ready', summary, ...view }), '<main><h1>Orders Dashboard</h1><ul aria-label="Orders Dashboard totals"><li><span>Orders</span><strong>3</strong></li><li><span>Sum of total</span><strong>30</strong></li></ul><section aria-label="Total"><h2>Total</h2><dl><div><dt>Sum</dt><dd>30</dd></div><div><dt>Average</dt><dd>10</dd></div><div><dt>Highest</dt><dd>15.26</dd></div></dl></section></main>', 'the tiles, the panel, and numbers to two decimals');
    assert.equal(screen.page({ status: 'loading' }), '<main><h1>Orders Dashboard</h1><p role="status">Loading orders dashboard...</p></main>');
    assert.equal(screen.page({ status: 'error', message: 'The server answered 500.' }), '<main><h1>Orders Dashboard</h1><p role="alert">The server answered 500.</p></main>');
  });

  await t.test('a second run in a fresh project writes the same bytes', async () => {
    const other = initProject('react-spa', 'dashboard');
    const again = await plan(other);
    assert.deepEqual(again.planned.plan, planned.plan, 'the same plan');
    execute(other, again.planned.plan);
    assert.deepEqual(featureFiles(other), written, 'the proof included');
    for (const f of ['src/App.tsx', '.dependency-cruiser.cjs', 'architecture.yml']) assert.equal(fs.readFileSync(path.join(other, f), 'utf8'), fs.readFileSync(path.join(dir, f), 'utf8'), `${f} too`);
  });
});

test('the same dashboard plan on a Next.js project validates too, and its hook and controller are client files', NEEDS_RUNTIME, async () => {
  const dir = initProject('nextjs', 'dashboard');
  const { planned } = await plan(dir);
  assert.deepEqual(planned.wiring.routes, [{ name: 'OrdersDashboard', route: '/orders-dashboard', step: 's10', file: 'app/orders-dashboard/page.tsx' }]);
  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const after = projectFiles(dir);
  assert.deepEqual([...Object.keys(after), ...Object.keys(before)].filter((f, i, all) => all.indexOf(f) === i && after[f] !== before[f]).sort(), planTouches(planned.plan).files.map((f) => f.path).sort(), 'no file changed that the plan did not declare');
  assert.equal(after['app/orders-dashboard/page.tsx'], "import { OrdersDashboardController } from '../../features/orders-dashboard/controllers/OrdersDashboardController.controller';\n\nexport default function Page() {\n  return <OrdersDashboardController />;\n}\n", 'the route entry renders the controller and nothing else');
  assert.deepEqual(validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const files = featureFiles(dir);
  assert.ok(files['features/orders-dashboard/controllers/OrdersDashboardController.controller.tsx'].startsWith("'use client';"));
  assert.ok(files['features/orders-dashboard/hooks/useOrdersDashboard.state.ts'].startsWith("'use client';"));
  const proof = run(['test', 'proof', 'orders-dashboard', '--format', 'json'], dir);
  assert.equal(proof.status, 0, 'the proof of the same screen passes on a Next.js project');
  assert.equal(JSON.parse(proof.stdout).counts.failed, 0);
  const tsc = typeCheck(dir, ['app/orders-dashboard/page.tsx']);
  assert.equal(tsc.status, 0, tsc.output);
});

test('the local source (the rules default without an OpenAPI file): the overview works with no backend, and its proof is green', NEEDS_RUNTIME, async () => {
  const dir = initProject('react-spa', 'dashboard-local');
  const { planned } = await plan(dir, null);
  assert.ok(planned.plan.steps.slice(1, 7).every((s) => s.args.source === 'local'), 'no OpenAPI file: the rules default is the local store');
  execute(dir, planned.plan);
  const files = featureFiles(dir);
  assert.ok(files['features/orders-dashboard/domain/OrdersDashboardStore.domain.ts'].includes('export const readOrdersDashboard = defineDomain<'));
  assert.ok(!files['features/orders-dashboard/services/OrdersDashboard.service.ts'].includes('fetch('), 'the service makes no request');
  assert.deepEqual(validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const tsc = typeCheck(dir, ['src/App.tsx']);
  assert.equal(tsc.status, 0, tsc.output);
  const proof = run(['test', 'proof', 'orders-dashboard', '--format', 'json'], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  const result = JSON.parse(proof.stdout);
  assert.equal(result.counts.failed, 0);
  assert.ok(result.tests.some((x) => x.title === 'OrdersDashboard service: the local store answers the summary of the seed rows, with no network'));
});

test('the openapi source: the service asks the path of GET /orders/summary, and the proof says so', NEEDS_RUNTIME, async () => {
  const dir = initProject('react-spa', 'dashboard-openapi');
  fs.writeFileSync(path.join(dir, 'openapi.yaml'), ['openapi: 3.0.3', 'info: { title: Shop, version: 1.0.0 }', 'servers:', '  - url: /api/v1', 'paths:', '  /orders/summary:', '    get:', '      operationId: summariseOrders', '      responses: { "200": { description: ok } }', ''].join('\n'));
  const { planned } = await plan(dir, null);
  assert.ok(planned.plan.steps.slice(1, 7).every((s) => s.args.source === 'openapi'), 'a matching operation makes openapi the rules default');
  execute(dir, planned.plan);
  const files = featureFiles(dir);
  assert.match(files['features/orders-dashboard/services/OrdersDashboard.service.ts'], /\/\/ Data source: GET \/orders\/summary \(summariseOrders\) of openapi\.yaml\./);
  assert.match(files['features/orders-dashboard/services/OrdersDashboard.service.ts'], /fetch\('\/api\/v1\/orders\/summary', \{ signal \}\)/);
  const proof = run(['test', 'proof', 'orders-dashboard', '--format', 'json'], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  assert.ok(JSON.parse(proof.stdout).tests.some((x) => x.title === 'OrdersDashboard service: asks the path of the OpenAPI operation'));
});
