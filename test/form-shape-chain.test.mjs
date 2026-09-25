// #626 -- the whole Requirement chain for the FORM shape, run for real: the sentence "A user wants to add a product with a name and a price"
// goes through parseRequirement, placeCard (a write with properties is offered form | scaffold; the rules provider suggests form),
// planFromBlocks, and the plan's own commands (planToCommand, run through the CLI) in a fresh `construct init` project with the typed-contracts
// phase 1 rules ON. Then: `construct validate` reports no error and no warning, `tsc --noEmit` passes, the proof RUNS green
// (`construct test proof`: fields with labels, a message per invalid field, the stubbed submit called with typed values, the submitting,
// submitted and error states), and a deliberately broken page makes it FAIL with a message that names the state. A second run in a fresh
// project writes the same bytes. Same guard as test/list-shape-chain.test.mjs: a lane without react-dom skips with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { proofStatus } from '../packages/core/proof.mjs';
import { planTouches } from '../packages/core/plan.mjs';
import { NEEDS_RUNTIME, execute, featureFiles, initProject, planFor, projectFiles, run, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const SENTENCE = 'A user wants to add a product with a name and a price';
const plan = (dir) => planFor(dir, SENTENCE, 'add-product', 'form');
const FEATURE = 'features/add-product';

test('the sentence becomes a plan of 12 steps, runs, and gives a form screen that validates, type-checks, renders and is PROVEN', NEEDS_RUNTIME, async (t) => {
  const dir = initProject('react-spa', 'form');
  const { placed, planned, offer } = await plan(dir);
  assert.deepEqual(offer.options.map((o) => o.id), ['form', 'scaffold'], 'a write with properties is offered form | scaffold');
  assert.deepEqual([offer.shape, offer.default, offer.unit, offer.entity, offer.fields], ['form', 'form', 'AddProduct', 'Product', 'id:string,name:string,price:number']);
  assert.deepEqual(placed.decisions, [{ question: 'q-shape', option: 'form', by: 'decision-model', provider: 'rules' }], 'who decided is recorded');
  assert.deepEqual(planned.plan.steps.map((s) => s.title), ['Create feature add-product', 'Create domain AddProduct', 'Create service AddProduct', 'Create hook AddProduct', 'Create component AddProduct', 'Create page AddProduct', 'Create controller AddProduct', 'Add @line/construct-core to package.json', "Export the add-product feature's public API (sync)", 'Wire the AddProduct screen into the route entry (/add-product)', 'Prove the AddProduct screen', 'Run the proof of AddProduct']);
  assert.deepEqual(planned.plan.steps.slice(1, 7).map((s) => [s.args.shape, s.args.entity, s.args.fields]), Array(6).fill(['form', 'Product', 'id:string,name:string,price:number']), 'every unit carries the shape');
  assert.deepEqual(planned.wiring, { dependency: 's8', sync: 's9', routes: [{ name: 'AddProduct', route: '/add-product', step: 's10', file: 'src/App.tsx' }] }, 'the wiring step applies to a form plan too');
  assert.deepEqual(planned.proof.steps, [{ name: 'AddProduct', kind: 'render', proofStep: 's11', verifiedBy: 's12' }]);

  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const written = featureFiles(dir);
  const declared = planTouches(planned.plan).files.map((f) => f.path).sort();
  const after = projectFiles(dir);
  assert.deepEqual(Object.keys(after).filter((f) => after[f] !== before[f]).sort(), declared, 'every file the commands created or changed is a file the plan declared: nothing was done by hand');
  assert.equal(declared.length, 17, 'index.ts, the eleven files of the shape (types.ts among them), the proof, architecture.yml, package.json, .dependency-cruiser.cjs and src/App.tsx');

  await t.test('the files it wrote', () => {
    const files = Object.keys(written).filter((f) => f.startsWith(`${FEATURE}/`)).map((f) => f.slice(FEATURE.length + 1));
    assert.deepEqual(files.filter((f) => f !== 'index.ts').sort(), ['components/AddProductAgain.component.tsx', 'components/AddProductField.component.tsx', 'components/AddProductForm.component.tsx', 'components/AddProductNotice.component.tsx', 'controllers/AddProductController.controller.tsx', 'domain/AddProduct.domain.ts', 'expressions/AddProductByStatus.expression.tsx', 'hooks/useAddProduct.state.ts', 'pages/AddProductPage.page.tsx', 'services/AddProduct.service.ts', 'tests/generated/AddProductScreen.proof.test.ts', 'types.ts']);
    assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
    const at = (f) => written[`${FEATURE}/${f}`];
    assert.match(at('domain/AddProduct.domain.ts'), /defineDomain<AddProductValues, AddProductValidation>\('validateAddProduct'/);
    assert.match(at('domain/AddProduct.domain.ts'), /errors\.price = 'Price must be a number\.'/);
    assert.match(at('services/AddProduct.service.ts'), /defineService\('submitAddProduct', async \(\{ input, signal \}/);
    assert.match(at('services/AddProduct.service.ts'), /method: 'POST'.*body: JSON\.stringify\(input\), signal/);
    assert.match(at('hooks/useAddProduct.state.ts'), /useTrackedState<AddProductState>/);
    assert.match(at('components/AddProductForm.component.tsx'), /<input id="add-product-price" name="price" type="number"/);
    assert.match(at('pages/AddProductPage.page.tsx'), /definePage</);
    assert.match(at('expressions/AddProductByStatus.expression.tsx'), /defineExpression</);
    assert.match(at('controllers/AddProductController.controller.tsx'), /defineController</);
    assert.match(at('types.ts'), /export interface ProductInput \{\n {2}name: string;\n {2}price: number;\n\}/, 'the typed values: no id, the server assigns it');
    assert.match(at('types.ts'), /export interface AddProductValues \{\n {2}name: string;\n {2}price: string;\n\}/, 'what is typed is text');
  });

  await t.test('the route entry and the barrel were wired by the plan', () => {
    assert.match(fs.readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8'), /<Route path="\/add-product" element=\{<AddProductController \/>\} \/>/);
    assert.match(fs.readFileSync(path.join(dir, 'features', 'add-product', 'index.ts'), 'utf8'), /AddProductController/);
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

  const proofRun = (name) => run(['test', 'proof', 'add-product', '--format', 'json', ...(name ? ['--name', name] : [])], dir);

  await t.test('the proof passes: node --test on the generated screen, no browser, and the chain is complete', () => {
    const res = proofRun();
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const result = JSON.parse(res.stdout);
    assert.deepEqual(result.counts, { total: 13, passed: 13, failed: 0, notRun: 0 });
    assert.deepEqual(result.tests.map((x) => x.title.replace(/^AddProduct /, '')), ['screen: every field with its label and a typed input', 'domain: valid values give the typed values', 'domain: invalid values give a message per field', 'domain: a blank number is required, not zero', 'screen: a message beside each invalid field', 'screen: the submitting state disables the form', 'screen: the submitted state', 'screen: the error state, with role alert, keeps what was typed', 'controller: renders the editing state first', 'service: the stubbed submit is called with the typed values', 'service: a 500 is an error result', 'service: a network failure is an error result', "service: the caller's AbortSignal reaches fetch"]);
    assert.deepEqual(result.chain, proofStatus([{ id: 'proof', result: { ok: true, counts: result.counts } }]));
    assert.equal(result.chain.complete, true);
  });

  await t.test('the proof file: locked, named Name.layer.ext, from the entity fields, and a person can read it', () => {
    const file = path.join(dir, 'features', 'add-product', 'tests', 'generated', 'AddProductScreen.proof.test.ts');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
    for (const want of ['const TYPED: ProductInput = { name: "name 1", price: 12.5 };', '"Price must be a number."', "expectShown('The field ' + id", 'the stubbed submit is called with the typed values', "JSON.parse(String(call.body)), TYPED"]) assert.ok(text.includes(want), want);
    const gen = run(['create', 'proof', 'AddProduct', '--feature', 'add-product', '--shape', 'form', '--entity', 'Product', '--fields', 'id:string,name:string,price:number'], dir);
    assert.equal(gen.status, 0, `${gen.stdout}${gen.stderr}`);
    assert.equal(fs.readFileSync(file, 'utf8'), text, 'regenerating writes the same bytes');
  });

  await t.test('a broken screen FAILS the proof, and the message names the state that is wrong', () => {
    const expression = path.join(dir, 'features', 'add-product', 'expressions', 'AddProductByStatus.expression.tsx');
    const domain = path.join(dir, 'features', 'add-product', 'domain', 'AddProduct.domain.ts');
    const cases = [
      // The saving notice is announced with the wrong text: the page shows the plain editing form while it is submitting.
      { file: expression, from: 'text="Saving..."', to: 'text="Please wait"', titles: ['AddProduct screen: the submitting state disables the form'], state: ['submitting', 'editing'], summary: 'The form given status submitting: the submitting state is wrong, the screen shows editing.' },
      // The submitted branch is gone: the page reads values that a submitted state does not have, and crashes.
      { file: expression, from: "  if (state.status === 'submitted') return <>{children}</>;\n", to: '', titles: ['AddProduct screen: the submitted state'], state: ['submitted', 'crashed'], summary: 'The form given status submitted: the submitted state is wrong, the screen shows crashed.' },
      // The number check is gone: a text that is not a number passes the check.
      { file: domain, from: "  else if (!Number.isFinite(Number(values.price))) errors.price = 'Price must be a number.';\n", to: '', titles: ['AddProduct domain: invalid values give a message per field'], state: ['invalid', 'valid'], summary: 'The check of the price field: the invalid state is wrong, the screen shows valid.' },
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
        assert.deepEqual([own.failure.expected, own.failure.reached], c.state);
        if (c.summary) assert.equal(own.failure.summary, c.summary);
        assert.equal(result.chain.complete, false);
      } finally {
        fs.writeFileSync(c.file, good);
      }
    }
    assert.equal(proofRun().status, 0, 'and the proof is green again once the screen is');
  });

  await t.test('a file the proof binds to gone is a CONVENTION failure, not a product bug', () => {
    const page = path.join(dir, 'features', 'add-product', 'pages', 'AddProductPage.page.tsx');
    fs.renameSync(page, `${page}.off`);
    try {
      const result = JSON.parse(proofRun().stdout);
      assert.equal(result.tests[0].failure.kind, 'convention');
      assert.match(result.tests[0].failure.selector, /AddProductPage\.page/);
    } finally {
      fs.renameSync(`${page}.off`, page);
    }
    assert.equal(proofRun().status, 0);
  });

  await t.test('the screen renders: editing, invalid, submitting, submitted and error; and the check gives typed values', async () => {
    const { build } = await import('esbuild');
    fs.mkdirSync(path.join(dir, 'smoke'));
    fs.writeFileSync(path.join(dir, 'smoke', 'entry.tsx'), [
      "import { renderToString } from 'react-dom/server';",
      "import { AddProductPage } from '../features/add-product/pages/AddProductPage.page';",
      "import { validateAddProduct } from '../features/add-product/domain/AddProduct.domain';",
      "import type { AddProductState } from '../features/add-product/types';",
      'const noop = () => {};',
      'export const page = (state: AddProductState) => renderToString(<AddProductPage state={state} onChange={noop} onSubmit={noop} onReset={noop} />);',
      'export { validateAddProduct };',
    ].join('\n'));
    const reactDir = fs.realpathSync(path.join(dir, 'node_modules', 'react'));
    await build({ entryPoints: [path.join(dir, 'smoke', 'entry.tsx')], outfile: path.join(dir, 'smoke', 'entry.cjs'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', alias: { react: reactDir }, absWorkingDir: dir, logLevel: 'silent' });
    const screen = createRequire(import.meta.url)(path.join(dir, 'smoke', 'entry.cjs'));
    const field = (id, label, type, extra, value, message = '') => `<div><label for="add-product-${id}">${label}</label><input id="add-product-${id}" type="${type}"${extra ? ` ${extra}` : ''} name="${id}" value="${value}"/><span id="add-product-${id}-error" aria-live="polite">${message}</span></div>`;
    const inputs = (values, disabled, invalid, messages = {}) => [field('name', 'Name', 'text', `${disabled ? 'disabled="" ' : ''}aria-invalid="${invalid.name}"`.trim(), values.name, messages.name), field('price', 'Price', 'number', `step="any" ${disabled ? 'disabled="" ' : ''}aria-invalid="${invalid.price}"`.trim(), values.price, messages.price)].join('');
    const form = (body, disabled) => `<form noValidate="">${body}<button type="submit"${disabled ? ' disabled=""' : ''}>Add product</button></form>`;
    const empty = { name: '', price: '' };
    assert.equal(screen.page({ status: 'editing', values: empty, errors: {} }), `<main><h1>Add product</h1>${form(inputs(empty, false, { name: false, price: false }))}</main>`);
    const bad = { name: '', price: 'abc' };
    const errors = { name: 'Name is required.', price: 'Price must be a number.' };
    assert.equal(screen.page({ status: 'editing', values: bad, errors }), `<main><h1>Add product</h1>${form(inputs(bad, false, { name: true, price: true }, errors))}</main>`, 'a message beside each invalid field');
    const apple = { name: 'Apple', price: '1.5' };
    assert.equal(screen.page({ status: 'submitting', values: apple }), `<main><h1>Add product</h1><p role="status">Saving...</p>${form(inputs(apple, true, { name: false, price: false }), true)}</main>`);
    assert.equal(screen.page({ status: 'submitted' }), '<main><h1>Add product</h1><p role="status">Product added.</p><button type="button">Add another</button></main>');
    assert.equal(screen.page({ status: 'error', values: apple, message: 'The server answered 500.' }), `<main><h1>Add product</h1><p role="alert">The server answered 500.</p>${form(inputs(apple, false, { name: false, price: false }))}</main>`, 'the error keeps what was typed');
    assert.deepEqual(screen.validateAddProduct({ name: ' Apple ', price: ' 1.5 ' }), { ok: true, input: { name: 'Apple', price: 1.5 } }, 'typed: trimmed text, a number');
    assert.deepEqual(screen.validateAddProduct(empty), { ok: false, errors: { name: 'Name is required.', price: 'Price is required.' } });
    assert.deepEqual(screen.validateAddProduct({ name: 'x', price: 'abc' }), { ok: false, errors: { price: 'Price must be a number.' } });
  });

  await t.test('a second run in a fresh project writes the same bytes', async () => {
    const other = initProject('react-spa', 'form');
    const again = await plan(other);
    assert.deepEqual(again.planned.plan, planned.plan, 'the same plan');
    execute(other, again.planned.plan);
    assert.deepEqual(featureFiles(other), written, 'the proof included');
    for (const f of ['src/App.tsx', '.dependency-cruiser.cjs', 'architecture.yml']) assert.equal(fs.readFileSync(path.join(other, f), 'utf8'), fs.readFileSync(path.join(dir, f), 'utf8'), `${f} too`);
  });
});

test('the same form plan on a Next.js project validates too, and its hook and controller are client files', NEEDS_RUNTIME, async () => {
  const dir = initProject('nextjs', 'form');
  const { planned } = await plan(dir);
  assert.deepEqual(planned.wiring.routes, [{ name: 'AddProduct', route: '/add-product', step: 's10', file: 'app/add-product/page.tsx' }]);
  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const after = projectFiles(dir);
  assert.deepEqual([...Object.keys(after), ...Object.keys(before)].filter((f, i, all) => all.indexOf(f) === i && after[f] !== before[f]).sort(), planTouches(planned.plan).files.map((f) => f.path).sort(), 'no file changed that the plan did not declare');
  assert.equal(after['app/add-product/page.tsx'], "import { AddProductController } from '../../features/add-product/controllers/AddProductController.controller';\n\nexport default function Page() {\n  return <AddProductController />;\n}\n", 'the route entry renders the controller and nothing else');
  assert.deepEqual(validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const files = featureFiles(dir);
  assert.ok(files['features/add-product/controllers/AddProductController.controller.tsx'].startsWith("'use client';"));
  assert.ok(files['features/add-product/hooks/useAddProduct.state.ts'].startsWith("'use client';"));
  const proof = run(['test', 'proof', 'add-product', '--format', 'json'], dir);
  assert.equal(proof.status, 0, 'the proof of the same screen passes on a Next.js project');
  assert.equal(JSON.parse(proof.stdout).counts.failed, 0);
  const tsc = typeCheck(dir, ['app/add-product/page.tsx']);
  assert.equal(tsc.status, 0, tsc.output);
});
