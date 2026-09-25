// #625 -- the whole chain for the ROUTE HANDLER, run for real: the sentence "A user wants to see a list of products" goes through parseRequirement, placeCard (the shape offer, answered by
// the rules provider), planFromBlocks (the requirement card is handed over and the data source is `endpoint`, so the closed question `q-handler` is raised on a Next.js project: the rules
// default is to add the handler that serves the endpoint the screen calls) and the plan's own commands (planToCommand, run through the CLI) in a fresh `construct init` Next.js project with
// the typed-contracts phase 1 rules ON. Then: every file that changed is a file the plan declared, `construct validate` reports no error and no warning, `tsc --noEmit` passes (the route
// included), the proof RUNS green (every typed result is a status, every other method a typed 405, a good and a bad request against the service) and a deliberately broken handler makes it
// FAIL naming the method or the status, and a second run in a fresh project writes the same bytes. Then the screen and its handler are used TOGETHER: the screen's own service reads what
// the handler answers. Same guard as test/list-shape-chain.test.mjs: a lane without react-dom skips with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planTouches } from '../packages/core/plan.mjs';
import { NEEDS_RUNTIME, execute, featureFiles, initProject, planFor, projectFiles, run, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const LIST = 'A user wants to see a list of products';
const FORM = 'A user wants to add a product with a name and a price';
const ROUTES = ['app/api/products/route.ts'];
const listPlan = (dir, answers = {}) => planFor(dir, LIST, 'products', 'list', 'endpoint', { card: true, answers });
const proofRun = (dir, name = 'ProductsApi.proof.test.ts', feature = 'products') => run(['test', 'proof', feature, '--format', 'json', '--name', name], dir);
const violations = (dir) => validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`);

test('the sentence becomes a plan with a handler step, runs, and gives an endpoint that validates, type-checks and is PROVEN', NEEDS_RUNTIME, async (t) => {
  const dir = initProject('nextjs', 'handler');
  const { planned } = await listPlan(dir);
  const offer = planned.offers.find((o) => o.id === 'q-handler');
  assert.deepEqual([offer.default, offer.options.map((o) => o.id), offer.chosen, offer.options[0].label], ['add-handler', ['add-handler', 'skip'], null, 'Add GET /api/products']);
  const step = planned.plan.steps.find((s) => s.flow === 'create.handler');
  assert.deepEqual(step.args, { name: 'Products', feature: 'products', method: 'GET', path: '/api/products', entity: 'Product', fields: 'id:string,name:string,price:number' });
  assert.deepEqual(planned.handlers, [{ name: 'Products', method: 'GET', path: '/api/products', question: 'q-handler', step: 's8' }]);
  assert.deepEqual(planned.proof.steps.map((p) => [p.name, p.proofStep, p.verifiedBy]).at(-1), ['ProductsApi', 's8', 's15'], 'the handler is part of the chain: its proof must be green too');
  assert.ok(planned.plan.steps.find((s) => s.flow === 'check.types').dependsOn.includes('s8'), 'the type-check waits for the handler');
  assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-handler'), [], 'unanswered: the rules default is used and nothing is recorded as a person\'s choice');

  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const written = featureFiles(dir);
  const declared = planTouches(planned.plan).files.map((f) => f.path).sort();
  const after = projectFiles(dir);
  assert.deepEqual([...Object.keys(after), ...Object.keys(before)].filter((f, i, all) => all.indexOf(f) === i && after[f] !== before[f]).sort(), declared, 'every file the commands created, changed or removed is a file the plan declared: nothing was done by hand');
  assert.ok(declared.includes('app/api/products/route.ts'), 'the route file is declared');

  await t.test('the files it wrote', () => {
    const at = (f) => written[`features/products/${f}`];
    assert.ok(at('domain/ProductsApi.domain.ts') && at('services/ProductsApi.service.ts') && at('tests/generated/ProductsApi.proof.test.ts'));
    assert.match(after['app/api/products/route.ts'], /^import \{ toProductsHttp \} from '\.\.\/\.\.\/\.\.\/features\/products\/domain\/ProductsApi\.domain';/);
    assert.match(after['app/api/products/route.ts'], /export async function GET\(\): Promise<Response> \{\n {2}return respond\(await serveProducts\(\{ input: undefined \}\)\);\n\}/);
    assert.equal((at('types.ts').match(/export interface Product\b/g) ?? []).length, 1, 'the entity of the screen is declared once: the handler reuses it');
    assert.match(at('types.ts'), /export type ApiResult<Body> =/);
    assert.doesNotMatch(after['app/api/products/route.ts'], /process\.env/, 'the route never reads a secret');
    assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
  });

  await t.test('construct validate: no error and no warning, with the phase 1 rules on (the route entry rules are not weakened)', () => {
    assert.deepEqual(violations(dir), []);
  });

  await t.test('tsc --noEmit passes on the features, the page and the route handler', () => {
    const tsc = typeCheck(dir, ['app/products/page.tsx', ...ROUTES]);
    assert.equal(tsc.status, 0, tsc.output);
  });

  await t.test('the proof passes: every typed result is a status, every other method a typed 405, and the chain is complete', () => {
    const res = proofRun(dir);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const result = JSON.parse(res.stdout);
    assert.deepEqual(result.tests.map((x) => x.title), ['Products handler: the status of every typed result', 'Products handler: 405 names the methods that are answered', 'Products handler: every other method is 405, as typed JSON, with the Allow header', 'Products handler: GET answers 200 with the rows as JSON']);
    assert.equal(result.chain.complete, true);
    assert.equal(run(['test', 'proof', 'products', '--format', 'json'], dir).status, 0, 'the screen proof and the handler proof run together');
  });

  await t.test('a broken handler FAILS the proof, and the message names the method or the status', () => {
    const domain = path.join(dir, 'features', 'products', 'domain', 'ProductsApi.domain.ts');
    const route = path.join(dir, 'app', 'api', 'products', 'route.ts');
    const service = path.join(dir, 'features', 'products', 'services', 'ProductsApi.service.ts');
    const cases = [
      // An invalid request is answered 422 instead of 400.
      { file: domain, from: "return { status: 400, body: { error: result.message }, headers: {} };", to: "return { status: 422, body: { error: result.message }, headers: {} };", title: 'Products handler: the status of every typed result', say: 'The invalid result: the 400 state is wrong, it reaches 422.', expected: ['400', '422'] },
      // POST answers as if it were the method: a route that answers a method it should not.
      { file: route, from: "return respond({ status: 'not-allowed', allow: ['GET'] });", to: "return respond({ status: 'ready', body: [] });", title: 'Products handler: every other method is 405, as typed JSON, with the Allow header', say: 'POST: the 405 state is wrong, it reaches 200.', expected: ['405', '200'] },
      // The Allow header names the wrong method.
      { file: domain, from: "headers: { Allow: result.allow.join(', ') }", to: "headers: { Allow: 'POST' }", title: 'Products handler: 405 names the methods that are answered', say: 'The Allow header of a 405: the GET state is wrong, it reaches POST.', expected: ['GET', 'POST'] },
      // The service answers something that is not a list.
      { file: service, from: "return { status: 'ready', body: [...rows] };", to: "return { status: 'ready', body: { rows: [...rows] } };", title: 'Products handler: GET answers 200 with the rows as JSON', say: 'The body of GET: the a list state is wrong, it reaches something else.', expected: ['a list', 'something else'] },
    ];
    for (const c of cases) {
      const good = fs.readFileSync(c.file, 'utf8');
      const broken = good.replace(c.from, c.to);
      assert.notEqual(broken, good, `the line was there: ${c.from}`);
      fs.writeFileSync(c.file, broken);
      try {
        const res = proofRun(dir);
        assert.equal(res.status, 1, 'exit 1: the proof ran and failed');
        const result = JSON.parse(res.stdout);
        const own = result.tests.find((x) => x.title === c.title);
        assert.equal(own.status, 'failed', `${c.title} failed: ${result.tests.filter((x) => x.status === 'failed').map((x) => x.title)}`);
        assert.equal(own.failure.kind, 'app', 'the app behaved differently: not a harness problem');
        assert.equal(own.failure.summary, c.say, 'the message names the method or the status');
        assert.deepEqual([own.failure.expected, own.failure.reached], c.expected);
        assert.equal(result.chain.complete, false);
      } finally {
        fs.writeFileSync(c.file, good);
      }
    }
    assert.equal(proofRun(dir).status, 0, 'and the proof is green again once the handler is');
  });

  await t.test('the screen and its handler work together: the screen\'s own service reads what the handler answers', async () => {
    const { build } = await import('esbuild');
    fs.mkdirSync(path.join(dir, 'smoke'));
    fs.writeFileSync(path.join(dir, 'smoke', 'entry.ts'), [
      "import * as route from '../app/api/products/route';", "import { fetchProducts } from '../features/products/services/Products.service';",
      "export async function together(): Promise<string> { const original = globalThis.fetch; globalThis.fetch = (async (url: string) => route.GET()) as unknown as typeof fetch;",
      "  try { const result = await fetchProducts({ signal: new AbortController().signal }); return result.status + ':' + (result.status === 'ready' ? result.items.length : result.message); } finally { globalThis.fetch = original; } }",
    ].join('\n'));
    await build({ entryPoints: [path.join(dir, 'smoke', 'entry.ts')], outfile: path.join(dir, 'smoke', 'entry.cjs'), bundle: true, platform: 'node', format: 'cjs', absWorkingDir: dir, logLevel: 'silent' });
    const { createRequire } = await import('node:module');
    assert.equal(await createRequire(import.meta.url)(path.join(dir, 'smoke', 'entry.cjs')).together(), 'ready:0', 'the endpoint the screen calls is answered: an empty list, typed, 200');
  });

  await t.test('a second run in a fresh project writes the same bytes', async () => {
    const other = initProject('nextjs', 'handler');
    const again = await listPlan(other);
    assert.deepEqual(again.planned.plan, planned.plan, 'the same plan');
    execute(other, again.planned.plan);
    assert.deepEqual(featureFiles(other), written, 'the handler and its proof included');
    for (const f of ['app/api/products/route.ts', 'app/products/page.tsx', 'architecture.yml']) assert.equal(fs.readFileSync(path.join(other, f), 'utf8'), fs.readFileSync(path.join(dir, f), 'utf8'), `${f} too`);
  });

  await t.test('running the handler again changes nothing at all', () => {
    const snapshot = projectFiles(dir);
    const again = run(['create', 'handler', 'Products', '--feature', 'products', '--method', 'GET', '--path', '/api/products', '--entity', 'Product', '--fields', 'id:string,name:string,price:number'], dir);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /^Unchanged: GET \/api\/products is already served by app\/api\/products\/route\.ts\./);
    assert.deepEqual(projectFiles(dir), snapshot);
  });
});

test('skip: the answer that adds no handler. A plan with q-handler answered skip has no handler step and no proof step of it, and the answer is a recorded decision', NEEDS_RUNTIME, async () => {
  const dir = initProject('nextjs', 'handler-skip');
  const { planned } = await listPlan(dir, { 'q-handler': { option: 'skip', by: 'person' } });
  assert.equal(planned.plan.steps.some((s) => s.flow === 'create.handler'), false);
  assert.deepEqual(planned.handlers, [{ name: 'Products', method: 'GET', path: '/api/products', question: 'q-handler', step: null }]);
  assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-handler'), [{ question: 'q-handler', option: 'skip', by: 'person' }]);
  assert.equal(planned.proof.steps.some((p) => p.name === 'ProductsApi'), false);
});

test('a form: its POST endpoint gets a handler that validates the typed body (the service answers 400 for a bad one) and the whole chain validates, type-checks and is proven', NEEDS_RUNTIME, async () => {
  const dir = initProject('nextjs', 'handler-form');
  const { planned } = await planFor(dir, FORM, 'add-product', 'form', 'endpoint', { card: true });
  const step = planned.plan.steps.find((s) => s.flow === 'create.handler');
  assert.deepEqual([step.args.method, step.args.path, step.args.entity], ['POST', '/api/products', 'Product']);
  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const after = projectFiles(dir);
  assert.deepEqual([...Object.keys(after), ...Object.keys(before)].filter((f, i, all) => all.indexOf(f) === i && after[f] !== before[f]).sort(), planTouches(planned.plan).files.map((f) => f.path).sort(), 'no file changed that the plan did not declare');
  assert.deepEqual(violations(dir), []);
  const tsc = typeCheck(dir, ['app/add-product/page.tsx', 'app/api/products/route.ts']);
  assert.equal(tsc.status, 0, tsc.output);
  const proof = run(['test', 'proof', 'add-product', '--format', 'json'], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  const result = JSON.parse(proof.stdout);
  assert.equal(result.counts.failed, 0);
  assert.ok(result.tests.some((x) => x.title === 'AddProduct handler: POST with a body that is not a row answers 400'));
});

test('react-spa: no handler is offered (a handler needs a Next.js project), the plan is as it was, and the CLI refuses with the reason', NEEDS_RUNTIME, async () => {
  const dir = initProject('react-spa', 'handler-spa');
  const { planned } = await listPlan(dir);
  assert.equal(planned.offers.some((o) => o.id === 'q-handler'), false);
  assert.equal(planned.plan.steps.some((s) => s.flow === 'create.handler'), false);
  const res = run(['create', 'handler', 'Products', '--feature', 'products', '--method', 'GET', '--path', '/api/products'], dir);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /A route handler needs a Next\.js project: this project is react-spa/);
});
