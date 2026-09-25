// #620 -- the detail shape, unit by unit: it is registered on the same mechanism as the list shape (plan enum, schema, touches, usage), its
// files are a pure function of the request, a request that cannot be built writes nothing, and the Requirement chain OFFERS it by fixed rules
// (a read of ONE item: detail | scaffold, the rules-only default first). Also the fields the templates and the proof must survive (a number
// id, a boolean, a camelCase name). The whole path from a sentence (validate, tsc, the proof run and broken) is test/detail-shape-chain.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_FLOWS, PLAN_SHAPES, planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { expectedFiles } from '../packages/core/plan-touches.mjs';
import { placeCard, planFromBlocks, blockSummary, SHAPE_OPTIONS_BY_SHAPE } from '../packages/core/placement.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { generateProof, proofFiles, proofTouches, PLAYWRIGHT_SHAPES } from '../packages/core/proof.mjs';
import { SHAPES, generateShapeVertical, pluralOf, shapeContext, shapeFiles, shapeTouches } from '../packages/core/shapes.mjs';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { NEEDS_RUNTIME, cardOf, featureTree, initProject, placed, run, shapeProject as project, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const LAYERS = ['domain', 'service', 'hook', 'component', 'page', 'controller'];
const DETAIL = { shape: 'detail', name: 'Product', feature: 'shop', entity: 'Product', fields: 'id:string,name:string,price:number' };
const SENTENCE = 'A user wants to see the details of a product';

test('the detail shape is registered on the one mechanism: plan enum, schema, flow arguments and the shape table agree', () => {
  assert.ok(PLAN_SHAPES.includes('detail'));
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
  assert.deepEqual([...SHAPES.detail.layers], LAYERS, 'the six layers of a vertical slice');
  for (const [layer, needed] of Object.entries(SHAPES.detail.requires)) assert.ok(needed.every((l) => SHAPES.detail.layers.includes(l)), `${layer} requires only layers of the shape`);
  assert.ok(PLAYWRIGHT_SHAPES.includes('detail'), 'the detail shape has a browser flow since #659 (test/proof-browser.test.mjs)');
});

test('the names: a plural for the endpoint, the entity of a detail is its unit name, every identifier from the unit name', () => {
  assert.deepEqual(['Product', 'Category', 'Box', 'Bus', 'Day'].map(pluralOf), ['Products', 'Categories', 'Boxes', 'Buses', 'Days']);
  const dir = project();
  const ctx = shapeContext(dir, { shape: 'detail', name: 'Product', feature: 'shop' });
  assert.equal(ctx.request.entity, 'Product', 'the entity of a detail is its unit name');
  assert.equal(ctx.endpoint, '/api/products', 'the endpoint is the plural of the entity');
  assert.equal(shapeContext(dir, { shape: 'detail', name: 'Category', feature: 'shop' }).endpoint, '/api/categories');
  const d = ctx.names;
  assert.deepEqual([d.hook, d.fetch, d.describe, d.state, d.result, d.page, d.expression, d.controller, d.details, d.row, d.notice], ['useProduct', 'fetchProduct', 'describeProduct', 'ProductDetailState', 'ProductDetailResult', 'ProductPage', 'ProductByStatus', 'ProductController', 'ProductDetails', 'ProductDetailRow', 'ProductNotice']);
});

test('the same request gives the same files, byte for byte, and each file is built with the factory of its layer', () => {
  const dir = project();
  const first = LAYERS.flatMap((layer) => shapeFiles(dir, { ...DETAIL, layer }));
  assert.deepEqual(first, LAYERS.flatMap((layer) => shapeFiles(dir, { ...DETAIL, layer })), 'the same request, the same files');
  assert.deepEqual(first.map((f) => path.basename(f.path)), ['Product.domain.ts', 'types.ts', 'Product.service.ts', 'useProduct.state.ts', 'ProductDetailRow.component.tsx', 'ProductDetails.component.tsx', 'ProductNotice.component.tsx', 'ProductPage.page.tsx', 'ProductByStatus.expression.tsx', 'ProductController.controller.tsx']);
  assert.deepEqual(first.filter((f) => f.change === 'modify').map((f) => path.basename(f.path)), ['types.ts']);
  assert.ok(first.every((f) => !/\bTODO\b|\{\{|\[object Object\]|\bNaN\b/.test(f.content)), 'no stub and no placeholder');
  for (const [pattern, file] of [[/defineDomain</, '.domain.ts'], [/defineService\(/, '.service.ts'], [/useTrackedState</, '.state.ts'], [/defineComponent</, '.component.tsx'], [/defineExpression</, '.expression.tsx'], [/definePage</, '.page.tsx'], [/defineController</, '.controller.tsx']]) {
    const hit = first.filter((f) => f.path.endsWith(file));
    assert.ok(hit.length && hit.every((f) => pattern.test(f.content)), `${file} uses its factory`);
  }
  assert.deepEqual(shapeTouches(dir, { ...DETAIL, layer: 'domain' }).map((f) => `${f.change} ${f.path}`), ['create features/shop/domain/Product.domain.ts', 'modify features/shop/types.ts'], 'touches are derived from the same files');
  assert.doesNotMatch(shapeFiles(dir, { ...DETAIL, layer: 'page' }).map((f) => f.content).join('\n'), /use client/, 'a page stays presentational');
  const spa = shapeFiles(dir, { ...DETAIL, layer: 'hook' })[0].content;
  assert.doesNotMatch(spa, /^'use client'/, 'a Vite SPA needs no directive');
  assert.ok(shapeFiles(project('nextjs'), { ...DETAIL, layer: 'controller' })[0].content.startsWith("'use client';\n"), 'a Next.js controller is a client file');
});

test('a plan step of a detail declares its files (touches derived), and its command is the one the plan runner runs', () => {
  const dir = project();
  const step = (flow, args) => ({ id: 's1', title: 'x', flow, args, executor: 'deterministic', touches: { features: [], files: [] } });
  const unit = step('create.unit', { layer: 'hook', name: 'Product', feature: 'shop', shape: 'detail', entity: 'Product', fields: 'id:string,name:string' });
  assert.deepEqual(expectedFiles(dir, 'create.unit', unit.args).map((f) => f.path), ['features/shop/hooks/useProduct.state.ts']);
  assert.deepEqual(expectedFiles(dir, 'create.layer', { name: 'Product', feature: 'shop', layers: 'domain,component', shape: 'detail' }).map((f) => f.path).sort(), ['features/shop/components/ProductDetailRow.component.tsx', 'features/shop/components/ProductDetails.component.tsx', 'features/shop/components/ProductNotice.component.tsx', 'features/shop/domain/Product.domain.ts', 'features/shop/types.ts']);
  assert.deepEqual(planToCommand(unit).argv, ['create', 'hook', 'Product', '--feature', 'shop', '--shape', 'detail', '--entity', 'Product', '--fields', 'id:string,name:string']);
  const plan = (steps) => ({ version: 1, ticket: { source: 'text', title: 'x' }, steps });
  assert.equal(validatePlan(plan([step('create.layer', { name: 'Product', feature: 'shop', layers: ['domain'], shape: 'detail' })])).valid, true, 'the schema accepts it');
  assert.equal(validatePlan(plan([step('create.layer', { name: 'Product', feature: 'shop', layers: ['domain'], shape: 'grid' })])).valid, false, 'an unknown shape is refused by the schema');
});

test('the fields shape the templates: a number id, camelCase names, a boolean', () => {
  const dir = project();
  const at = (fields, layer) => Object.fromEntries(shapeFiles(dir, { ...DETAIL, fields, layer }).map((f) => [path.basename(f.path), f.content]));
  const fields = 'id:number,unitPrice:number,isActive:boolean,title:string';
  const domain = at(fields, 'domain')['Product.domain.ts'];
  assert.match(domain, /\{ field: 'id', label: 'Id', value: String\(item\.id\) \}/);
  assert.match(domain, /\{ field: 'unitPrice', label: 'Unit price', value: String\(item\.unitPrice\) \}/, 'a camelCase field is worded as a label');
  assert.match(domain, /\{ field: 'isActive', label: 'Is active', value: item\.isActive \? 'Yes' : 'No' \}/, 'a boolean reads Yes or No');
  assert.match(at(fields, 'service')['Product.service.ts'], /typeof row\.id === 'number' && typeof row\.unitPrice === 'number' && typeof row\.isActive === 'boolean' && typeof row\.title === 'string'/);
});

test('a bad request is a usage error that names the problem, before anything is written', () => {
  const dir = project();
  const before = featureTree(dir);
  const refused = (request, message) => assert.throws(() => generateShapeVertical(dir, { ...request }, LAYERS), message, JSON.stringify(request));
  refused({ ...DETAIL, entity: 'product' }, /must be PascalCase/);
  refused({ ...DETAIL, fields: 'name:string' }, /need an "id" field/);
  assert.throws(() => generateShapeVertical(dir, DETAIL, ['hook', 'page']), /--layers domain,service,hook,component,page/);
  assert.deepEqual(featureTree(dir), before, 'nothing was written by any of them');
  assert.equal(shapeTouches(dir, { ...DETAIL, layer: 'domain', fields: 'id' }), null, 'touches never throws');
  const llm = run(['create', 'layer', 'Product', '--feature', 'shop', '--layers', 'domain', '--shape', 'detail', '--llm', 'ollama'], dir);
  assert.match(llm.stderr, /no model/, 'a shape is deterministic: never with --llm');
});

test('construct create --shape detail writes the whole screen, and its usage names the shape', () => {
  const dir = project();
  const detail = run(['create', 'layer', 'Product', '--feature', 'shop', '--layers', LAYERS.join(','), '--shape', 'detail', '--fields', 'id:string,name:string,price:number', '--format', 'json'], dir);
  assert.equal(detail.status, 0, detail.stderr);
  assert.equal(JSON.parse(detail.stdout).files.length, 10, 'ten files, types.ts among them');
  const usage = run(['--help'], dir);
  const text = `${usage.stdout}${usage.stderr}`;
  assert.match(text, /--shape list\|detail/);
  assert.match(text, /detail = one item by id/);
});

// ------------------------------------------------------------------------------------------------- the offer

test('a read of ONE item is offered detail | scaffold by fixed rules, and the rules that say no', () => {
  for (const text of [SENTENCE, 'A user wants to view a product', 'A user wants to see a product', 'A user wants to see an order']) {
    const { offers, open, complete } = placed(text);
    assert.equal(complete, true, `${text}: the offer never holds the plan back`);
    assert.deepEqual(open, [], text);
    assert.equal(offers.length, 1, text);
    assert.deepEqual(offers[0].options.map((o) => o.id), ['detail', 'scaffold'], text);
    assert.deepEqual([offers[0].id, offers[0].shape, offers[0].default, offers[0].suggestion.option, offers[0].suggestion.provider], ['q-shape', 'detail', 'detail', 'detail', 'rules'], text);
    assert.ok(offers[0].options.every((o) => o.enabled && o.label.length <= 60 && o.why.length <= 120), 'a chooser summary: capped text');
  }
  assert.deepEqual(SHAPE_OPTIONS_BY_SHAPE.detail.map((o) => o.id), ['detail', 'scaffold']);
  const no = [
    'A user wants to see their current subscription plan', // the person's own: found from the session, not by an id
    'A customer wants to see their billing details', // "their"
    'A user wants to see my profile', // "my"
    'A customer wants to see the invoice list', // a list part: many, not one
    'A user wants to see a product and delete an order', // two verbs, two data objects
    'A user wants to click a button to see a product', // it needs the browser: a client leaf
  ];
  for (const text of no) assert.ok(placed(text).offers.every((o) => o.shape !== 'detail'), text);
  for (const text of no.slice(0, 4)) assert.deepEqual(placed(text).offers, [], text);
  assert.deepEqual(placed('A user wants to see a product', { screen: 'Catalog' }).offers, [], "a screen named otherwise is not the shape's unit name");
});

test('the lexicon knows the word detail: the example sentence parses with no open question', () => {
  const { card, open } = parseRequirement(SENTENCE);
  assert.deepEqual([open, card.open], [[], []]);
  assert.deepEqual(card.verbs.map((v) => [v.text, v.kind]), [['see', 'read']]);
  assert.deepEqual(card.nouns.map((n) => [n.text, n.kind]), [['details', 'ui-part'], ['product', 'entity']]);
});

test('answering the offer applies the shape to the blocks, records who decided, and a wrong option for the card is refused', async () => {
  const first = placed(SENTENCE);
  const [offer] = first.offers;
  const suggestion = await suggest({ id: offer.id, question: offer.question, options: offer.options });
  assert.equal(suggestion.option, 'detail', 'the rules-only decision provider suggests the matching shape');
  const answered = placed(SENTENCE, { answers: { 'q-shape': { option: suggestion.option, by: 'decision-model', provider: suggestion.provider } } });
  assert.deepEqual(answered.errors, []);
  assert.deepEqual(answered.blocks.map((b) => [b.id, b.placement, b.layers.map((l) => `${l.layer}:${l.name}`)]), [['b1', 'server-read', ['domain:Product', 'service:Product', 'hook:Product', 'controller:Product']], ['b1-view', 'presentational', ['component:Product', 'page:Product']]]);
  assert.ok(answered.blocks.every((b) => b.shape.name === 'detail' && b.shape.entity === 'Product' && b.shape.fields === 'id:string,name:string,price:number'));
  assert.deepEqual(answered.decisions, [{ question: 'q-shape', option: 'detail', by: 'decision-model', provider: 'rules' }]);
  assert.equal(answered.offers[0].chosen, 'detail');
  assert.equal(offer.unit, 'Product');
  assert.match(answered.notes[1], /The detail shape reads one item by id through a service: choose where it comes from \(q-source: a local store, the endpoint \/api\/products\/<id>, or an OpenAPI operation\)/);
  assert.match(answered.notes[1], /The plan wires the route entry, runs sync/);
  const scaffold = placed(SENTENCE, { answers: { 'q-shape': 'scaffold' } });
  assert.deepEqual(scaffold.blocks, first.blocks, 'choosing the scaffold is the plain plan');
  assert.deepEqual(scaffold.decisions, [{ question: 'q-shape', option: 'scaffold', by: 'person' }]);
  assert.deepEqual(placed(SENTENCE, { answers: { 'q-shape': 'list' } }).errors.map((e) => e.code), ['PLACE_UNKNOWN_OPTION'], 'list is not an option of this card');
  assert.deepEqual(blockSummary(first).offers.map((o) => [o.id, o.chosen, o.default]), [['q-shape', null, 'detail']]);
  assert.deepEqual(blockSummary(answered).lines, ['"see details product" is one item fetched by id by a service (domain, service, hook, controller).', '"see details product" shows that item from props (component, page).']);
});

test('a detail plan carries the shape on every unit, is wired and proven, and plans no browser flow for it', () => {
  for (const playwright of [false, true]) {
    const dir = project();
    if (playwright) fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { testDir: 'features' };\n");
    const answered = placeCard(cardOf(SENTENCE), { framework: 'react-spa', answers: { 'q-shape': 'detail' } });
    const planned = planFromBlocks(answered.blocks, { feature: 'product', root: dir, decisions: answered.decisions });
    assert.equal(planned.ok, true, JSON.stringify(planned.errors));
    assert.deepEqual(planned.plan.steps.map((s) => s.flow), ['create.feature', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'add.dependency', 'sync', 'create.route', 'check.types', 'create.proof', 'test.proof'], 'the wiring, the type-check and the proof steps apply to every shape');
    assert.ok(planned.plan.steps.filter((s) => s.flow === 'create.unit').every((s) => s.args.shape === 'detail' && s.args.name === 'Product'));
    assert.deepEqual(planned.proof.steps.map((s) => s.kind), ['render'], 'the browser flow exists only for the list shape');
    if (playwright) assert.match(planned.proof.playwright.skipped, /No browser flow is planned for Product \(detail\)/);
  }
});

test('the proof of a detail is the render proof; its Playwright flow (#659) is written only for a source that makes a request', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { testDir: 'features' };\n");
  const files = proofFiles(dir, { ...DETAIL, kind: 'render' });
  assert.deepEqual(files.map((f) => path.basename(f.path)), ['ProductScreen.proof.test.ts']);
  assert.ok(files[0].content.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
  assert.equal(files[0].content, proofFiles(dir, { ...DETAIL, kind: 'render' })[0].content, 'a pure function of the request');
  assert.deepEqual(proofFiles(dir, { ...DETAIL, kind: 'playwright' }).map((f) => path.basename(f.path)), ['product--screen.spec.ts'], 'the browser flow of the detail (the default source is the endpoint)');
  assert.deepEqual(proofTouches(dir, { ...DETAIL, kind: 'playwright' }).map((f) => f.path), ['features/shop/tests/generated/product--screen.spec.ts', 'architecture.yml']);
  const local = generateProof(dir, { ...DETAIL, kind: 'playwright', source: 'local' });
  assert.deepEqual([local.files, local.needs], [[], []]);
  assert.match(local.skipped, /The local data source makes no request/);
  assert.deepEqual(proofTouches(dir, { ...DETAIL, kind: 'render' }).map((f) => `${f.change} ${f.path}`), ['create features/shop/tests/generated/ProductScreen.proof.test.ts', 'modify architecture.yml']);
});

test('the worked example in docs/PLACEMENT.md (detail) is exactly what the code produces', () => {
  const doc = fs.readFileSync(new URL('../docs/PLACEMENT.md', import.meta.url), 'utf8');
  const block = (tag) => JSON.parse(new RegExp(`<!-- ${tag} -->\\n\`\`\`json\\n([\\s\\S]*?)\`\`\``).exec(doc)?.[1] ?? 'null');
  const dir = project();
  const card = cardOf(SENTENCE);
  const [offer] = placeCard(card, { framework: 'react-spa' }).offers;
  const answered = placeCard(card, { framework: 'react-spa', answers: { [offer.id]: { option: offer.default, by: 'decision-model', provider: 'rules' } } });
  const planned = planFromBlocks(answered.blocks, { feature: 'product', root: dir, decisions: answered.decisions });
  assert.deepEqual(block('detail-shape-example:commands'), planned.plan.steps.map((step) => `construct ${planToCommand(step).argv.join(' ')}`), 'commands');
  assert.deepEqual(block('detail-shape-example:files'), planned.files, 'files');
});

// ------------------------------------------------------------------------------ fields the proof and the templates must survive

test('a detail screen with a number id, a camelCase name and a boolean validates, type-checks and is proven', NEEDS_RUNTIME, () => {
  const fields = 'id:number,unitPrice:number,isActive:boolean,title:string';
  const dir = initProject('react-spa', 'detail');
  assert.equal(run(['create', 'feature', 'item'], dir).status, 0);
  const args = ['--feature', 'item', '--shape', 'detail', '--fields', fields];
  const layers = run(['create', 'layer', 'Item', ...args, '--layers', LAYERS.join(',')], dir);
  assert.equal(layers.status, 0, layers.stderr);
  const proof = run(['create', 'proof', 'Item', ...args], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  assert.equal(run(['sync'], dir).status, 0);
  assert.deepEqual(validateJson(dir).violations.filter((v) => v.file.startsWith('features/')).map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const tsc = typeCheck(dir, []);
  assert.equal(tsc.status, 0, tsc.output);
  const res = run(['test', 'proof', 'item', '--format', 'json'], dir);
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.equal(JSON.parse(res.stdout).counts.failed, 0);
});
