// #626 -- the form shape, unit by unit: it is registered on the same mechanism as the list and detail shapes (plan enum, schema, touches, usage),
// its files are a pure function of the request, a request that cannot be built writes nothing, and the Requirement chain OFFERS it by fixed
// rules (a write with properties: form | scaffold, the rules-only default first). Also the fields the templates and the proof must survive (a
// boolean, a camelCase name, a number). The whole path from a sentence (validate, tsc, the proof run and broken) is test/form-shape-chain.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_FLOWS, PLAN_SHAPES, planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { expectedFiles } from '../packages/core/plan-touches.mjs';
import { placeCard, planFromBlocks, blockSummary, SHAPE_OPTIONS_BY_SHAPE } from '../packages/core/placement.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { generateProof, proofFiles, proofTouches, PLAYWRIGHT_SHAPES } from '../packages/core/proof.mjs';
import { SHAPES, generateShapeVertical, shapeContext, shapeFiles, shapeTouches } from '../packages/core/shapes.mjs';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { NEEDS_RUNTIME, cardOf, featureTree, initProject, placed, run, shapeProject as project, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const LAYERS = ['domain', 'service', 'hook', 'component', 'page', 'controller'];
const FORM = { shape: 'form', name: 'AddProduct', feature: 'shop', entity: 'Product', fields: 'id:string,name:string,price:number' };
const SENTENCE = 'A user wants to add a product with a name and a price';

test('the form shape is registered on the one mechanism: plan enum, schema, flow arguments and the shape table agree', () => {
  assert.ok(PLAN_SHAPES.includes('form'));
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
  assert.deepEqual([...SHAPES.form.layers], LAYERS, 'the six layers of a vertical slice');
  for (const [layer, needed] of Object.entries(SHAPES.form.requires)) assert.ok(needed.every((l) => SHAPES.form.layers.includes(l)), `${layer} requires only layers of the shape`);
  assert.deepEqual([...PLAYWRIGHT_SHAPES], ['list'], 'only the list shape has a browser flow so far');
});

test('the names: the entity of a form is its unit name without the write verb, the endpoint is the plural of the entity', () => {
  const dir = project();
  const ctx = (request) => shapeContext(dir, { feature: 'shop', shape: 'form', ...request });
  assert.equal(ctx({ name: 'AddProduct' }).request.entity, 'Product', 'the entity of a form is its unit name without the write verb');
  assert.equal(ctx({ name: 'RegisterSubscriptionPlan' }).request.entity, 'SubscriptionPlan');
  assert.equal(ctx({ name: 'AddCategory' }).endpoint, '/api/categories');
  assert.equal(ctx({ name: 'AddProduct' }).endpoint, '/api/products');
  const f = ctx({ name: 'AddProduct' }).names;
  assert.deepEqual([f.hook, f.validate, f.submit, f.state, f.values, f.errors, f.input, f.form, f.field, f.again], ['useAddProduct', 'validateAddProduct', 'submitAddProduct', 'AddProductState', 'AddProductValues', 'AddProductErrors', 'ProductInput', 'AddProductForm', 'AddProductField', 'AddProductAgain']);
});

test('the same request gives the same files, byte for byte, and each file is built with the factory of its layer', () => {
  const dir = project();
  const first = LAYERS.flatMap((layer) => shapeFiles(dir, { ...FORM, layer }));
  assert.deepEqual(first, LAYERS.flatMap((layer) => shapeFiles(dir, { ...FORM, layer })), 'the same request, the same files');
  assert.deepEqual(first.map((f) => path.basename(f.path)), ['AddProduct.domain.ts', 'types.ts', 'AddProduct.service.ts', 'useAddProduct.state.ts', 'AddProductField.component.tsx', 'AddProductForm.component.tsx', 'AddProductNotice.component.tsx', 'AddProductAgain.component.tsx', 'AddProductPage.page.tsx', 'AddProductByStatus.expression.tsx', 'AddProductController.controller.tsx']);
  assert.deepEqual(first.filter((f) => f.change === 'modify').map((f) => path.basename(f.path)), ['types.ts']);
  assert.ok(first.every((f) => !/\bTODO\b|\{\{|\[object Object\]|\bNaN\b/.test(f.content)), 'no stub and no placeholder');
  for (const [pattern, file] of [[/defineDomain</, '.domain.ts'], [/defineService\(/, '.service.ts'], [/useTrackedState</, '.state.ts'], [/defineComponent</, '.component.tsx'], [/defineExpression</, '.expression.tsx'], [/definePage</, '.page.tsx'], [/defineController</, '.controller.tsx']]) {
    const hit = first.filter((f) => f.path.endsWith(file));
    assert.ok(hit.length && hit.every((f) => pattern.test(f.content)), `${file} uses its factory`);
  }
  assert.deepEqual(shapeTouches(dir, { ...FORM, layer: 'domain' }).map((f) => `${f.change} ${f.path}`), ['create features/shop/domain/AddProduct.domain.ts', 'modify features/shop/types.ts'], 'touches are derived from the same files');
  assert.doesNotMatch(shapeFiles(dir, { ...FORM, layer: 'page' }).map((f) => f.content).join('\n'), /use client/, 'a page stays presentational');
  assert.ok(shapeFiles(project('nextjs'), { ...FORM, layer: 'hook' })[0].content.startsWith("'use client';\n"), 'a Next.js hook is a client file');
});

test('a plan step of a form declares its files (touches derived), and its command is the one the plan runner runs', () => {
  const dir = project();
  const step = (flow, args) => ({ id: 's1', title: 'x', flow, args, executor: 'deterministic', touches: { features: [], files: [] } });
  const unit = step('create.unit', { layer: 'hook', name: 'AddProduct', feature: 'shop', shape: 'form', entity: 'Product', fields: 'id:string,name:string' });
  assert.deepEqual(expectedFiles(dir, 'create.unit', unit.args).map((f) => f.path), ['features/shop/hooks/useAddProduct.state.ts']);
  assert.deepEqual(planToCommand(unit).argv, ['create', 'hook', 'AddProduct', '--feature', 'shop', '--shape', 'form', '--entity', 'Product', '--fields', 'id:string,name:string']);
  const layer = step('create.layer', { name: 'AddProduct', feature: 'shop', layers: ['domain'], shape: 'form' });
  assert.equal(validatePlan({ version: 1, ticket: { source: 'text', title: 'x' }, steps: [layer] }).valid, true, 'the schema accepts it');
});

test('the fields shape the templates: a number, a boolean, a camelCase name; and a form has an input for every field but the id', () => {
  const dir = project();
  const at = (fields, layer) => Object.fromEntries(shapeFiles(dir, { ...FORM, fields, layer }).map((f) => [path.basename(f.path), f.content]));
  const fields = 'id:number,unitPrice:number,isActive:boolean,title:string';
  const domain = at(fields, 'domain');
  assert.match(domain['AddProduct.domain.ts'], /values\.unitPrice\.trim\(\) === ''\) errors\.unitPrice = 'Unit price is required\.'/);
  assert.match(domain['AddProduct.domain.ts'], /else if \(!Number\.isFinite\(Number\(values\.unitPrice\)\)\) errors\.unitPrice = 'Unit price must be a number\.'/);
  assert.match(domain['AddProduct.domain.ts'], /values\.title\.trim\(\) === ''\) errors\.title = 'Title is required\.'/);
  assert.doesNotMatch(domain['AddProduct.domain.ts'], /isActive\.trim|errors\.isActive|errors\.id/, 'a yes or no field needs no check, and the id is not a field of the form');
  assert.match(domain['AddProduct.domain.ts'], /return \{ ok: true, input: \{ unitPrice: Number\(values\.unitPrice\), isActive: values\.isActive, title: values\.title\.trim\(\) \} \}/);
  assert.match(domain['types.ts'], /export interface ProductInput \{\n {2}unitPrice: number;\n {2}isActive: boolean;\n {2}title: string;\n\}/);
  assert.match(domain['types.ts'], /export interface AddProductValues \{\n {2}unitPrice: string;\n {2}isActive: boolean;\n {2}title: string;\n\}/);
  const form = at(fields, 'component')['AddProductForm.component.tsx'];
  assert.match(form, /<input id="add-product-unit-price" name="unitPrice" type="number" step="any" value=\{values\.unitPrice\}/);
  assert.match(form, /<input id="add-product-is-active" name="isActive" type="checkbox" checked=\{values\.isActive\}/);
  assert.match(form, /<input id="add-product-title" name="title" type="text" value=\{values\.title\}/);
  assert.doesNotMatch(form, /name="id"/);
  assert.match(at(fields, 'hook')['useAddProduct.state.ts'], /const EMPTY: AddProductValues = \{ unitPrice: '', isActive: false, title: '' \};/);
});

test('a bad request is a usage error that names the problem, before anything is written', () => {
  const dir = project();
  const before = featureTree(dir);
  const refused = (request, message) => assert.throws(() => generateShapeVertical(dir, { ...request }, LAYERS), message, JSON.stringify(request));
  refused({ ...FORM, fields: 'id:string' }, /needs at least one field besides "id"/);
  refused({ ...FORM, name: 'Product' }, /clashing names/);
  assert.throws(() => generateShapeVertical(dir, FORM, ['hook', 'page']), /--layers domain,service,hook,component,page/);
  assert.deepEqual(featureTree(dir), before, 'nothing was written by any of them');
  assert.equal(shapeTouches(dir, { ...FORM, layer: 'domain', fields: 'id:string' }), null, 'touches never throws');
  const cli = run(['create', 'layer', 'AddProduct', '--feature', 'shop', '--layers', 'domain', '--shape', 'form', '--fields', 'id:string'], dir);
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /at least one field besides "id"/);
});

test('construct create --shape form writes the whole screen, and its usage names the shape', () => {
  const dir = project();
  const form = run(['create', 'layer', 'AddProduct', '--feature', 'shop', '--layers', LAYERS.join(','), '--shape', 'form', '--fields', 'id:string,name:string,price:number', '--format', 'json'], dir);
  assert.equal(form.status, 0, form.stderr);
  assert.equal(JSON.parse(form.stdout).files.length, 11, 'eleven files, types.ts among them');
  const usage = run(['--help'], dir);
  const text = `${usage.stdout}${usage.stderr}`;
  assert.match(text, /--shape list\|detail\|form/);
  assert.match(text, /form = a typed input per field/);
});

// ------------------------------------------------------------------------------------------------- the offer

test('a write with properties is offered form | scaffold by fixed rules, and the rules that say no', () => {
  for (const text of [SENTENCE, 'A user wants to save a product', 'A user wants to update a product with a name and a price', 'A user wants to register a product', 'A customer wants to create a product', 'A user adds a product']) {
    const { offers, open, complete } = placed(text);
    assert.equal(complete, true, `${text}: the offer never holds the plan back`);
    assert.deepEqual(open, [], text);
    assert.equal(offers.length, 1, text);
    assert.deepEqual(offers[0].options.map((o) => o.id), ['form', 'scaffold'], text);
    assert.deepEqual([offers[0].id, offers[0].shape, offers[0].default, offers[0].suggestion.option, offers[0].suggestion.provider], ['q-shape', 'form', 'form', 'form', 'rules'], text);
    assert.ok(offers[0].options.every((o) => o.enabled && o.label.length <= 60 && o.why.length <= 120), 'a chooser summary: capped text');
  }
  assert.deepEqual(SHAPE_OPTIONS_BY_SHAPE.form.map((o) => o.id), ['form', 'scaffold']);
  const no = [
    'A user wants to delete a product', // a write that is not a form verb
    'A user wants to create an account', // a data object without properties
    'A user wants to add products', // plural: a batch, not one item
    'A user wants to click a button to save a product', // it needs the browser: a client leaf
    'A user wants to register', // no data object at all: an open question
    'A user wants to manage a product', // manage is not a form verb
    'A user wants to add a product and see an order', // two verbs, two data objects
  ];
  for (const text of no) assert.deepEqual(placed(text).offers, [], text);
  assert.deepEqual(placed(SENTENCE, { screen: 'Catalog' }).offers, [], "a screen named otherwise is not the shape's unit name");
});

test('the lexicon knows add, register, name and price: the example sentences parse with no open question', () => {
  for (const text of [SENTENCE, 'A user wants to register a product']) {
    const { card, open } = parseRequirement(text);
    assert.deepEqual([open, card.open], [[], []], text);
  }
  const add = cardOf(SENTENCE);
  assert.deepEqual(add.verbs.map((v) => [v.text, v.kind]), [['add', 'write']]);
  assert.deepEqual(add.nouns.map((n) => [n.text, n.kind]), [['product', 'entity'], ['name', 'ui-part'], ['price', 'ui-part']]);
});

test('answering the offer applies the shape to the blocks, records who decided, and a wrong option for the card is refused', async () => {
  const first = placed(SENTENCE);
  const [offer] = first.offers;
  const suggestion = await suggest({ id: offer.id, question: offer.question, options: offer.options });
  assert.equal(suggestion.option, 'form', 'the rules-only decision provider suggests the matching shape');
  const answered = placed(SENTENCE, { answers: { 'q-shape': { option: suggestion.option, by: 'decision-model', provider: suggestion.provider } } });
  assert.deepEqual(answered.errors, []);
  assert.deepEqual(answered.blocks.map((b) => [b.id, b.placement, b.layers.map((l) => `${l.layer}:${l.name}`)]), [['b1', 'mutation', ['domain:AddProduct', 'service:AddProduct', 'hook:AddProduct', 'controller:AddProduct']], ['b1-view', 'presentational', ['component:AddProduct', 'page:AddProduct']]]);
  assert.ok(answered.blocks.every((b) => b.shape.name === 'form' && b.shape.entity === 'Product' && b.shape.fields === 'id:string,name:string,price:number'));
  assert.deepEqual(answered.decisions, [{ question: 'q-shape', option: 'form', by: 'decision-model', provider: 'rules' }]);
  assert.equal(answered.offers[0].chosen, 'form');
  assert.equal(offer.unit, 'AddProduct');
  assert.match(answered.notes[1], /The form shape POSTs the typed values to \/api\/products/);
  assert.match(answered.notes[1], /The plan wires the route entry, runs sync/);
  const scaffold = placed(SENTENCE, { answers: { 'q-shape': 'scaffold' } });
  assert.deepEqual(scaffold.blocks, first.blocks, 'choosing the scaffold is the plain plan');
  assert.deepEqual(scaffold.decisions, [{ question: 'q-shape', option: 'scaffold', by: 'person' }]);
  for (const other of ['list', 'detail']) assert.deepEqual(placed(SENTENCE, { answers: { 'q-shape': other } }).errors.map((e) => e.code), ['PLACE_UNKNOWN_OPTION'], `${other} is not an option of this card`);
  assert.deepEqual(blockSummary(first).offers.map((o) => [o.id, o.chosen, o.default]), [['q-shape', null, 'form']]);
  assert.deepEqual(blockSummary(placed('A user wants to add a product', { answers: { 'q-shape': 'form' } })).lines, ['"add product" is a form that submits through a service (domain, service, hook, controller).', '"add product" shows that form from props (component, page).']);
});

test('a form plan carries the shape on every unit, is wired and proven, and plans no browser flow for it', () => {
  for (const playwright of [false, true]) {
    const dir = project();
    if (playwright) fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { testDir: 'features' };\n");
    const answered = placeCard(cardOf(SENTENCE), { framework: 'react-spa', answers: { 'q-shape': 'form' } });
    const planned = planFromBlocks(answered.blocks, { feature: 'add-product', root: dir, decisions: answered.decisions });
    assert.equal(planned.ok, true, JSON.stringify(planned.errors));
    assert.deepEqual(planned.plan.steps.map((s) => s.flow), ['create.feature', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'add.dependency', 'sync', 'create.route', 'create.proof', 'test.proof'], 'the wiring and the proof steps apply to every shape');
    assert.ok(planned.plan.steps.filter((s) => s.flow === 'create.unit').every((s) => s.args.shape === 'form' && s.args.name === 'AddProduct'));
    assert.deepEqual(planned.proof.steps.map((s) => s.kind), ['render'], 'the browser flow exists only for the list shape');
    if (playwright) assert.match(planned.proof.playwright.skipped, /No browser flow is planned for AddProduct \(form\)/);
  }
});

test('the proof of a form is the render proof; a Playwright flow is not written for it, and says why', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), "export default { testDir: 'features' };\n");
  const files = proofFiles(dir, { ...FORM, kind: 'render' });
  assert.deepEqual(files.map((f) => path.basename(f.path)), ['AddProductScreen.proof.test.ts']);
  assert.ok(files[0].content.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
  assert.equal(files[0].content, proofFiles(dir, { ...FORM, kind: 'render' })[0].content, 'a pure function of the request');
  assert.deepEqual(proofFiles(dir, { ...FORM, kind: 'playwright' }), []);
  assert.deepEqual(proofTouches(dir, { ...FORM, kind: 'playwright' }), []);
  const result = generateProof(dir, { ...FORM, kind: 'playwright' });
  assert.deepEqual([result.files, result.needs], [[], []]);
  assert.match(result.skipped, /The form shape has no Playwright flow yet \(only list does\)/);
});

test('the worked example in docs/PLACEMENT.md (form) is exactly what the code produces', () => {
  const doc = fs.readFileSync(new URL('../docs/PLACEMENT.md', import.meta.url), 'utf8');
  const block = (tag) => JSON.parse(new RegExp(`<!-- ${tag} -->\\n\`\`\`json\\n([\\s\\S]*?)\`\`\``).exec(doc)?.[1] ?? 'null');
  const dir = project();
  const card = cardOf(SENTENCE);
  const [offer] = placeCard(card, { framework: 'react-spa' }).offers;
  const answered = placeCard(card, { framework: 'react-spa', answers: { [offer.id]: { option: offer.default, by: 'decision-model', provider: 'rules' } } });
  const planned = planFromBlocks(answered.blocks, { feature: 'add-product', root: dir, decisions: answered.decisions });
  assert.deepEqual(block('form-shape-example:commands'), planned.plan.steps.map((step) => `construct ${planToCommand(step).argv.join(' ')}`), 'commands');
  assert.deepEqual(block('form-shape-example:files'), planned.files, 'files');
});

// ------------------------------------------------------------------------------ fields the proof and the templates must survive

test('a form with a boolean, a camelCase name and a number validates, type-checks and is proven', NEEDS_RUNTIME, () => {
  const fields = 'id:string,title:string,unitPrice:number,isActive:boolean';
  const dir = initProject('react-spa', 'form');
  assert.equal(run(['create', 'feature', 'add-item'], dir).status, 0);
  const args = ['--feature', 'add-item', '--shape', 'form', '--fields', fields];
  const layers = run(['create', 'layer', 'AddItem', ...args, '--layers', LAYERS.join(',')], dir);
  assert.equal(layers.status, 0, layers.stderr);
  const proof = run(['create', 'proof', 'AddItem', ...args], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  assert.equal(run(['sync'], dir).status, 0);
  assert.deepEqual(validateJson(dir).violations.filter((v) => v.file.startsWith('features/')).map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const tsc = typeCheck(dir, []);
  assert.equal(tsc.status, 0, tsc.output);
  const res = run(['test', 'proof', 'add-item', '--format', 'json'], dir);
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.equal(JSON.parse(res.stdout).counts.failed, 0);
});
