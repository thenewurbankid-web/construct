// #620 -- the whole Requirement chain for the DETAIL shape, run for real: the sentence "A user wants to see the details of a product" goes
// through parseRequirement, placeCard (a read of ONE item is offered detail | scaffold; the rules provider suggests detail),
// planFromBlocks, and the plan's own commands (planToCommand, run through the CLI) in a fresh `construct init` project with the typed-contracts
// phase 1 rules ON. Then: `construct validate` reports no error and no warning, `tsc --noEmit` passes, the proof RUNS green
// (`construct test proof`), and a deliberately broken page makes it FAIL with a message that names the state. A second run in a fresh
// project writes the same bytes. Same guard as test/list-shape-chain.test.mjs: a lane without react-dom skips with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { proofStatus } from '../packages/core/proof.mjs';
import { planTouches } from '../packages/core/plan.mjs';
import { NEEDS_RUNTIME, execute, featureFiles, initProject, planFor, projectFiles, run, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const SENTENCE = 'A user wants to see the details of a product';
const plan = (dir) => planFor(dir, SENTENCE, 'product', 'detail');

test('the sentence becomes a plan of 12 steps, runs, and gives a detail screen that validates, type-checks, renders and is PROVEN', NEEDS_RUNTIME, async (t) => {
  const dir = initProject('react-spa', 'detail');
  const { placed, planned, offer } = await plan(dir);
  assert.deepEqual(offer.options.map((o) => o.id), ['detail', 'scaffold'], 'a read of one item is offered detail | scaffold');
  assert.deepEqual([offer.shape, offer.default, offer.unit, offer.entity, offer.fields], ['detail', 'detail', 'Product', 'Product', 'id:string,name:string,price:number']);
  assert.deepEqual(placed.decisions, [{ question: 'q-shape', option: 'detail', by: 'decision-model', provider: 'rules' }], 'who decided is recorded');
  assert.deepEqual(planned.plan.steps.map((s) => s.title), ['Create feature product', 'Create domain Product', 'Create service Product', 'Create hook Product', 'Create component Product', 'Create page Product', 'Create controller Product', 'Add @line/construct-core to package.json', "Export the product feature's public API (sync)", 'Wire the Product screen into the route entry (/product)', 'Prove the Product screen', 'Run the proof of Product']);
  assert.deepEqual(planned.plan.steps.slice(1, 7).map((s) => [s.args.shape, s.args.entity, s.args.fields]), Array(6).fill(['detail', 'Product', 'id:string,name:string,price:number']), 'every unit carries the shape');
  assert.deepEqual(planned.wiring, { dependency: 's8', sync: 's9', routes: [{ name: 'Product', route: '/product', step: 's10', file: 'src/App.tsx' }] }, 'the wiring step applies to a detail plan too');
  assert.deepEqual(planned.proof.steps, [{ name: 'Product', kind: 'render', proofStep: 's11', verifiedBy: 's12' }]);
  assert.match(planned.notes[0], /^Playwright is not configured/);

  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const written = featureFiles(dir);
  const declared = planTouches(planned.plan).files.map((f) => f.path).sort();
  const after = projectFiles(dir);
  assert.deepEqual(Object.keys(after).filter((f) => after[f] !== before[f]).sort(), declared, 'every file the commands created or changed is a file the plan declared: nothing was done by hand');
  assert.equal(declared.length, 16, 'index.ts, the ten files of the shape (types.ts among them), the proof, architecture.yml, package.json, .dependency-cruiser.cjs and src/App.tsx');

  await t.test('the files it wrote', () => {
    const files = Object.keys(written).filter((f) => f.startsWith('features/product/')).map((f) => f.slice('features/product/'.length));
    assert.deepEqual(files.filter((f) => f !== 'index.ts').sort(), ['components/ProductDetailRow.component.tsx', 'components/ProductDetails.component.tsx', 'components/ProductNotice.component.tsx', 'controllers/ProductController.controller.tsx', 'domain/Product.domain.ts', 'expressions/ProductByStatus.expression.tsx', 'hooks/useProduct.state.ts', 'pages/ProductPage.page.tsx', 'services/Product.service.ts', 'tests/generated/ProductScreen.proof.test.ts', 'types.ts']);
    assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
    const at = (f) => written[`features/product/${f}`];
    assert.match(at('domain/Product.domain.ts'), /defineDomain</);
    assert.match(at('services/Product.service.ts'), /defineService\('fetchProduct', async \(\{ id, signal \}/);
    assert.match(at('services/Product.service.ts'), /response\.status === 404\) return \{ status: 'not-found' \}/);
    assert.match(at('hooks/useProduct.state.ts'), /useTrackedState<ProductDetailState>/);
    assert.match(at('hooks/useProduct.state.ts'), /new URLSearchParams\(window\.location\.search\)\.get\('id'\)/, 'the id is the argument, else ?id= of the address');
    assert.match(at('components/ProductDetailRow.component.tsx'), /defineComponent</);
    assert.match(at('pages/ProductPage.page.tsx'), /definePage</);
    assert.match(at('expressions/ProductByStatus.expression.tsx'), /defineExpression</);
    assert.match(at('controllers/ProductController.controller.tsx'), /defineController</);
    assert.match(at('types.ts'), /export type ProductDetailState =\n {2}\| \{ status: 'loading' \}\n {2}\| \{ status: 'not-found' \}\n {2}\| \{ status: 'ready'; item: Product; rows: ProductDetailEntry\[\] \}\n {2}\| \{ status: 'error'; message: string \};/);
  });

  await t.test('the route entry and the barrel were wired by the plan', () => {
    assert.match(fs.readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8'), /<Route path="\/product" element=\{<ProductController \/>\} \/>/);
    assert.match(fs.readFileSync(path.join(dir, 'features', 'product', 'index.ts'), 'utf8'), /ProductController/);
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

  const proofRun = (name) => run(['test', 'proof', 'product', '--format', 'json', ...(name ? ['--name', name] : [])], dir);

  await t.test('the proof passes: node --test on the generated screen, no browser, and the chain is complete', () => {
    const res = proofRun();
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const result = JSON.parse(res.stdout);
    assert.deepEqual(result.counts, { total: 12, passed: 12, failed: 0, notRun: 0 });
    assert.deepEqual(result.tests.map((x) => x.title.replace(/^Product /, '')), ['screen: the loading state', 'screen: the not-found state', 'screen: the ready state, with every field label and value', 'screen: the error state, with role alert', 'controller: renders the loading state first', 'domain: one line per field, in order', 'service: a good answer is the item', 'service: a 404 is not found', 'service: a 500 is an error result', 'service: a wrong shape is an error result', 'service: a network failure is an error result', "service: asks for the item by its id, and the caller's AbortSignal reaches fetch"]);
    assert.deepEqual(result.chain, proofStatus([{ id: 'proof', result: { ok: true, counts: result.counts } }]));
    assert.equal(result.chain.complete, true);
  });

  await t.test('the proof file: locked, named Name.layer.ext, from the entity fields, and a person can read it', () => {
    const file = path.join(dir, 'features', 'product', 'tests', 'generated', 'ProductScreen.proof.test.ts');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
    for (const want of ['{ id: "product-1", name: "Product name 1", price: 12.5 }', '"<dt>Price</dt>", "<dd>12.5</dd>"', 'role=\"alert\"', 'a 404 is not found', 'asks for the item by its id', '/api/products/a%20b%2Fc']) assert.ok(text.includes(want), want);
    const gen = run(['create', 'proof', 'Product', '--feature', 'product', '--shape', 'detail', '--entity', 'Product', '--fields', 'id:string,name:string,price:number'], dir);
    assert.equal(gen.status, 0, `${gen.stdout}${gen.stderr}`);
    assert.equal(fs.readFileSync(file, 'utf8'), text, 'regenerating writes the same bytes');
  });

  await t.test('a broken page FAILS the proof, and the message names the state that is wrong', () => {
    const expression = path.join(dir, 'features', 'product', 'expressions', 'ProductByStatus.expression.tsx');
    const good = fs.readFileSync(expression, 'utf8');
    const cases = [
      // The loading notice is announced as an alert: the page shows the error state while it is still loading.
      { from: 'role="status" text="Loading product..."', to: 'role="alert" text="Loading product..."', titles: ['Product screen: the loading state', 'Product controller: renders the loading state first'], state: ['loading', 'error'], summary: 'The page given status loading: the loading state is wrong, the screen shows error.' },
      // The not-found branch is gone: the page reads rows that a not-found state does not have, and crashes.
      { from: "  if (state.status === 'not-found') return <>{children}</>;\n", to: '', titles: ['Product screen: the not-found state'], state: ['not-found', 'crashed'], summary: 'The page given status not-found: the not-found state is wrong, the screen shows crashed.' },
    ];
    for (const c of cases) {
      const broken = good.replace(c.from, c.to);
      assert.notEqual(broken, good, `the branch was there: ${c.from}`);
      fs.writeFileSync(expression, broken);
      try {
        const res = proofRun();
        assert.equal(res.status, 1, 'exit 1: the proof ran and failed');
        const result = JSON.parse(res.stdout);
        const failed = result.tests.filter((x) => x.status === 'failed');
        assert.deepEqual(failed.map((x) => x.title), c.titles);
        assert.equal(failed[0].failure.kind, 'app', 'the app behaved differently: not a harness problem');
        assert.deepEqual([failed[0].failure.expected, failed[0].failure.reached], c.state);
        assert.equal(failed[0].failure.summary, c.summary);
        assert.equal(result.chain.complete, false);
        assert.deepEqual(result.summary.options.map((o) => o.id), ['edit-code', 'fill-with-ai', 'skip-proof'], 'the two exits every block has, and an explicit skip');
      } finally {
        fs.writeFileSync(expression, good);
      }
    }
    assert.equal(proofRun().status, 0, 'and the proof is green again once the page is');
  });

  await t.test('a file the proof binds to gone is a CONVENTION failure, not a product bug', () => {
    const page = path.join(dir, 'features', 'product', 'pages', 'ProductPage.page.tsx');
    fs.renameSync(page, `${page}.off`);
    try {
      const result = JSON.parse(proofRun().stdout);
      assert.equal(result.tests[0].failure.kind, 'convention');
      assert.match(result.tests[0].failure.selector, /ProductPage\.page/);
    } finally {
      fs.renameSync(`${page}.off`, page);
    }
    assert.equal(proofRun().status, 0);
  });

  await t.test('the screen renders: loading, not found, the item with every field, and error', async () => {
    const { build } = await import('esbuild');
    fs.mkdirSync(path.join(dir, 'smoke'));
    fs.writeFileSync(path.join(dir, 'smoke', 'entry.tsx'), [
      "import { renderToString } from 'react-dom/server';",
      "import { ProductPage } from '../features/product/pages/ProductPage.page';",
      "import { describeProduct } from '../features/product/domain/Product.domain';",
      "import type { ProductDetailState } from '../features/product/types';",
      'export const page = (state: ProductDetailState) => renderToString(<ProductPage state={state} />);',
      'export { describeProduct };',
    ].join('\n'));
    const reactDir = fs.realpathSync(path.join(dir, 'node_modules', 'react'));
    await build({ entryPoints: [path.join(dir, 'smoke', 'entry.tsx')], outfile: path.join(dir, 'smoke', 'entry.cjs'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', alias: { react: reactDir }, absWorkingDir: dir, logLevel: 'silent' });
    const screen = createRequire(import.meta.url)(path.join(dir, 'smoke', 'entry.cjs'));
    const item = { id: 'p1', name: 'Apple', price: 1.5 };
    assert.equal(screen.page({ status: 'loading' }), '<main><h1>Product details</h1><p role="status">Loading product...</p></main>');
    assert.equal(screen.page({ status: 'not-found' }), '<main><h1>Product details</h1><p role="status">Product not found.</p></main>');
    assert.equal(screen.page({ status: 'error', message: 'The server answered 500.' }), '<main><h1>Product details</h1><p role="alert">The server answered 500.</p></main>');
    assert.equal(screen.page({ status: 'ready', item, rows: screen.describeProduct({ item }) }), '<main><h1>Product details</h1><dl aria-label="Product details"><div><dt>Id</dt><dd>p1</dd></div><div><dt>Name</dt><dd>Apple</dd></div><div><dt>Price</dt><dd>1.5</dd></div></dl></main>');
  });

  await t.test('a second run in a fresh project writes the same bytes', async () => {
    const other = initProject('react-spa', 'detail');
    const again = await plan(other);
    assert.deepEqual(again.planned.plan, planned.plan, 'the same plan');
    execute(other, again.planned.plan);
    assert.deepEqual(featureFiles(other), written, 'the proof included');
    for (const f of ['src/App.tsx', '.dependency-cruiser.cjs', 'architecture.yml']) assert.equal(fs.readFileSync(path.join(other, f), 'utf8'), fs.readFileSync(path.join(dir, f), 'utf8'), `${f} too`);
  });
});

test('the same detail plan on a Next.js project validates too, and its hook and controller are client files', NEEDS_RUNTIME, async () => {
  const dir = initProject('nextjs', 'detail');
  const { planned } = await plan(dir);
  assert.deepEqual(planned.wiring.routes, [{ name: 'Product', route: '/product', step: 's10', file: 'app/product/page.tsx' }]);
  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const after = projectFiles(dir);
  assert.deepEqual([...Object.keys(after), ...Object.keys(before)].filter((f, i, all) => all.indexOf(f) === i && after[f] !== before[f]).sort(), planTouches(planned.plan).files.map((f) => f.path).sort(), 'no file changed that the plan did not declare');
  assert.equal(after['app/product/page.tsx'], "import { ProductController } from '../../features/product/controllers/ProductController.controller';\n\nexport default function Page() {\n  return <ProductController />;\n}\n", 'the route entry renders the controller and nothing else');
  assert.deepEqual(validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const files = featureFiles(dir);
  assert.ok(files['features/product/controllers/ProductController.controller.tsx'].startsWith("'use client';"));
  assert.ok(files['features/product/hooks/useProduct.state.ts'].startsWith("'use client';"));
  const proof = run(['test', 'proof', 'product', '--format', 'json'], dir);
  assert.equal(proof.status, 0, 'the proof of the same screen passes on a Next.js project');
  assert.equal(JSON.parse(proof.stdout).counts.failed, 0);
  const tsc = typeCheck(dir, ['app/product/page.tsx']);
  assert.equal(tsc.status, 0, tsc.output);
});
