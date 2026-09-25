// #621 (part of #616, relates to #400) -- where a shaped screen reads its data from: the closed question `q-source`, the `--source` argument on the one
// mechanism (enum, schema, touches, usage), the OpenAPI reader the service generator and the shapes share, the three generated services and the local
// store, the plan (the answer rides on every step; the default is the OpenAPI operation, else local), the proofs that adapt, and the decision trace. The whole
// path on a real project (validate, tsc, render, the proof green and red) is test/shape-source-chain.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { PLAN_FLOWS, PLAN_SOURCES, planToCommand, validatePlan, planTouches } from '../packages/core/plan.mjs';
import { SHAPES, generateShapeVertical, shapeContext, shapeFiles, shapeTouches } from '../packages/core/shapes.mjs';
import { SOURCES, SOURCE_QUESTION_ID, UNSPECIFIED_SOURCE, readSource, sourceOffer, storeNames } from '../packages/core/shape-source.mjs';
import { OPENAPI_FILES, findEntityOperation, findOpenApiFile, loadOpenApiDocument } from '../packages/core/openapi-spec.mjs';
import { parseOperations } from '../packages/core/service-generator.mjs';
import { proofFiles, proofTouches, generateProof } from '../packages/core/proof.mjs';
import { choicesFromWiring, wiringChooserId } from '../packages/core/decision-trace-adapters.mjs';
import { flowBlock } from '../packages/core/block-flows.mjs';
import { cardOf, run, shapeProject } from '../test-utils/shapeChain.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const LAYERS = ['domain', 'service', 'hook', 'component', 'page', 'controller'];
const FIELDS = 'id:string,name:string,price:number';
const REQUESTS = {
  list: { shape: 'list', name: 'Products', feature: 'shop', entity: 'Product', fields: FIELDS },
  detail: { shape: 'detail', name: 'Product', feature: 'shop', entity: 'Product', fields: FIELDS },
  form: { shape: 'form', name: 'AddProduct', feature: 'shop', entity: 'Product', fields: FIELDS },
};
const SPEC = `openapi: 3.0.3
info: { title: Shop, version: '1' }
servers: [{ url: 'https://shop.example.com/v1' }]
paths:
  /products:
    get: { operationId: listProducts, responses: { '200': { description: ok } } }
    post: { operationId: createProduct, responses: { '201': { description: ok } } }
  /products/{id}:
    get: { operationId: getProduct, responses: { '200': { description: ok } } }
`;
const put = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const tree = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter((f) => f.startsWith('features') && fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

// ---------------------------------------------------------------------------------------------------- one mechanism, four places

test('the sources are one enum: the shape module, the plan registry, the schema and the CLI usage name the same three, and a step without one is optional', () => {
  assert.deepEqual([...SOURCES], ['local', 'endpoint', 'openapi']);
  assert.deepEqual([...PLAN_SOURCES], [...SOURCES]);
  assert.equal(UNSPECIFIED_SOURCE, 'endpoint', 'what no source means: every plan written before #621');
  const schema = JSON.parse(fs.readFileSync(new URL('../schemas/plan.v1.json', import.meta.url), 'utf8'));
  const enums = [];
  (function walk(node) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      if (node.properties?.shape?.enum && node.properties.source?.enum) enums.push(node.properties.source.enum); // not the ticket's own `source`
      Object.values(node).forEach(walk);
    }
  })(schema);
  assert.equal(enums.length, 3, 'create.unit, create.layer and create.proof carry it');
  for (const e of enums) assert.deepEqual(e, [...SOURCES], 'the schema mirrors the registry');
  for (const id of ['create.unit', 'create.layer', 'create.proof']) {
    const arg = PLAN_FLOWS[id].args.source;
    assert.deepEqual([arg.flag, arg.enum, arg.required], ['--source', [...SOURCES], undefined], `${id}: an optional enum argument`);
  }
  for (const id of ['create.feature', 'create.route', 'test.proof']) assert.equal(PLAN_FLOWS[id].args.source, undefined, `${id} has no source`);
  const usage = run(['--help'], makeTempDir('construct-source-usage-')).stdout;
  assert.match(usage, /--shape list\|detail\|form\|dashboard \[--entity <Entity>\] \[--fields id:string,name:string,\.\.\.\] \[--source local\|endpoint\|openapi\]/);
  assert.match(usage, /create proof <Name> --feature <feature> .*\[--source local\|endpoint\|openapi\]/);
});

test('readSource: nothing is endpoint, a known source is itself, an unknown one is refused by name', () => {
  assert.deepEqual([undefined, null, ''].map(readSource), ['endpoint', 'endpoint', 'endpoint']);
  assert.deepEqual(SOURCES.map(readSource), [...SOURCES]);
  assert.throws(() => readSource('graphql'), /Unknown data source "graphql"\. The sources are: local, endpoint, openapi\./);
  assert.deepEqual(storeNames('list', 'Products'), { file: 'ProductsStore', seed: 'seedProducts', op: 'readProducts' });
  assert.deepEqual([storeNames('detail', 'Product').op, storeNames('form', 'AddProduct').op], ['findProduct', 'saveAddProduct']);
});

// ---------------------------------------------------------------------------------------------------------------- the OpenAPI reader

test('findOpenApiFile: openapi.yaml, .yml or .json at the root, else in api/, in that order; a folder of that name does not count', () => {
  assert.deepEqual([...OPENAPI_FILES], ['openapi.yaml', 'openapi.yml', 'openapi.json', 'api/openapi.yaml', 'api/openapi.yml', 'api/openapi.json']);
  const dir = makeTempDir('construct-source-find-');
  assert.equal(findOpenApiFile(dir), null);
  fs.mkdirSync(path.join(dir, 'openapi.yaml'));
  assert.equal(findOpenApiFile(dir), null, 'a directory is not a spec');
  put(dir, 'api/openapi.json', '{}');
  assert.equal(findOpenApiFile(dir), 'api/openapi.json');
  put(dir, 'api/openapi.yml', 'x');
  assert.equal(findOpenApiFile(dir), 'api/openapi.yml');
  put(dir, 'openapi.json', '{}');
  assert.equal(findOpenApiFile(dir), 'openapi.json', 'the root wins over api/');
  put(dir, 'openapi.yml', 'x');
  assert.equal(findOpenApiFile(dir), 'openapi.yml');
  fs.rmSync(path.join(dir, 'openapi.yaml'), { recursive: true });
  put(dir, 'openapi.yaml', 'x');
  assert.equal(findOpenApiFile(dir), 'openapi.yaml');
});

test('findEntityOperation: list is GET on the plural, detail is GET with one trailing parameter, form is POST on the plural; the first match in the document wins', () => {
  const dir = makeTempDir('construct-source-op-');
  put(dir, 'openapi.yaml', SPEC);
  const at = (kind, plural = 'Products') => findEntityOperation(dir, { kind, plural });
  assert.deepEqual(at('list'), { file: 'openapi.yaml', method: 'GET', path: '/products', url: '/v1/products', operationId: 'listProducts' }, 'the server path prefix is kept, its host is not');
  assert.deepEqual(at('detail'), { file: 'openapi.yaml', method: 'GET', path: '/products/{id}', url: '/v1/products', operationId: 'getProduct' });
  assert.deepEqual(at('form'), { file: 'openapi.yaml', method: 'POST', path: '/products', url: '/v1/products', operationId: 'createProduct' });
  assert.equal(at('list', 'Orders'), null, 'another entity');
  assert.equal(at('grid'), null, 'an unknown kind');
  assert.equal(findEntityOperation(dir, { kind: 'list' }), null, 'no plural');
});

test('findEntityOperation: names read alike whatever their separator, a missing operation, a path with other parameters and a broken file all answer null, never throw', () => {
  const spec = (paths, extra = '') => `openapi: 3.0.3\ninfo: { title: t, version: '1' }\n${extra}paths:\n${paths}`;
  const dir = makeTempDir('construct-source-names-');
  const find = (text, kind, plural, file = 'openapi.yaml') => {
    put(dir, file, text);
    return findEntityOperation(dir, { kind, plural });
  };
  assert.equal(find(spec("  /order-items:\n    get: { responses: { '200': { description: ok } } }\n"), 'list', 'OrderItems')?.url, '/order-items');
  assert.equal(find(spec("  /order_items:\n    get: { responses: { '200': { description: ok } } }\n"), 'list', 'OrderItems')?.url, '/order_items');
  assert.equal(find(spec("  /orderItems:\n    get: { responses: { '200': { description: ok } } }\n"), 'list', 'OrderItems')?.url, '/orderItems');
  assert.equal(find(spec("  /products:\n    get: { responses: { '200': { description: ok } } }\n"), 'form', 'Products'), null, 'a spec that lists but cannot create has no form operation');
  assert.equal(find(spec("  /products:\n    post: { responses: { '201': { description: ok } } }\n"), 'list', 'Products'), null, 'a spec that creates but cannot list has no list operation');
  assert.equal(find(spec("  /shops/{shopId}/products:\n    get: { responses: { '200': { description: ok } } }\n"), 'list', 'Products'), null, 'a parameter before the collection is more than the screen can fill');
  assert.equal(find(spec("  /products/{id}/reviews:\n    get: { responses: { '200': { description: ok } } }\n"), 'detail', 'Products'), null, 'the parameter must be the last segment');
  assert.equal(find(spec("  /products/{id}:\n    get: { responses: { '200': { description: ok } } }\n"), 'list', 'Products'), null, 'a list is not an item path');
  assert.equal(find(spec("  /products:\n    get: { responses: { '200': { description: ok } } }\n", 'servers: [{ url: "https://{env}.example.com/v1" }]\n'), 'list', 'Products')?.url, '/products', 'a server with variables gives no prefix');
  assert.equal(find(spec("  /products:\n    get: { responses: { '200': { description: ok } } }\n", 'servers: [{ url: /api/ }]\n'), 'list', 'Products')?.url, '/api/products');
  assert.equal(find('{ this is: [not yaml', 'list', 'Products'), null, 'an unreadable file');
  assert.equal(find('info: {}', 'list', 'Products'), null, 'a file with no paths');
  assert.equal(find(JSON.stringify({ openapi: '3.0.3', info: { title: 't', version: '1' }, paths: { '/products': { get: { responses: {} } } } }), 'list', 'Products', 'openapi.json'), null, 'the first file found is the one read: a broken openapi.yaml is not skipped for a good openapi.json');
});

test('the service generator and the shapes read a spec with the same reader, so a bad file fails with the same words', () => {
  const dir = makeTempDir('construct-source-reader-');
  assert.throws(() => loadOpenApiDocument(path.join(dir, 'nope.yaml')), /OpenAPI spec not found/);
  put(dir, 'empty.yaml', 'info: {}');
  assert.throws(() => loadOpenApiDocument(path.join(dir, 'empty.yaml')), /has no "paths"/);
  assert.throws(() => parseOperations(path.join(dir, 'empty.yaml')), /has no "paths"/, 'create service reads it through the same function');
  put(dir, 'ok.yaml', SPEC);
  assert.equal(parseOperations(path.join(dir, 'ok.yaml')).length, 3);
});

// ---------------------------------------------------------------------------------------------------------------------- the question

test('sourceOffer: no OpenAPI file offers local and endpoint, and local is the rules default; nothing is chosen and nothing is refused', () => {
  const dir = makeTempDir('construct-source-offer-');
  const offer = sourceOffer(dir, { shape: 'list', unit: 'Products', plural: 'Products', endpoint: '/api/products' });
  assert.deepEqual(offer.question.options.map((o) => [o.id, o.enabled]), [['local', true], ['endpoint', true]]);
  assert.deepEqual([offer.question.id, offer.question.default, offer.question.chosen, offer.source, offer.operation, offer.unavailable, offer.refused], [SOURCE_QUESTION_ID, 'local', null, 'local', null, null, null]);
  assert.deepEqual([offer.question.unit, offer.question.shape, offer.question.suggestion], ['Products', 'list', { option: 'local', reason: 'No OpenAPI operation for this screen was found, so a local store lets it work with no backend.', provider: 'rules' }]);
  assert.equal(offer.question.options[1].label, 'Call GET /api/products');
  assert.match(offer.question.options[1].why, /must exist in your app/);
});

test('sourceOffer: with the operation in the spec, openapi comes first and is the rules default; the same spec without it is not offered and says why', () => {
  const dir = makeTempDir('construct-source-offer-');
  put(dir, 'api/openapi.yaml', SPEC);
  const list = sourceOffer(dir, { shape: 'list', unit: 'Products', plural: 'Products', endpoint: '/api/products' });
  assert.deepEqual(list.question.options.map((o) => o.id), ['openapi', 'local', 'endpoint']);
  assert.deepEqual([list.question.default, list.source, list.operation.url, list.unavailable], ['openapi', 'openapi', '/v1/products', null]);
  assert.equal(list.question.options[0].label, 'Use the contract in api/openapi.yaml');
  assert.equal(list.question.options[0].why, 'Requests GET /v1/products (listProducts), the path the OpenAPI file gives.');
  assert.match(list.question.suggestion.reason, /^The project has api\/openapi\.yaml, and it has an operation that lists products \(GET \/products\)/);
  const orders = sourceOffer(dir, { shape: 'list', unit: 'Orders', plural: 'Orders', endpoint: '/api/orders' });
  assert.deepEqual([orders.question.options.map((o) => o.id), orders.question.default, orders.source], [['local', 'endpoint'], 'local', 'local']);
  assert.match(orders.unavailable, /^api\/openapi\.yaml has no operation that lists orders \(GET on a path ending in \/orders\), so the openapi source is not offered\.$/);
  const detail = sourceOffer(dir, { shape: 'detail', unit: 'Order', plural: 'Orders', endpoint: '/api/orders' });
  assert.match(detail.unavailable, /reads one orders \(GET on a path ending in \/orders\/\{id\}\)/);
});

test('sourceOffer: an answer is used and recorded as chosen; one that was not offered is refused, never replaced; the summary has a fixed size', () => {
  const dir = makeTempDir('construct-source-answer-');
  const request = { shape: 'form', unit: 'AddProduct', plural: 'Products', endpoint: '/api/products' };
  const chosen = sourceOffer(dir, { ...request, answer: { option: 'endpoint', by: 'person' } });
  assert.deepEqual([chosen.question.chosen, chosen.source, chosen.refused], ['endpoint', 'endpoint', null]);
  assert.equal(chosen.question.options[1].label, 'Call POST /api/products', 'a form posts');
  const bare = sourceOffer(dir, { ...request, answer: 'local' });
  assert.deepEqual([bare.question.chosen, bare.source], ['local', 'local'], 'a bare option id is an answer too');
  const refused = sourceOffer(dir, { ...request, answer: 'openapi' });
  assert.deepEqual([refused.question.chosen, refused.source], [null, 'local'], 'the default stands in the summary; the plan reports the refusal');
  assert.match(refused.refused, /"q-source" has no option "openapi" here\. Options: local, endpoint\./);
  put(dir, 'openapi.yaml', SPEC);
  const long = sourceOffer(dir, { ...request, unit: 'A'.repeat(300), plural: 'Products' });
  assert.ok(long.question.question.length <= 160);
  for (const o of long.question.options) assert.ok(o.label.length <= 60 && o.why.length <= 120, o.id);
  assert.equal(JSON.stringify(long).includes(dir), false, 'no path in the summary');
});

// ---------------------------------------------------------------------------------------------------------------------- the templates

test('an unspecified source is exactly the endpoint source: the same bytes for every layer of every shape, and the store exists only for local', () => {
  const dir = shapeProject();
  for (const request of Object.values(REQUESTS)) {
    for (const layer of LAYERS) {
      const bare = shapeFiles(dir, { ...request, layer });
      assert.deepEqual(shapeFiles(dir, { ...request, layer, source: 'endpoint' }), bare, `${request.shape} ${layer}`);
      assert.ok(bare.every((f) => !f.path.includes('Store')), 'the endpoint source writes no store');
    }
  }
});

test('local: the domain layer gains the store (seed rows, a pure operation), types.ts stays complete, and the service reads it with no fetch and answers the same typed result', () => {
  const dir = shapeProject();
  const at = (request, layer) => Object.fromEntries(shapeFiles(dir, { ...request, layer, source: 'local' }).map((f) => [path.basename(f.path), f.content]));
  const list = at(REQUESTS.list, 'domain');
  assert.deepEqual(Object.keys(list), ['Products.domain.ts', 'ProductsStore.domain.ts', 'types.ts']);
  assert.match(list['ProductsStore.domain.ts'], /export const seedProducts = defineDomain<Record<string, never>, Product\[\]>\('seedProducts', \(\) => \[\n {2}\{ id: 'product-1', name: 'Product name 1', price: 12\.5 \},\n {2}\{ id: 'product-2', name: 'Product name 2', price: 7 \},\n\]\);/);
  assert.match(list['ProductsStore.domain.ts'], /export const readProducts = defineDomain<\{ rows: readonly Product\[\] \}, ProductsResult>\('readProducts', \(\{ rows \}\) => \(\{ status: 'ready', items: \[\.\.\.rows\] \}\)\);/);
  const service = at(REQUESTS.list, 'service')['Products.service.ts'];
  assert.match(service, /import \{ readProducts, seedProducts \} from '\.\.\/domain\/ProductsStore\.domain';/);
  assert.match(service, /const rows: Product\[\] = seedProducts\(\{\}\);/);
  assert.match(service, /defineService\('fetchProducts', async \(\{ signal \}: \{ signal: AbortSignal \}\): Promise<ProductsResult> =>/);
  assert.match(service, /if \(signal\.aborted\) return \{ status: 'error', message: 'The request was cancelled\.' \};/);
  assert.equal(/\bfetch\(/.test(service), false, 'no network');

  const detail = at(REQUESTS.detail, 'domain')['ProductStore.domain.ts'];
  assert.match(detail, /export const findProduct = defineDomain<\{ rows: readonly Product\[\]; id: string \}, ProductDetailResult>/);
  assert.match(detail, /return item \? \{ status: 'ready', item \} : \{ status: 'not-found' \};/);
  assert.match(at(REQUESTS.detail, 'service')['Product.service.ts'], /async \(\{ id, signal \}: \{ id: string; signal: AbortSignal \}\): Promise<ProductDetailResult>/);

  const form = at(REQUESTS.form, 'domain');
  assert.match(form['types.ts'], /export interface Product \{\n {2}id: string;\n {2}name: string;\n {2}price: number;\n\}/, 'the form needs the row type the store holds');
  assert.match(form['AddProductStore.domain.ts'], /\{ id: `product-\$\{rows\.length \+ 1\}`, \.\.\.input \}/);
  const formService = at(REQUESTS.form, 'service')['AddProduct.service.ts'];
  assert.match(formService, /let rows: Product\[\] = seedAddProduct\(\{\}\);/);
  assert.match(formService, /rows = saveAddProduct\(\{ rows, input \}\);\n {2}return \{ status: 'submitted' \};/);
  const numeric = shapeFiles(dir, { ...REQUESTS.form, fields: 'id:number,name:string', layer: 'domain', source: 'local' }).find((f) => f.path.endsWith('AddProductStore.domain.ts')).content;
  assert.match(numeric, /\{ id: rows\.length \+ 1, \.\.\.input \}/, 'a number id is the next number');
});

test('openapi: the service asks the path the operation gives, names the operation, and is otherwise the endpoint service; without the operation it is refused, nothing written', () => {
  const dir = shapeProject();
  put(dir, 'openapi.yaml', SPEC);
  const service = (request) => shapeFiles(dir, { ...request, layer: 'service', source: 'openapi' })[0].content;
  const endpointService = (request) => shapeFiles(dir, { ...request, layer: 'service', source: 'endpoint' })[0].content;
  assert.match(service(REQUESTS.list), /^\/\/ Data source: GET \/products \(listProducts\) of openapi\.yaml\.$/m);
  assert.match(service(REQUESTS.list), /await fetch\('\/v1\/products', \{ signal \}\)/);
  assert.match(service(REQUESTS.detail), /await fetch\(`\/v1\/products\/\$\{encodeURIComponent\(id\)\}`, \{ signal \}\)/, 'the item path is the collection plus the encoded id');
  assert.match(service(REQUESTS.form), /await fetch\('\/v1\/products', \{ method: 'POST'/);
  assert.equal(service(REQUESTS.list).replace(/^\/\/ Data source:.*\n/m, '').replace('/v1/products', '/api/products'), endpointService(REQUESTS.list), 'only the comment and the path differ');
  assert.deepEqual(shapeContext(dir, { ...REQUESTS.list, source: 'openapi' }).operation.operationId, 'listProducts');
  fs.rmSync(path.join(dir, 'openapi.yaml'));
  const before = tree(dir);
  assert.throws(() => generateShapeVertical(dir, { ...REQUESTS.list, source: 'openapi' }, LAYERS), /The openapi source needs an OpenAPI file \(openapi\.yaml, openapi\.yml or openapi\.json, at the project root or in api\/\) with the operation GET on a path ending in \/products\. Nothing was written/);
  assert.deepEqual(tree(dir), before, 'nothing was written');
  put(dir, 'openapi.yaml', SPEC.replace('  /products/{id}:', '  /widgets/{id}:'));
  assert.throws(() => shapeContext(dir, { ...REQUESTS.detail, source: 'openapi' }), /operation GET on a path ending in \/products\/\{id\}/);
  assert.equal(shapeTouches(dir, { ...REQUESTS.detail, layer: 'service', source: 'openapi' }), null, 'a plan step that cannot be generated declares nothing');
});

test('an unknown source writes nothing, whatever the layer set; every source is deterministic (a second run writes the same bytes)', () => {
  const dir = shapeProject();
  const before = tree(dir);
  assert.throws(() => generateShapeVertical(dir, { ...REQUESTS.list, source: 'graphql' }, LAYERS), /Unknown data source "graphql"/);
  assert.deepEqual(tree(dir), before);
  put(dir, 'openapi.yaml', SPEC);
  for (const source of SOURCES) {
    for (const request of Object.values(REQUESTS)) {
      const one = LAYERS.flatMap((layer) => shapeFiles(dir, { ...request, layer, source }).map((f) => [f.path, f.content]));
      const two = LAYERS.flatMap((layer) => shapeFiles(dir, { ...request, layer, source }).map((f) => [f.path, f.content]));
      assert.deepEqual(one, two, `${request.shape} ${source}`);
    }
  }
});

test('the local store is a domain-layer unit built with the factory, and the layer check counts it: a service layer alone needs the store the domain wrote', () => {
  const dir = shapeProject();
  const only = (layers, source) => generateShapeVertical(dir, { ...REQUESTS.list, source }, layers);
  assert.throws(() => only(['service'], 'local'), /imports domain, which isn't in this request and don't exist yet/);
  only(['domain'], 'endpoint');
  assert.throws(() => only(['service'], 'local'), /imports domain, which isn't in this request and don't exist yet/, 'the domain of another source has no store: the local service would import a file that is not there');
  only(['domain'], 'local');
  assert.doesNotThrow(() => only(['service'], 'local'));
});

// ------------------------------------------------------------------------------------------------------- the CLI and the plan step

test('the CLI: --source needs --shape, an unknown source and a missing spec are usage errors that write nothing, and a valid one writes the store', () => {
  const dir = shapeProject();
  const before = tree(dir);
  const alone = run(['create', 'layer', 'Products', '--feature', 'shop', '--layers', 'domain', '--source', 'local'], dir);
  assert.notEqual(alone.status, 0);
  assert.match(alone.stderr, /--source only applies with --shape/);
  const bad = run(['create', 'layer', 'Products', '--feature', 'shop', '--layers', 'domain,service', '--shape', 'list', '--source', 'graphql'], dir);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Unknown data source "graphql"\. The sources are: local, endpoint, openapi\./);
  const missing = run(['create', 'domain', 'Products', '--feature', 'shop', '--shape', 'list', '--source', 'openapi'], dir);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /The openapi source needs an OpenAPI file/);
  assert.deepEqual(tree(dir), before, 'three refusals, no file');
  const ok = run(['create', 'layer', 'Products', '--feature', 'shop', '--layers', 'domain,service', '--shape', 'list', '--source', 'local'], dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Created features\/shop\/domain\/ProductsStore\.domain\.ts/);
  const json = run(['create', 'domain', 'Orders', '--feature', 'shop', '--shape', 'list', '--source', 'local', '--format', 'json'], dir);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).files, ['features/shop/domain/Orders.domain.ts', 'features/shop/domain/OrdersStore.domain.ts', 'features/shop/types.ts']);
});

test('a shaped plan step declares every file its source writes, in the unit and layer flows, and the command carries --source', () => {
  const dir = shapeProject();
  const declared = (flow, args) => {
    const scope = flowBlock(flow).declaredScope(args, { root: dir });
    return scope ? scope.files.map((f) => `${f.change} ${path.basename(f.path)}`) : null;
  };
  assert.deepEqual(declared('create.unit', { layer: 'domain', name: 'Products', feature: 'shop', shape: 'list', entity: 'Product', fields: FIELDS, source: 'local' }), ['create Products.domain.ts', 'create ProductsStore.domain.ts', 'modify types.ts']);
  assert.deepEqual(declared('create.unit', { layer: 'domain', name: 'Products', feature: 'shop', shape: 'list', entity: 'Product', fields: FIELDS, source: 'endpoint' }), ['create Products.domain.ts', 'modify types.ts']);
  assert.deepEqual(declared('create.unit', { layer: 'domain', name: 'Products', feature: 'shop', shape: 'list', entity: 'Product', fields: FIELDS }), ['create Products.domain.ts', 'modify types.ts'], 'no source: what it always was');
  assert.deepEqual(declared('create.layer', { name: 'Products', feature: 'shop', layers: ['service', 'domain'], shape: 'list', source: 'local' }), ['create Products.domain.ts', 'create ProductsStore.domain.ts', 'modify types.ts', 'create Products.service.ts']);
  assert.equal(declared('create.unit', { layer: 'domain', name: 'Products', feature: 'shop', shape: 'list', source: 'openapi' }), null, 'no spec, no derivable files');
  const step = { id: 's1', title: 'x', flow: 'create.unit', args: { layer: 'service', name: 'Products', feature: 'shop', shape: 'list', entity: 'Product', fields: FIELDS, source: 'local' }, executor: 'deterministic' };
  assert.deepEqual(planToCommand(step).argv, ['create', 'service', 'Products', '--feature', 'shop', '--shape', 'list', '--entity', 'Product', '--fields', FIELDS, '--source', 'local']);
  const plan = { version: 1, ticket: { source: 'text', title: 't' }, steps: [{ id: 's1', title: 'f', flow: 'create.feature', args: { name: 'shop' }, executor: 'deterministic', touches: { features: ['shop'], files: [] } }, { ...step, id: 's2', dependsOn: ['s1'], touches: flowBlock('create.unit').declaredScope(step.args, { root: dir }) }] };
  assert.deepEqual(validatePlan({ ...plan, steps: plan.steps.map((s, i) => (i === 1 ? { ...s, args: { ...s.args, source: 'graphql' } } : s)) }).valid, false, 'the schema and the enum refuse an unknown source');
});

// ---------------------------------------------------------------------------------------------------------------------- the plan

const blocksOf = (sentence, shape, framework = 'react-spa') => placeCard(cardOf(sentence), { framework, answers: { 'q-shape': shape } });
const LIST = 'A user wants to see a list of products';
const planOf = (dir, options = {}, placed = blocksOf(LIST, 'list')) => planFromBlocks(placed.blocks, { feature: 'shop', root: dir, decisions: placed.decisions, ...options });
const unitSteps = (planned) => planned.plan.steps.filter((s) => s.flow === 'create.unit');

test('planFromBlocks asks q-source for every shaped screen: local by default, openapi when the spec has the operation, and the answer rides on every step of the screen and its proof', () => {
  const dir = shapeProject();
  const local = planOf(dir);
  assert.equal(local.ok, true, JSON.stringify(local.errors));
  assert.deepEqual(local.offers.filter((o) => o.id.startsWith('q-source')).map((o) => [o.id, o.default, o.chosen, o.options.map((x) => x.id)]), [['q-source', 'local', null, ['local', 'endpoint']]]);
  assert.ok([...unitSteps(local), local.plan.steps.find((s) => s.flow === 'create.proof')].every((s) => s.args.source === 'local'));
  assert.deepEqual(local.decisions.filter((d) => d.question === 'q-source'), [], 'an unanswered question records no decision: nobody chose');
  assert.equal(local.notes.at(-1).startsWith('The Products screen reads a typed in-memory store (seed rows in domain/ProductsStore.domain.ts)'), true);
  assert.deepEqual(validatePlan(local.plan), { valid: true, errors: [] });

  put(dir, 'openapi.yaml', SPEC);
  const spec = planOf(dir);
  assert.deepEqual(spec.offers.filter((o) => o.id === 'q-source').map((o) => [o.default, o.options.map((x) => x.id)]), [['openapi', ['openapi', 'local', 'endpoint']]]);
  assert.ok(unitSteps(spec).every((s) => s.args.source === 'openapi'));
  assert.match(spec.notes.at(-1), /^The Products screen requests GET \/v1\/products, the path of an operation in openapi\.yaml; the server behind that spec must serve it\.$/);
  for (const source of ['local', 'endpoint']) assert.ok(unitSteps(planOf(dir, { answers: { 'q-source': source } })).every((s) => s.args.source === source), `${source} can still be chosen over the contract`);
});

test('the plan says what each source leaves to do: the endpoint must exist, the contract must be served, the store is replaceable; and a spec without the operation says why it was not offered', () => {
  const dir = shapeProject();
  const endpoint = planOf(dir, { answers: { 'q-source': 'endpoint' } });
  assert.equal(endpoint.notes.at(-1), 'The Products screen calls GET /api/products; that endpoint must exist in your app (a route handler or your backend), nothing in this plan creates it.');
  put(dir, 'openapi.yaml', SPEC.replace('    post:', '    put:'));
  const form = planOf(dir, {}, blocksOf('A user wants to add a product with a name and a price', 'form'));
  assert.equal(form.ok, true, JSON.stringify(form.errors));
  assert.deepEqual(form.offers.find((o) => o.id === 'q-source').options.map((o) => o.id), ['local', 'endpoint'], 'the spec has no POST on /products');
  assert.match(form.notes.join('\n'), /openapi\.yaml has no operation that creates products \(POST on a path ending in \/products\), so the openapi source is not offered\./);
  assert.ok(unitSteps(form).every((s) => s.args.source === 'local'));
});

test('a wrong answer to q-source is a typed error, not a guess: openapi with no spec, and an unknown option', () => {
  const dir = shapeProject();
  for (const answer of ['openapi', 'graphql']) {
    const refused = planOf(dir, { answers: { 'q-source': answer } });
    assert.deepEqual([refused.ok, refused.plan, refused.errors.map((e) => [e.code, e.path])], [false, null, [['PLAN_SOURCE_UNAVAILABLE', 'answers.q-source']]], answer);
  }
});

test('the answer is recorded with who gave it, and becomes a decision trace for replay: q-source answered by a person, by the rules provider, by a plugin', () => {
  const dir = shapeProject();
  const planned = planOf(dir, { answers: { 'q-source': { option: 'endpoint', by: 'decision-model', provider: 'rules' } } });
  assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-source'), [{ question: 'q-source', option: 'endpoint', by: 'decision-model', provider: 'rules' }]);
  assert.equal(wiringChooserId('q-source'), 'requirement.plan.source');
  assert.equal(wiringChooserId('q-source-add-product'), 'requirement.plan.source');
  assert.equal(wiringChooserId('q-sources'), 'requirement.plan.other');
  const [choice] = choicesFromWiring(planned).filter((c) => c.chooser.id === 'requirement.plan.source');
  assert.deepEqual([choice.chosen, choice.by, choice.provider, choice.summary.chosen, choice.summary.question], ['endpoint', 'decision-model', 'rules', null, 'Where should the "Products" screen read its data from?'], 'the summary is what was offered, not what was chosen');
  assert.deepEqual(choice.summary.options.map((o) => o.id), ['local', 'endpoint']);
  assert.equal(JSON.stringify(choice).includes(dir), false, 'no path in a trace');
  assert.deepEqual(choicesFromWiring(planOf(dir)).filter((c) => c.chooser.id === 'requirement.plan.source'), [], 'unanswered: no choice to record');
});

test('the browser flow is planned for a network source and not for a local one (nothing to mock), and the note says why', () => {
  const dir = shapeProject();
  put(dir, 'playwright.config.ts', "export default { testDir: 'features' };\n");
  const flows = (planned) => planned.plan.steps.filter((s) => s.flow === 'create.proof').map((s) => s.args.kind);
  assert.deepEqual(flows(planOf(dir, { answers: { 'q-source': 'endpoint' } })), ['render', 'playwright']);
  const local = planOf(dir);
  assert.deepEqual(flows(local), ['render']);
  assert.match(local.proof.playwright.skipped, /^No browser flow is planned for Products \(list\): a local data source makes no request to mock\. The render proof still proves the screen\.$/);
  put(dir, 'openapi.yaml', SPEC);
  const spec = planOf(dir);
  assert.deepEqual(flows(spec), ['render', 'playwright'], 'the contract is a network source: its path is what the browser flow mocks');
  const flow = spec.plan.steps.find((s) => s.args.kind === 'playwright');
  assert.equal(flow.args.source, 'openapi');
});

test('several shaped screens in one plan each get their own question, q-source-<name>, and their own answer', () => {
  const dir = shapeProject();
  const products = blocksOf(LIST, 'list');
  const orders = placeCard(cardOf('A user wants to see a list of orders'), { framework: 'react-spa', answers: { 'q-shape': 'list' } });
  const planned = planFromBlocks([...products.blocks, ...orders.blocks.map((b) => ({ ...b, id: `o${b.id}` }))], { feature: 'shop', root: dir, answers: { 'q-source-orders': 'endpoint' } });
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(planned.offers.filter((o) => o.id.startsWith('q-source')).map((o) => [o.id, o.unit, o.chosen]), [['q-source-products', 'Products', null], ['q-source-orders', 'Orders', 'endpoint']]);
  const sourceOf = (name) => unitSteps(planned).filter((s) => s.args.name === name).map((s) => s.args.source);
  assert.deepEqual([...new Set(sourceOf('Products'))], ['local']);
  assert.deepEqual([...new Set(sourceOf('Orders'))], ['endpoint']);
});

test('planFromBlocks needs no wiring to ask the question, and a plan for a card that has no shape asks nothing', () => {
  const dir = shapeProject();
  assert.deepEqual(planOf(dir, { wire: false, proof: false }).offers.map((o) => o.id), ['q-source']);
  const plain = planFromBlocks(placeCard(cardOf(LIST), { framework: 'react-spa' }).blocks, { feature: 'shop', root: dir });
  assert.deepEqual([plain.offers, plain.plan.steps.some((s) => 'source' in s.args)], [[], false]);
  assert.deepEqual(planTouches(planOf(dir).plan).files.filter((f) => f.path.includes('Store')).map((f) => f.path), ['features/shop/domain/ProductsStore.domain.ts']);
});

// ---------------------------------------------------------------------------------------------------------------------- the proofs

test('a proof is written from the source: local drives the store with no network, openapi asserts the path, endpoint is unchanged, and each says so on its command line', () => {
  const dir = shapeProject();
  put(dir, 'openapi.yaml', SPEC);
  const proof = (request, source) => proofFiles(dir, { ...request, kind: 'render', source })[0].content;
  const bare = proof(REQUESTS.list);
  assert.equal(proof(REQUESTS.list, 'endpoint'), bare, 'no source and endpoint are the same proof, byte for byte');
  assert.ok(!bare.includes('--source'), 'an old proof is regenerated exactly');
  const local = proof(REQUESTS.list, 'local');
  assert.match(local, /^\/\/ Generated by `construct create proof Products --feature shop --entity Product --fields id:string,name:string,price:number --source local`\./m);
  assert.match(local, /import \{ seedProducts \} from '\.\.\/\.\.\/domain\/ProductsStore\.domain';/);
  assert.match(local, /the local store must not use the network/);
  assert.match(local, /assert\.deepEqual\(result\.status === 'ready' \? result\.items : null, seedProducts\(\{\}\)/);
  assert.match(local, /a cancelled request is an error result/);
  assert.equal(local.includes('respond(500'), false, 'no fetch stub of a server');
  const open = proof(REQUESTS.list, 'openapi');
  assert.match(open, /asks the path of the OpenAPI operation/);
  assert.match(open, /assert\.equal\(asked, "\/v1\/products", "the path is the one of GET \/products in openapi\.yaml"\);/);
  assert.ok(open.includes('respond(500'), 'and the network cases stay');
  for (const shape of ['detail', 'form']) {
    const l = proof(REQUESTS[shape], 'local');
    assert.match(l, /--source local`/, shape);
    assert.match(l, /from '\.\.\/\.\.\/domain\/\w+Store\.domain'/, shape);
    assert.match(l, /the local store must not use the network/, shape);
    assert.equal(proof(REQUESTS[shape], 'endpoint'), proof(REQUESTS[shape]), shape);
  }
  assert.match(proof(REQUESTS.detail, 'local'), /an id the local store does not hold is not found/);
  assert.match(proof(REQUESTS.form, 'local'), /saving adds one row with a fresh id and leaves the rows it is given alone/);
  assert.match(proof(REQUESTS.detail, 'openapi'), /"\/v1\/products\/a%20b%2Fc"/, 'the detail proof already asserts the address: it is the spec\'s');
  assert.match(proof(REQUESTS.form, 'openapi'), /const ENDPOINT = "\/v1\/products";/);
  assert.deepEqual(proofFiles(dir, { ...REQUESTS.list, kind: 'render', source: 'local' }).map((f) => f.content), [local], 'deterministic');
});

test('the browser proof follows the source: it mocks the spec\'s path for openapi, and a local source has none, with the reason', () => {
  const dir = shapeProject();
  put(dir, 'playwright.config.ts', "export default { testDir: 'features' };\n");
  put(dir, 'openapi.yaml', SPEC);
  const flow = (source) => proofFiles(dir, { ...REQUESTS.list, kind: 'playwright', source });
  assert.match(flow('openapi')[0].content, /page\.route\("\*\*\/v1\/products"/);
  assert.match(flow('openapi')[0].content, /--source openapi`/);
  assert.match(flow(undefined)[0].content, /page\.route\("\*\*\/api\/products"/);
  assert.deepEqual([flow('local'), proofTouches(dir, { ...REQUESTS.list, kind: 'playwright', source: 'local' })], [[], []]);
  const skipped = generateProof(dir, { ...REQUESTS.list, kind: 'playwright', source: 'local' });
  assert.deepEqual(skipped.files, []);
  assert.match(skipped.skipped, /The local data source makes no request, so there is nothing to mock/);
  assert.equal(proofTouches(dir, { ...REQUESTS.list, kind: 'render', source: 'openapi' }).length, 2);
  assert.equal(proofTouches(dir, { ...REQUESTS.list, kind: 'render', source: 'graphql' }), null, 'an unknown source derives nothing');
});

test('the Requirement chain and the docs agree on the mechanism: the shape table has every layer the store needs, and the doc names the three sources', () => {
  for (const shape of Object.values(SHAPES)) assert.ok(shape.requires.service.includes('domain'), 'the service layer imports the domain layer, where the store lives');
  const doc = fs.readFileSync(path.join(here, '..', 'docs', 'PLACEMENT.md'), 'utf8');
  for (const word of ['q-source', '--source local', 'openapi.yaml', 'PLAN_SOURCE_UNAVAILABLE']) assert.ok(doc.includes(word), `docs/PLACEMENT.md mentions ${word}`);
});
