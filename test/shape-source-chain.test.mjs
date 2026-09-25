// #621 -- the whole Requirement chain for the two sources the other chain tests do not run (they answer q-source `endpoint`): `local` and `openapi`,
// for each of the three shapes. The sentence goes through parseRequirement, placeCard (the shape offer answered by the rules provider), planFromBlocks
// with q-source UNANSWERED, so the rules-only default decides (`local` in a project with no OpenAPI file; `openapi` in one whose spec has the
// operation), and the plan's own commands (planToCommand, through the CLI) in a fresh `construct init` project with the typed-contracts phase 1
// rules ON. Then: every file that changed is a file the plan declared, `construct validate` reports nothing, `tsc --noEmit` passes, the proof RUNS
// green, a second run in a fresh project writes the same bytes, and a deliberately broken SOURCE makes the proof FAIL naming what is wrong (and green
// again once put back). Same guard as the other chain tests: a lane without react-dom skips with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planTouches } from '../packages/core/plan.mjs';
import { NEEDS_RUNTIME, execute, featureFiles, initProject, planFor, projectFiles, run, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const SPEC = `openapi: 3.0.3
info: { title: Shop, version: '1' }
servers: [{ url: /v1 }]
paths:
  /products:
    get: { operationId: listProducts, responses: { '200': { description: ok } } }
    post: { operationId: createProduct, responses: { '201': { description: ok } } }
  /products/{id}:
    get: { operationId: getProduct, responses: { '200': { description: ok } } }
`;

/** What each shape's sentence gives, and what the proof of each source must count (its tests are named in the chain test of the shape). */
const SHAPES = {
  list: { sentence: 'A user wants to see a list of products', feature: 'products', unit: 'Products', store: 'ProductsStore', service: 'Products', counts: { local: 7, openapi: 11 } },
  detail: { sentence: 'A user wants to see the details of a product', feature: 'product', unit: 'Product', store: 'ProductStore', service: 'Product', counts: { local: 9, openapi: 12 } },
  form: { sentence: 'A user wants to add a product with a name and a price', feature: 'add-product', unit: 'AddProduct', store: 'AddProductStore', service: 'AddProduct', counts: { local: 12, openapi: 13 } },
};

/** How to break the source of each shape (the store for local, the path for openapi), and the proof test that must then fail. */
const BREAKS = {
  local: {
    list: { file: (s) => `domain/${s.store}.domain.ts`, from: 'items: [...rows]', to: 'items: []', failing: 'Products service: the local store answers the seed rows, with no network', reached: 'empty' },
    detail: { file: (s) => `domain/${s.store}.domain.ts`, from: "return item ? { status: 'ready', item } : { status: 'not-found' };", to: "return { status: 'not-found' };", failing: 'Product service: the local store answers a seeded id with its item, with no network', reached: 'not-found' },
    form: { file: (s) => `domain/${s.store}.domain.ts`, from: '  { id: `product-${rows.length + 1}`, ...input },\n', to: '', failing: 'AddProduct store: saving adds one row with a fresh id and leaves the rows it is given alone', reached: '2' },
  },
  openapi: {
    list: { file: (s) => `services/${s.service}.service.ts`, from: "fetch('/v1/products'", to: "fetch('/api/products'", failing: 'Products service: asks the path of the OpenAPI operation' },
    detail: { file: (s) => `services/${s.service}.service.ts`, from: 'fetch(`/v1/products/', to: 'fetch(`/api/products/', failing: 'Product service: asks for the item by its id, and the caller\'s AbortSignal reaches fetch' },
    form: { file: (s) => `services/${s.service}.service.ts`, from: "fetch('/v1/products'", to: "fetch('/api/products'", failing: 'AddProduct service: the stubbed submit is called with the typed values' },
  },
};

const setup = (source) => {
  const dir = initProject('react-spa', `source-${source}`);
  if (source === 'openapi') fs.writeFileSync(path.join(dir, 'openapi.yaml'), SPEC);
  return dir;
};

for (const [shape, s] of Object.entries(SHAPES)) {
  for (const source of ['local', 'openapi']) {
    test(`${shape} + ${source}: the sentence gives the ${source} default, a plan that runs, a screen that validates, type-checks, is PROVEN, is the same bytes twice, and goes red when its source is broken`, NEEDS_RUNTIME, async (t) => {
      const dir = setup(source);
      const { planned } = await planFor(dir, s.sentence, s.feature, shape, null);
      const offer = planned.offers.find((o) => o.id === 'q-source');
      assert.deepEqual([offer.default, offer.chosen], [source, null], 'the rules-only default, and nobody chose');
      assert.deepEqual(offer.options.map((o) => o.id), source === 'openapi' ? ['openapi', 'local', 'endpoint'] : ['local', 'endpoint']);
      assert.equal(planned.plan.steps.length, 13);
      assert.ok(planned.plan.steps.filter((x) => x.flow === 'create.unit' || x.flow === 'create.proof').every((x) => x.args.source === source), 'every unit step and the proof step carry the source');
      assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-source'), [], 'an unanswered question is nobody\'s decision');

      const before = projectFiles(dir);
      execute(dir, planned.plan);
      const written = featureFiles(dir);
      const declared = planTouches(planned.plan).files.map((f) => f.path).sort();
      const after = projectFiles(dir);
      assert.deepEqual(Object.keys(after).filter((f) => after[f] !== before[f]).sort(), declared, 'every file the commands created or changed is a file the plan declared: nothing was done by hand');
      const at = (f) => written[`features/${s.feature}/${f}`];

      await t.test('the files: the store only for local, the spec\'s path only for openapi', () => {
        const has = (f) => at(f) !== undefined;
        assert.equal(has(`domain/${s.store}.domain.ts`), source === 'local');
        assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
        const service = at(`services/${s.service}.service.ts`);
        if (source === 'local') {
          assert.equal(/\bfetch\(/.test(service), false, 'the local service makes no request');
          assert.match(service, new RegExp(`from '\\.\\./domain/${s.store}\\.domain'`));
          assert.match(at(`domain/${s.store}.domain.ts`), /defineDomain</);
        } else {
          assert.match(service, /^\/\/ Data source: (GET|POST) \/products(\/\{id\})? \((listProducts|getProduct|createProduct)\) of openapi\.yaml\.$/m);
          assert.match(service, /fetch\(['`]\/v1\/products/);
          assert.equal(service.includes('/api/products'), false, 'no assumed endpoint is left');
        }
      });

      await t.test('construct validate: no error and no warning, with the phase 1 rules on', () => {
        const report = validateJson(dir);
        assert.deepEqual(report.violations.map((v) => `${v.severity} ${v.rule} ${v.file}`), []);
        assert.equal(report.status, 'passed');
      });

      await t.test('tsc --noEmit passes on the features and the route entry', () => {
        const tsc = typeCheck(dir, ['src/App.tsx']);
        assert.equal(tsc.status, 0, tsc.output);
      });

      const proofRun = () => run(['test', 'proof', s.feature, '--format', 'json'], dir);

      await t.test('the proof passes, and says which source it proves', () => {
        const res = proofRun();
        assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
        const result = JSON.parse(res.stdout);
        assert.deepEqual(result.counts, { total: s.counts[source], passed: s.counts[source], failed: 0, notRun: 0 });
        assert.equal(result.chain.complete, true);
        const titles = result.tests.map((x) => x.title).join('\n');
        if (source === 'local') assert.match(titles, /the local store/);
        else assert.match(titles, /the path of the OpenAPI operation|asks for the item by its id|the stubbed submit is called/);
        const text = fs.readFileSync(path.join(dir, 'features', s.feature, 'tests', 'generated', `${s.unit}Screen.proof.test.ts`), 'utf8');
        assert.ok(text.split('\n')[1].includes(`--source ${source}`), 'the command that regenerates it names the source');
      });

      await t.test('the same request in a fresh project writes the same bytes', async () => {
        const again = setup(source);
        const second = await planFor(again, s.sentence, s.feature, shape, null);
        assert.deepEqual(second.planned.plan, planned.plan, 'the same plan');
        execute(again, second.planned.plan);
        assert.deepEqual(featureFiles(again), written, 'the same files');
      });

      await t.test(`a broken ${source === 'local' ? 'store' : 'path'} FAILS the proof, naming the test, and the proof is green once it is put back`, () => {
        const b = BREAKS[source][shape];
        const file = path.join(dir, 'features', s.feature, b.file(s));
        const good = fs.readFileSync(file, 'utf8');
        const broken = good.replace(b.from, b.to);
        assert.notEqual(broken, good, 'the line to break was there');
        fs.writeFileSync(file, broken);
        try {
          const res = proofRun();
          assert.equal(res.status, 1, 'exit 1: the proof ran and failed');
          const result = JSON.parse(res.stdout);
          assert.deepEqual(result.tests.filter((x) => x.status === 'failed').map((x) => x.title), [b.failing]);
          if (b.reached) assert.equal(result.tests.find((x) => x.status === 'failed').failure.reached, b.reached, 'the failure names the state the screen reached');
          assert.equal(result.chain.complete, false);
        } finally {
          fs.writeFileSync(file, good);
        }
        assert.equal(proofRun().status, 0, 'green again');
      });

      if (source === 'local') {
        await t.test('a store file the proof binds to gone is a CONVENTION failure, not a product bug', () => {
          const file = path.join(dir, 'features', s.feature, `domain/${s.store}.domain.ts`);
          fs.renameSync(file, `${file}.off`);
          try {
            const result = JSON.parse(proofRun().stdout);
            assert.equal(result.chain.complete, false);
            assert.equal(result.tests[0].failure.kind, 'convention');
            assert.match(result.tests[0].failure.selector, new RegExp(`${s.store}\\.domain`));
          } finally {
            fs.renameSync(`${file}.off`, file);
          }
          assert.equal(proofRun().status, 0);
        });
      }
    });
  }
}

test('a service that was generated from the endpoint source is not silently turned into another: an existing project keeps its bytes when regenerated with no source', NEEDS_RUNTIME, () => {
  const dir = initProject('react-spa', 'source-keep');
  assert.equal(run(['create', 'feature', 'shop'], dir).status, 0);
  const args = ['create', 'layer', 'Products', '--feature', 'shop', '--layers', 'domain,service', '--shape', 'list'];
  assert.equal(run(args, dir).status, 0);
  const service = path.join(dir, 'features', 'shop', 'services', 'Products.service.ts');
  const first = fs.readFileSync(service, 'utf8');
  assert.match(first, /fetch\('\/api\/products'/, 'no --source: the endpoint, as before #621');
  assert.equal(run([...args, '--source', 'endpoint'], dir).status, 0);
  assert.equal(fs.readFileSync(service, 'utf8'), first, 'saying endpoint is saying nothing');
  assert.equal(fs.existsSync(path.join(dir, 'features', 'shop', 'domain', 'ProductsStore.domain.ts')), false);
});
