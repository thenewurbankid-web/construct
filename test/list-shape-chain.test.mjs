// #619 -- the whole Requirement chain, run for real: the sentence "A user wants to see a list of products" goes through
// parseRequirement, placeCard (the shape offer, answered by the rules provider), planFromBlocks, and the plan's own commands
// (planToCommand, run through the CLI) in a fresh `construct init` project with the typed-contracts phase 1 rules ON. Then:
//   - `construct validate` reports no error and no warning,
//   - `tsc --noEmit` passes on the project's features and its route entry,
//   - the page and the controller render (react-dom/server) with the expected text for loading, empty, items and error,
//   - the generated service behaves (abort signal forwarded, every failure an error result).
// #623 adds the proof: the plan ends with `create proof` and `test proof` steps, run by the same commands; the proof (a node test
// bundled with the project's esbuild) passes on the generated screen, FAILS with a message naming the state when the page is
// broken (an app failure) or a file it binds to is gone (a convention failure), and is byte-identical on a second run.
// Offline: the project has no node_modules of its own, so the test links the repo's (react, react-dom, typescript, @types) and
// `@line/construct-core` (this checkout's packages/core, which the generated units import their factories from).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { proofStatus } from '../packages/core/proof.mjs';
import { planToCommand, planTouches, validatePlan } from '../packages/core/plan.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const SENTENCE = 'A user wants to see a list of products';
const run = (args, cwd) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd });
const firstExisting = (...candidates) => candidates.find((p) => fs.existsSync(p));
const PHASE_1_ON = ['DOMAIN-002', 'READ-004', 'SERVICE-003', 'STATE-001'];

/** A fresh init project whose architecture.yml has the typed-contracts phase 1 rules on, and whose imports resolve offline. */
function initProject(framework) {
  const dir = makeTempDir(`construct-list-${framework}-`);
  assert.equal(run(['init', '--framework', framework], dir).status, 0);
  const yml = path.join(dir, 'architecture.yml');
  let text = fs.readFileSync(yml, 'utf8');
  for (const rule of PHASE_1_ON) {
    assert.match(text, new RegExp(`^  ${rule}: off$`, 'm'), `${rule} is off by default`);
    text = text.replace(new RegExp(`^  ${rule}: off$`, 'm'), `  ${rule}: error`);
  }
  fs.writeFileSync(yml, text);
  const modules = path.join(dir, 'node_modules');
  fs.mkdirSync(path.join(modules, '@line'), { recursive: true });
  const link = (name, target) => fs.symlinkSync(target, path.join(modules, name));
  link('react', firstExisting(path.join(REPO, 'node_modules', 'react'), path.join(REPO, 'ui', 'client', 'node_modules', 'react')));
  link('react-dom', firstExisting(path.join(REPO, 'node_modules', 'react-dom'), path.join(REPO, 'ui', 'client', 'node_modules', 'react-dom')));
  link('typescript', path.join(REPO, 'node_modules', 'typescript'));
  link('esbuild', path.join(REPO, 'node_modules', 'esbuild')); // the proof is bundled with the project's own esbuild (it comes with tsx and vite)
  link('@esbuild', path.join(REPO, 'node_modules', '@esbuild'));
  link('@types', path.join(REPO, 'node_modules', '@types'));
  link('@line/construct-core', path.join(REPO, 'packages', 'core'));
  return dir;
}

/** The plan for the sentence, with the shape offer answered by the built-in rules provider (the default), as a person would confirm it. */
async function planFor(dir, feature) {
  const { card } = parseRequirement(SENTENCE);
  const config = { framework: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies?.next ? 'nextjs' : 'react-spa' };
  const first = placeCard(card, config);
  assert.equal(first.complete, true);
  const [offer] = first.offers;
  const suggestion = await suggest({ id: offer.id, question: offer.question, options: offer.options });
  assert.equal(suggestion.option, 'list', 'the rules-only default is the list shape');
  const placed = placeCard(card, { ...config, answers: { [offer.id]: { option: suggestion.option, by: 'decision-model', provider: suggestion.provider } } });
  assert.deepEqual(placed.errors, []);
  const planned = planFromBlocks(placed.blocks, { feature, root: dir, title: SENTENCE, decisions: placed.decisions });
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
  return { placed, planned };
}

/** What the runner does with a plan: each step's own command, through the CLI, in the project. */
function execute(dir, plan) {
  for (const step of plan.steps) {
    const { argv } = planToCommand(step);
    const res = run(argv, dir);
    assert.equal(res.status, 0, `${step.id} ${argv.join(' ')}\n${res.stdout}\n${res.stderr}`);
  }
}

const featureFiles = (dir) => Object.fromEntries(fs.readdirSync(path.join(dir, 'features'), { recursive: true }).filter((f) => fs.statSync(path.join(dir, 'features', f)).isFile()).sort().map((f) => [`features/${f}`, fs.readFileSync(path.join(dir, 'features', f), 'utf8')]));
const validateJson = (dir) => JSON.parse(run(['validate', '--format', 'json'], dir).stdout);

test('the sentence becomes a plan of 9 steps, runs, and gives a screen that validates, type-checks, renders and is PROVEN', async (t) => {
  const dir = initProject('react-spa');
  const { placed, planned } = await planFor(dir, 'products');
  assert.deepEqual(placed.decisions, [{ question: 'q-shape', option: 'list', by: 'decision-model', provider: 'rules' }], 'who decided is recorded');
  assert.deepEqual(planned.plan.steps.map((s) => s.title), ['Create feature products', 'Create domain Products', 'Create service Products', 'Create hook Products', 'Create component Products', 'Create page Products', 'Create controller Products', 'Prove the Products screen', 'Run the proof of Products']);
  assert.deepEqual(planned.proof, { required: true, complete: false, state: 'pending', steps: [{ name: 'Products', kind: 'render', proofStep: 's8', verifiedBy: 's9' }], verifiedBy: ['s9'], playwright: { configured: false, config: null, skipped: planned.notes[0] } }, 'the chain is not complete until s9 is green or skipped');
  assert.match(planned.notes[0], /^Playwright is not configured in this project/, 'a project without Playwright is told so, and nothing is installed');
  assert.equal(planned.plan.steps[8].flow, 'test.proof', 'the last step is the read-only verification');
  assert.deepEqual(planned.plan.steps[8].dependsOn, ['s8']);
  assert.equal(planned.plan.steps[3].args.fields, 'id:string,name:string,price:number', 'the fields are the card entity\'s properties, typed by name, with an id');

  execute(dir, planned.plan);
  const written = featureFiles(dir); // includes features/core, which `construct init` scaffolds
  const declared = planTouches(planned.plan).files.map((f) => f.path).sort();
  assert.deepEqual(Object.keys(written).filter((f) => f.startsWith('features/products/')).sort(), declared.filter((f) => f.startsWith('features/')), 'the commands wrote exactly the files the plan declared (the gate refuses any other)');
  assert.ok(declared.includes('architecture.yml'), 'the proof step declares the test regions it adds to architecture.yml');
  assert.equal(declared.length, 13, 'index.ts from the feature step, the ten files of the shape (types.ts among them), the proof and architecture.yml');
  await t.test('the files it wrote', () => {
    for (const f of ['domain/Products.domain.ts', 'services/Products.service.ts', 'hooks/useProducts.state.ts', 'components/ProductRow.component.tsx', 'pages/ProductsPage.page.tsx', 'expressions/ProductsByStatus.expression.tsx', 'controllers/ProductsController.controller.tsx']) {
      assert.ok(written[`features/products/${f}`], f);
    }
    assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
  });

  // What a person does by hand, once: wire the controller into the route entry, and let sync export it from the feature.
  fs.writeFileSync(path.join(dir, 'src', 'App.tsx'), "import { ProductsController } from '../features/products/controllers/ProductsController.controller';\n\nexport function App() {\n  return <ProductsController />;\n}\n");
  assert.equal(run(['sync'], dir).status, 0);

  await t.test('construct validate: no error and no warning, with the phase 1 rules on', () => {
    const report = validateJson(dir);
    assert.deepEqual(report.violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
    assert.equal(report.status, 'passed');
  });

  await t.test('tsc --noEmit passes on the features and the route entry', () => {
    // features/ includes the proof (tests/generated). A real project has @types/react-dom; this offline fixture has not, so it declares the one module.
    fs.writeFileSync(path.join(dir, 'offline-types.d.ts'), "declare module 'react-dom/server';\n");
    fs.writeFileSync(path.join(dir, 'tsconfig.check.json'), JSON.stringify({ extends: './tsconfig.json', compilerOptions: { types: ['node'] }, include: ['features', 'src/App.tsx', 'offline-types.d.ts'] }));
    const tsc = spawnSync(process.execPath, [path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.check.json'], { encoding: 'utf8', cwd: dir });
    assert.equal(tsc.status, 0, `${tsc.stdout}${tsc.stderr}`);
  });

  const proofFile = path.join(dir, 'features', 'products', 'tests', 'generated', 'ProductsScreen.proof.test.ts');
  const proofRun = (name) => run(['test', 'proof', 'products', '--format', 'json', ...(name ? ['--name', name] : [])], dir);

  await t.test('the proof passes: node --test on the generated screen, no browser, and the chain is complete', () => {
    const res = proofRun();
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const result = JSON.parse(res.stdout);
    assert.deepEqual(result.counts, { total: 10, passed: 10, failed: 0, notRun: 0 });
    assert.deepEqual(result.tests.map((x) => x.title.replace(/^Products /, '')), ['screen: the loading state', 'screen: the empty state', 'screen: the items, with every field value', 'screen: the error state, with role alert', 'controller: renders the loading state first', 'service: a good answer is the rows', 'service: a 500 is an error result', 'service: a wrong shape is an error result', 'service: a network failure is an error result', "service: the caller's AbortSignal reaches fetch"]);
    assert.deepEqual(result.chain, proofStatus([{ id: 'proof', result: { ok: true, counts: result.counts } }]));
    assert.equal(result.chain.complete, true);
    assert.deepEqual(result.summary.options, [], 'a green proof has nothing left to choose');
    assert.ok(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8').includes('nonLayer:\n  - features/*/tests/**'), 'the test regions are declared once');
  });

  await t.test('the proof file: named Name.layer.ext, locked, from the entity fields, and it is text a person can read', () => {
    const text = fs.readFileSync(proofFile, 'utf8');
    assert.ok(text.startsWith('// @construct-generated tests v1 - LOCKED, do not edit (#348)\n'));
    for (const want of ['{ id: "product-1", name: "Product name 1", price: 12.5 }', '"<strong>Product name 1</strong>", "<span>price: 12.5</span>"', "role=\"alert\"", 'renders the loading state first', 'a 500 is an error result', 'a wrong shape is an error result', 'a network failure is an error result']) assert.ok(text.includes(want), want);
    const gen = run(['create', 'proof', 'Products', '--feature', 'products', '--entity', 'Product', '--fields', 'id:string,name:string,price:number'], dir);
    assert.equal(gen.status, 0, `${gen.stdout}${gen.stderr}`);
    assert.equal(fs.readFileSync(proofFile, 'utf8'), text, 'regenerating writes the same bytes');
    assert.doesNotMatch(gen.stdout, /Updated architecture.yml/, 'the regions are declared once');
  });

  await t.test('a broken page FAILS the proof with an app failure that names the state (the empty branch is gone)', () => {
    const expression = path.join(dir, 'features', 'products', 'expressions', 'ProductsByStatus.expression.tsx');
    const good = fs.readFileSync(expression, 'utf8');
    const broken = good.replace("  if (state.items.length === 0) return <>{children}</>;\n", '');
    assert.notEqual(broken, good, 'the empty-state branch was there');
    fs.writeFileSync(expression, broken);
    try {
      const res = proofRun();
      assert.equal(res.status, 1, 'exit 1: the proof ran and failed');
      const result = JSON.parse(res.stdout);
      const failed = result.tests.filter((x) => x.status === 'failed');
      assert.deepEqual(failed.map((x) => x.title), ['Products screen: the empty state']);
      assert.equal(failed[0].failure.kind, 'app', 'the app behaved differently: not a harness problem');
      assert.deepEqual([failed[0].failure.expected, failed[0].failure.reached], ['empty', 'blank']);
      assert.equal(failed[0].failure.summary, 'The page given no rows: the empty state is wrong, the screen shows blank.');
      assert.equal(result.chain.complete, false);
      assert.deepEqual(result.summary.options.map((o) => o.id), ['edit-code', 'fill-with-ai', 'skip-proof'], 'the two exits every block has, and an explicit skip');
      assert.equal(proofStatus([{ id: 's9', result: { ok: true, counts: result.counts } }]).complete, false);
      const text = run(['test', 'proof', 'products'], dir).stdout;
      assert.match(text, /FAIL {3}Products screen: the empty state\n {10}APP BEHAVED DIFFERENTLY: The page given no rows: the empty state is wrong, the screen shows blank\./);
      assert.match(text, /Chain: NOT complete/);
    } finally {
      fs.writeFileSync(expression, good);
    }
    assert.equal(proofRun().status, 0, 'and the proof is green again once the page is');
  });

  await t.test('a file the proof binds to gone is a CONVENTION failure, not a product bug', () => {
    const page = path.join(dir, 'features', 'products', 'pages', 'ProductsPage.page.tsx');
    const good = fs.readFileSync(page, 'utf8');
    fs.renameSync(page, `${page}.off`);
    try {
      const result = JSON.parse(proofRun().stdout);
      const [failed] = result.tests;
      assert.equal(result.chain.complete, false);
      assert.equal(failed.failure.kind, 'convention');
      assert.match(failed.failure.selector, /ProductsPage\.page/);
      assert.ok(result.summary.options.map((o) => o.id).includes('regenerate-screen'));
    } finally {
      fs.renameSync(`${page}.off`, page);
    }
    assert.equal(fs.readFileSync(page, 'utf8'), good);
    assert.equal(proofRun().status, 0);
  });

  await t.test('the screen renders: loading, empty, items and error', async () => {
    const { build } = await import('esbuild');
    fs.mkdirSync(path.join(dir, 'smoke'));
    fs.writeFileSync(path.join(dir, 'smoke', 'entry.tsx'), [
      "import { renderToString } from 'react-dom/server';",
      "import { ProductsPage } from '../features/products/pages/ProductsPage.page';",
      "import { ProductsController } from '../features/products/controllers/ProductsController.controller';",
      "import { fetchProducts } from '../features/products/services/Products.service';",
      "import { sortProducts } from '../features/products/domain/Products.domain';",
      "import type { ProductsState } from '../features/products/types';",
      'export const page = (state: ProductsState) => renderToString(<ProductsPage state={state} />);',
      'export const controller = () => renderToString(<ProductsController />);',
      'export { fetchProducts, sortProducts };',
    ].join('\n'));
    const reactDir = fs.realpathSync(path.join(dir, 'node_modules', 'react'));
    await build({ entryPoints: [path.join(dir, 'smoke', 'entry.tsx')], outfile: path.join(dir, 'smoke', 'entry.cjs'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', alias: { react: reactDir }, absWorkingDir: dir, logLevel: 'silent' });
    const screen = createRequire(import.meta.url)(path.join(dir, 'smoke', 'entry.cjs'));

    assert.equal(screen.page({ status: 'loading' }), '<main><h1>Products</h1><p role="status">Loading products...</p></main>');
    assert.equal(screen.page({ status: 'ready', items: [] }), '<main><h1>Products</h1><p role="status">No products yet.</p></main>');
    assert.equal(screen.page({ status: 'error', message: 'The server answered 500.' }), '<main><h1>Products</h1><p role="alert">The server answered 500.</p></main>');
    const items = [{ id: 'p1', name: 'Apple', price: 1.5 }, { id: 'p2', name: 'Bread', price: 3 }];
    assert.equal(screen.page({ status: 'ready', items }), '<main><h1>Products</h1><ul aria-label="Products"><li><strong>Apple</strong> <span>price: 1.5</span></li><li><strong>Bread</strong> <span>price: 3</span></li></ul></main>');
    assert.equal(screen.controller(), screen.page({ status: 'loading' }), 'the controller starts out loading: it holds the hook and hands its state to the page');
    assert.deepEqual(screen.sortProducts({ items: [items[1], items[0]] }).map((p) => p.name), ['Apple', 'Bread'], 'the domain sorter orders by name');
    assert.equal(items[0].name, 'Apple', 'and does not change the list it is given');

    // The service: the caller's signal reaches fetch, and every failure is a typed result, never a throw.
    const original = globalThis.fetch;
    const answer = (status, body) => async (url, init) => ({ ok: status < 400, status, json: async () => (body instanceof Error ? Promise.reject(body) : body), url, init });
    try {
      const controller = new AbortController();
      let seen;
      globalThis.fetch = async (url, init) => { seen = { url, init }; return answer(200, items)(url, init); };
      assert.deepEqual(await screen.fetchProducts({ signal: controller.signal }), { status: 'ready', items });
      assert.equal(seen.url, '/api/products');
      assert.equal(seen.init.signal, controller.signal, 'the AbortSignal is forwarded');
      globalThis.fetch = answer(500, []);
      assert.deepEqual(await screen.fetchProducts({ signal: controller.signal }), { status: 'error', message: 'The server answered 500.' });
      globalThis.fetch = answer(200, { not: 'a list' });
      assert.equal((await screen.fetchProducts({ signal: controller.signal })).status, 'error');
      globalThis.fetch = answer(200, [{ id: 'p1', name: 'Apple', price: 'free' }]);
      assert.equal((await screen.fetchProducts({ signal: controller.signal })).status, 'error', 'a row of the wrong shape is an error result');
      globalThis.fetch = async () => { throw new Error('offline'); };
      assert.deepEqual(await screen.fetchProducts({ signal: controller.signal }), { status: 'error', message: 'offline' });
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test('a second run in a fresh project writes the same bytes', async () => {
    const other = initProject('react-spa');
    const again = await planFor(other, 'products');
    assert.deepEqual(again.planned.plan, planned.plan, 'the same plan');
    execute(other, again.planned.plan);
    assert.deepEqual(featureFiles(other), written, 'the proof included');
    assert.equal(fs.readFileSync(path.join(other, 'architecture.yml'), 'utf8'), fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'), 'and the regions it declared');
  });
});

test('the same plan on a Next.js project validates too, and its hook and controller are client files', async () => {
  const dir = initProject('nextjs');
  const { planned } = await planFor(dir, 'products');
  execute(dir, planned.plan);
  fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), "import { ProductsController } from '../features/products/controllers/ProductsController.controller';\n\nexport default function Page() {\n  return <ProductsController />;\n}\n");
  assert.equal(run(['sync'], dir).status, 0);
  assert.deepEqual(validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
  const files = featureFiles(dir);
  assert.ok(files['features/products/controllers/ProductsController.controller.tsx'].startsWith("'use client';"));
  assert.ok(files['features/products/hooks/useProducts.state.ts'].startsWith("'use client';"));
  fs.writeFileSync(path.join(dir, 'offline-types.d.ts'), "declare module 'react-dom/server';\n"); // stands in for @types/react-dom, which this offline fixture lacks
  fs.writeFileSync(path.join(dir, 'tsconfig.check.json'), JSON.stringify({ extends: './tsconfig.json', compilerOptions: { types: ['node'], plugins: [], incremental: false }, include: ['features', 'app/page.tsx', 'offline-types.d.ts'] }));
  const proof = run(['test', 'proof', 'products', '--format', 'json'], dir);
  assert.equal(proof.status, 0, 'the proof of the same screen passes on a Next.js project, where the hook and the controller are client files');
  assert.equal(JSON.parse(proof.stdout).counts.failed, 0);
  const tsc = spawnSync(process.execPath, [path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.check.json'], { encoding: 'utf8', cwd: dir });
  assert.equal(tsc.status, 0, `${tsc.stdout}${tsc.stderr}`);
});
