// #627 -- the dashboard shape, unit by unit: it is registered on the same mechanism as the list, detail and form shapes (plan enum, schema, touches,
// usage), its files are a pure function of the request, a request that cannot be built writes nothing, its tiles and panels follow the fields
// (with the caps), its data source reads the OpenAPI summary operation, and the Requirement chain OFFERS it by fixed rules (a read worded as an
// overview of one data object: dashboard | scaffold, the rules-only default first). The whole path from a sentence (validate, tsc, the proof run
// and broken) is test/dashboard-shape-chain.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_FLOWS, PLAN_SHAPES, planToCommand } from '../packages/core/plan.mjs';
import { expectedFiles } from '../packages/core/plan-touches.mjs';
import { placeCard, planFromBlocks, blockSummary, SHAPE_OPTIONS_BY_SHAPE } from '../packages/core/placement.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { proofFiles, proofTouches } from '../packages/core/proof.mjs';
import { SHAPES, generateShapeVertical, shapeContext, shapeFiles, shapeTouches } from '../packages/core/shapes.mjs';
import { layoutOf, MAX_PANELS, MAX_TILES } from '../packages/core/shape-dashboard.mjs';
import { findEntityOperation } from '../packages/core/openapi-spec.mjs';
import { sourceOffer } from '../packages/core/shape-source.mjs';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { NEEDS_RUNTIME, cardOf, featureTree, initProject, placed, run, shapeProject as project, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const LAYERS = ['domain', 'service', 'hook', 'component', 'page', 'controller'];
const DASH = { shape: 'dashboard', name: 'OrdersDashboard', feature: 'shop', entity: 'Order', fields: 'id:string,total:number,paid:boolean' };
const SENTENCE = 'A manager wants an overview of orders with totals';

test('the dashboard shape is registered on the one mechanism: plan enum, schema, flow arguments and the shape table agree', () => {
  assert.ok(PLAN_SHAPES.includes('dashboard'));
  assert.deepEqual([...PLAN_SHAPES], Object.keys(SHAPES), 'the plan enum and the shape table name the same shapes');
  const schema = JSON.parse(fs.readFileSync(new URL('../schemas/plan.v1.json', import.meta.url), 'utf8'));
  const enums = [];
  (function walk(node) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      if (node.properties?.shape?.enum) enums.push(node.properties.shape.enum);
      Object.values(node).forEach(walk);
    }
  })(schema);
  assert.ok(enums.length >= 3, 'create.unit, create.layer and create.proof carry it');
  for (const e of enums) assert.deepEqual(e, [...PLAN_SHAPES], 'the schema mirrors the registry');
  for (const id of ['create.unit', 'create.layer', 'create.proof']) assert.deepEqual(PLAN_FLOWS[id].args.shape.enum, [...PLAN_SHAPES]);
  assert.deepEqual([...SHAPES.dashboard.layers], LAYERS, 'the six layers of a vertical slice');
  for (const [layer, needed] of Object.entries(SHAPES.dashboard.requires)) assert.ok(needed.every((l) => SHAPES.dashboard.layers.includes(l)), `${layer} requires only layers of the shape`);
});

test('a request that cannot be built writes nothing: a field called count, missing layers, an openapi source with no spec', () => {
  const dir = project();
  const before = featureTree(dir);
  const refused = (request, layers, message) => assert.throws(() => generateShapeVertical(dir, request, layers), message, JSON.stringify(request));
  refused({ ...DASH, fields: 'id:string,count:number' }, LAYERS, /keeps the number of rows in "count"/);
  refused({ ...DASH, name: 'Order' }, LAYERS, /clashing names/);
  refused(DASH, ['hook', 'page'], /--layers domain,service,hook,component,page/);
  refused({ ...DASH, source: 'openapi' }, LAYERS, /GET on a path ending in \/orders\/summary/);
  assert.deepEqual(featureTree(dir), before, 'nothing was written by any of them');
  assert.equal(shapeTouches(dir, { ...DASH, layer: 'domain', fields: 'id:string,count:number' }), null, 'touches never throws');
  const cli = run(['create', 'layer', 'OrdersDashboard', '--feature', 'shop', '--layers', 'domain', '--shape', 'dashboard', '--fields', 'id:string,count:number'], dir);
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /"count"/);
});

test('construct create --shape dashboard writes the whole screen, and its usage names the shape', () => {
  const dir = project();
  const out = run(['create', 'layer', 'OrdersDashboard', '--feature', 'shop', '--layers', LAYERS.join(','), '--shape', 'dashboard', '--fields', 'id:string,total:number', '--format', 'json'], dir);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).files.length, 14, 'fourteen files, types.ts among them');
  const usage = run(['--help'], dir);
  assert.match(`${usage.stdout}${usage.stderr}`, /--shape list\|detail\|form\|dashboard/);
});

test('the names and the entity: the entity of a dashboard is its unit name without the Dashboard word, singular; the endpoint is the summary of the plural', () => {
  const dir = project();
  const ctx = (request) => shapeContext(dir, { feature: 'shop', shape: 'dashboard', ...request });
  assert.equal(ctx({ name: 'OrdersDashboard' }).request.entity, 'Order');
  assert.equal(ctx({ name: 'OrderDashboard' }).request.entity, 'Order', 'a base the rules leave unchanged is kept');
  assert.equal(ctx({ name: 'CategoriesOverview' }).request.entity, 'Category');
  const c = ctx({ name: 'OrdersDashboard' });
  assert.equal(c.endpoint, '/api/orders/summary');
  assert.equal(c.names.summary, 'OrderSummary');
  assert.equal(c.entityPlural, 'orders');
  assert.equal(c.names.hook, 'useOrdersDashboard');
});

test('the tiles and panels follow the fields: a count tile, a tile for each number and yes or no field, a panel for each number field, capped', () => {
  const dir = project();
  const layout = (fields) => layoutOf(shapeContext(dir, { ...DASH, fields }));
  assert.deepEqual(layout('id:string,name:string').tiles.map((t) => t.label), ['Orders'], 'nothing to add up: the count only');
  assert.deepEqual(layout('id:string,name:string').panels, []);
  assert.deepEqual(layout('id:string,total:number,paid:boolean').tiles.map((t) => [t.key, t.label, t.from]), [['count', 'Orders', 'count'], ['total', 'Sum of total', 'total.sum'], ['paid', 'Paid', 'paid']]);
  assert.deepEqual(layout('id:string,total:number,paid:boolean').panels.map((p) => [p.key, p.title]), [['total', 'Total']]);
  const many = layout('id:number,a:number,b:number,c:number,d:number,e:boolean');
  assert.equal(many.tiles.length, MAX_TILES, 'the count and three more');
  assert.equal(many.panels.length, MAX_PANELS, 'at most three panels, in field order');
  assert.deepEqual(many.panels.map((p) => p.key), ['a', 'b', 'c']);
  const files = shapeFiles(dir, { ...DASH, fields: 'id:number,unitPrice:number', layer: 'domain' });
  assert.match(files[0].content, /\{ key: 'unitPrice', label: 'Sum of unit price', value: show\(summary\.unitPrice\.sum\) \}/);
  assert.match(files[0].content, /key: 'unitPrice', title: 'Unit price'/);
});

test('the files are a pure function of the request: the same request gives the same bytes, and the summary type follows the fields', () => {
  const dir = project();
  for (const layer of LAYERS) assert.deepEqual(shapeFiles(dir, { ...DASH, layer }), shapeFiles(dir, { ...DASH, layer }));
  const domain = shapeFiles(dir, { ...DASH, layer: 'domain' });
  assert.match(domain.at(-1).content, /export interface OrderSummary \{\n {2}count: number;\n {2}total: \{ sum: number; average: number; max: number \};\n {2}paid: number;\n\}/);
  const local = shapeFiles(dir, { ...DASH, layer: 'domain', source: 'local' });
  assert.deepEqual(local.map((f) => path.basename(f.path)), ['OrdersDashboard.domain.ts', 'OrdersDashboardStore.domain.ts', 'types.ts']);
  assert.deepEqual(expectedFiles(dir, 'create.unit', { layer: 'domain', ...DASH }).map((f) => `${f.change} ${f.path}`), ['create features/shop/domain/OrdersDashboard.domain.ts', 'modify features/shop/types.ts']);
});

test('the openapi source of a dashboard is GET on a path ending in /<plural>/summary, under the spec server prefix', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'openapi.yaml'), ['openapi: 3.0.3', 'servers:', '  - url: https://example.com/api/v1', 'paths:', '  /orders:', '    get: { operationId: listOrders }', '  /orders/summary:', '    get: { operationId: summariseOrders }', '  /orders/{id}:', '    get: { operationId: getOrder }', ''].join('\n'));
  const found = findEntityOperation(dir, { kind: 'dashboard', plural: 'Orders' });
  assert.deepEqual(found, { file: 'openapi.yaml', method: 'GET', path: '/orders/summary', url: '/api/v1/orders/summary', operationId: 'summariseOrders' });
  assert.deepEqual(findEntityOperation(dir, { kind: 'list', plural: 'Orders' })?.path, '/orders', 'the list kind still finds the collection, not the summary');
  assert.equal(findEntityOperation(dir, { kind: 'dashboard', plural: 'Products' }), null);
  const offer = sourceOffer(dir, { shape: 'dashboard', unit: 'OrdersDashboard', plural: 'Orders', endpoint: '/api/orders/summary' });
  assert.deepEqual([offer.question.default, offer.source, offer.operation.url], ['openapi', 'openapi', '/api/v1/orders/summary']);
  assert.deepEqual(offer.question.options.map((o) => o.id), ['openapi', 'local', 'endpoint']);
  const ctx = shapeContext(dir, { ...DASH, source: 'openapi' });
  assert.equal(ctx.endpoint, '/api/v1/orders/summary');
  const service = shapeFiles(dir, { ...DASH, layer: 'service', source: 'openapi' })[0].content;
  assert.match(service, /\/\/ Data source: GET \/orders\/summary \(summariseOrders\) of openapi\.yaml\./);
  const none = sourceOffer(project(), { shape: 'dashboard', unit: 'OrdersDashboard', plural: 'Orders', endpoint: '/api/orders/summary' });
  assert.equal(none.source, 'local', 'no spec: the local store is the default');
});

// ------------------------------------------------------------------------------------------------- the offer

test('a read worded as an overview of one data object is offered dashboard | scaffold by fixed rules, and the rules that say no', () => {
  for (const text of [SENTENCE, 'A user wants to see a dashboard of orders', 'A user wants to see a summary of orders', 'A manager wants a report of orders', 'A manager wants statistics of orders with totals', 'A user wants an overview of an order']) {
    const { offers, open, complete } = placed(text);
    assert.equal(complete, true, `${text}: the offer never holds the plan back`);
    assert.deepEqual(open, [], text);
    assert.equal(offers.length, 1, text);
    assert.deepEqual(offers[0].options.map((o) => o.id), ['dashboard', 'scaffold'], text);
    assert.deepEqual([offers[0].id, offers[0].shape, offers[0].default, offers[0].suggestion.option, offers[0].suggestion.provider], ['q-shape', 'dashboard', 'dashboard', 'dashboard', 'rules'], text);
    assert.ok(offers[0].options.every((o) => o.enabled && o.label.length <= 60 && o.why.length <= 120), 'a chooser summary: capped text');
  }
  assert.deepEqual(SHAPE_OPTIONS_BY_SHAPE.dashboard.map((o) => o.id), ['dashboard', 'scaffold']);
  assert.equal(placed('A user wants to see a list of products').offers[0].shape, 'list', 'a plain list is still a list');
  assert.equal(placed('A user wants to see a product').offers[0].shape, 'detail');
  assert.equal(placed('A user wants to add a product with a name and a price').offers[0].shape, 'form');
  const no = [
    'A user wants an overview of orders and products', // two data objects
    'A user wants to add an overview of orders', // not only reads
    'A user wants to see orders', // no overview word: a list
  ];
  assert.deepEqual(placed(no[0]).offers, [], no[0]);
  assert.notEqual(placed(no[1]).offers[0]?.shape, 'dashboard', no[1]);
  assert.equal(placed(no[2]).offers[0].shape, 'list', no[2]);
  assert.deepEqual(placed(SENTENCE, { screen: 'Catalog' }).offers, [], "a screen named otherwise is not the shape's unit name");
});

test('the lexicon knows manager, overview, dashboard, summary, report, statistics and total: the example sentence parses with no open question', () => {
  const { card, open } = parseRequirement(SENTENCE);
  assert.deepEqual([open, card.open], [[], []]);
  assert.deepEqual(card.verbs.map((v) => [v.text, v.kind]), [['overview', 'read']]);
  assert.deepEqual(card.nouns.map((n) => [n.text, n.kind]), [['orders', 'entity'], ['totals', 'ui-part']]);
});

test('answering the offer applies the shape to the blocks, records who decided, and a wrong option for the card is refused', async () => {
  const first = placed(SENTENCE);
  const [offer] = first.offers;
  assert.deepEqual([offer.unit, offer.entity, offer.fields], ['OrdersDashboard', 'Order', 'id:string,total:number'], 'the fields are the measures the card names, with the id');
  const suggestion = await suggest({ id: offer.id, question: offer.question, options: offer.options });
  assert.equal(suggestion.option, 'dashboard', 'the rules-only decision provider suggests the matching shape');
  const answered = placed(SENTENCE, { answers: { 'q-shape': { option: suggestion.option, by: 'decision-model', provider: suggestion.provider } } });
  assert.deepEqual(answered.errors, []);
  assert.deepEqual(answered.blocks.map((b) => [b.id, b.placement, b.layers.map((l) => `${l.layer}:${l.name}`)]), [['b1', 'server-read', ['domain:OrdersDashboard', 'service:OrdersDashboard', 'hook:OrdersDashboard', 'controller:OrdersDashboard']], ['b1-view', 'presentational', ['component:OrdersDashboard', 'page:OrdersDashboard']]]);
  assert.ok(answered.blocks.every((b) => b.shape.name === 'dashboard' && b.shape.entity === 'Order' && b.shape.fields === 'id:string,total:number'));
  assert.deepEqual(answered.decisions, [{ question: 'q-shape', option: 'dashboard', by: 'decision-model', provider: 'rules' }]);
  assert.equal(answered.offers[0].chosen, 'dashboard');
  assert.match(answered.notes[1], /The dashboard shape reads one typed summary through a service: choose where it comes from \(q-source: a local store, the endpoint \/api\/orders\/summary, or an OpenAPI operation GET on a path ending in \/orders\/summary\)/);
  const scaffold = placed(SENTENCE, { answers: { 'q-shape': 'scaffold' } });
  assert.deepEqual(scaffold.blocks, first.blocks, 'choosing the scaffold is the plain plan');
  assert.deepEqual(scaffold.decisions, [{ question: 'q-shape', option: 'scaffold', by: 'person' }]);
  for (const other of ['list', 'detail', 'form']) assert.deepEqual(placed(SENTENCE, { answers: { 'q-shape': other } }).errors.map((e) => e.code), ['PLACE_UNKNOWN_OPTION'], `${other} is not an option of this card`);
  assert.deepEqual(blockSummary(first).offers.map((o) => [o.id, o.chosen, o.default]), [['q-shape', null, 'dashboard']]);
  assert.deepEqual(blockSummary(answered).lines, ['"overview orders totals" is an overview fetched by a service (domain, service, hook, controller).', '"overview orders totals" shows that overview from props (component, page).']);
});

test('a dashboard plan carries the shape on every unit, is wired and proven, and plans no browser flow for it', () => {
  for (const playwright of [false, true]) {
    const dir = project();
    if (playwright) fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { testDir: 'features' };\n");
    const answered = placeCard(cardOf(SENTENCE), { framework: 'react-spa', answers: { 'q-shape': 'dashboard' } });
    const planned = planFromBlocks(answered.blocks, { feature: 'orders-dashboard', root: dir, decisions: answered.decisions });
    assert.equal(planned.ok, true, JSON.stringify(planned.errors));
    assert.deepEqual(planned.plan.steps.map((s) => s.flow), ['create.feature', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'add.dependency', 'sync', 'create.route', 'create.proof', 'test.proof'], 'the wiring and the proof steps apply to every shape');
    assert.ok(planned.plan.steps.filter((s) => s.flow === 'create.unit').every((s) => s.args.shape === 'dashboard' && s.args.name === 'OrdersDashboard' && s.args.source === 'local'));
    assert.deepEqual(planned.proof.steps.map((s) => s.kind), ['render'], 'the browser flow exists only for the list shape');
    if (playwright) assert.match(planned.proof.playwright.skipped, /No browser flow is planned for OrdersDashboard \(dashboard\)/);
  }
});

test('the proof of a dashboard is the render proof: locked, a pure function of the request, and it names every tile and panel', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { testDir: 'features' };\n");
  const files = proofFiles(dir, { ...DASH, kind: 'render' });
  assert.deepEqual(files.map((f) => path.basename(f.path)), ['OrdersDashboardScreen.proof.test.ts']);
  assert.ok(files[0].content.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
  assert.equal(files[0].content, proofFiles(dir, { ...DASH, kind: 'render' })[0].content, 'a pure function of the request');
  assert.deepEqual(proofFiles(dir, { ...DASH, kind: 'playwright' }), [], 'no browser flow for this shape');
  assert.deepEqual(proofTouches(dir, { ...DASH }).map((f) => f.path), ['features/shop/tests/generated/OrdersDashboardScreen.proof.test.ts', 'architecture.yml']);
  for (const want of ['const SUMMARY: OrderSummary = { count: 2, total: { sum: 19.5, average: 9.75, max: 12.5 }, paid: 1 };', '["Paid", "<li><span>Paid</span><strong>1</strong></li>"]', 'construct create proof OrdersDashboard --feature shop --shape dashboard --entity Order --fields id:string,total:number,paid:boolean']) assert.ok(files[0].content.includes(want), want);
});

test('the worked example in docs/PLACEMENT.md runs and produces exactly the commands and files the doc shows', () => {
  const doc = fs.readFileSync(new URL('../docs/PLACEMENT.md', import.meta.url), 'utf8');
  const block = (tag) => JSON.parse(new RegExp(`<!-- ${tag} -->\\n\`\`\`json\\n([\\s\\S]*?)\`\`\``).exec(doc)?.[1] ?? 'null');
  const dir = project();
  const card = cardOf(SENTENCE);
  const [offer] = placeCard(card, { framework: 'react-spa' }).offers;
  const answered = placeCard(card, { framework: 'react-spa', answers: { [offer.id]: { option: offer.default, by: 'decision-model', provider: 'rules' } } });
  const planned = planFromBlocks(answered.blocks, { feature: 'orders-dashboard', root: dir, decisions: answered.decisions });
  assert.deepEqual(block('dashboard-shape-example:commands'), planned.plan.steps.map((step) => `construct ${planToCommand(step).argv.join(' ')}`), 'commands');
  assert.deepEqual(block('dashboard-shape-example:files'), planned.files, 'files');
});

// ------------------------------------------------------------------------------ fields the proof and the templates must survive

test('a dashboard with camelCase number fields, a boolean and more measures than it has tiles validates, type-checks and is proven', NEEDS_RUNTIME, () => {
  const fields = 'id:number,title:string,unitPrice:number,quantity:number,discount:number,isActive:boolean';
  const dir = initProject('react-spa', 'dashboard');
  assert.equal(run(['create', 'feature', 'stock-report'], dir).status, 0);
  const args = ['--feature', 'stock-report', '--shape', 'dashboard', '--entity', 'Item', '--fields', fields];
  const layers = run(['create', 'layer', 'StockReport', ...args, '--layers', LAYERS.join(',')], dir);
  assert.equal(layers.status, 0, layers.stderr);
  const proof = run(['create', 'proof', 'StockReport', ...args], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  assert.equal(run(['sync'], dir).status, 0);
  assert.deepEqual(validateJson(dir).violations.filter((v) => v.file.startsWith('features/')).map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const tsc = typeCheck(dir, []);
  assert.equal(tsc.status, 0, tsc.output);
  const res = run(['test', 'proof', 'stock-report', '--format', 'json'], dir);
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.equal(JSON.parse(res.stdout).counts.failed, 0);
  const domain = fs.readFileSync(path.join(dir, 'features', 'stock-report', 'domain', 'StockReport.domain.ts'), 'utf8');
  assert.equal((domain.match(/\bkey: '/g) ?? []).length, MAX_TILES + MAX_PANELS, 'four tiles and three panels, the rest is only in the summary');
});
