// #625 -- `create.handler`: a Next.js App Router route handler (`app/api/<x>/route.ts`) as a deterministic block with a CLI verb (`construct create handler`), a PLAN_FLOWS entry,
// derived touches, a closed question (`q-handler`) and refusals that say why and write nothing. The route holds no business logic (a domain unit maps the typed result to 200, 400,
// 405 or 500), answers every other method with a typed 405, and never reads a secret. The whole chain (sentence to plan to run to validate, tsc and the proof) is
// test/handler-chain.test.mjs; this file is the block itself: arguments, files, the four methods, a service you name, the refusals and the question.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HANDLER_METHODS, HANDLER_SHAPE_METHODS, handlerArgIssue, handlerContext, handlerFiles, handlerOffer, handlerTouches } from '../packages/core/handler.mjs';
import { PLAN_FLOWS, planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { expectedFiles } from '../packages/core/plan-touches.mjs';
import { flowBlock, flowScopeKind } from '../packages/core/block-flows.mjs';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { wiringChooserId } from '../packages/core/decision-trace-adapters.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { NEEDS_RUNTIME, cardOf, featureTree, initProject, projectFiles, run, shapeProject, typeCheck } from '../test-utils/shapeChain.mjs';

const handler = (dir, ...more) => run(['create', 'handler', 'Products', '--feature', 'shop', ...more], dir);
const featureViolations = (dir) => JSON.parse(run(['validate', '--format', 'json'], dir).stdout).violations.filter((v) => v.file.startsWith('features/') || v.file.startsWith('app/api')).map((v) => `${v.severity} ${v.rule} ${v.file}`);

test('the request is checked by named reasons: the method is closed, the path is /api/ and plain, names are PascalCase', () => {
  const ok = { name: 'Products', feature: 'shop', method: 'GET', path: '/api/products' };
  assert.equal(handlerArgIssue(ok), null);
  assert.deepEqual(HANDLER_METHODS, ['GET', 'POST', 'PUT', 'DELETE']);
  const arg = (extra) => handlerArgIssue({ ...ok, ...extra })?.arg;
  assert.equal(arg({ name: 'products' }), 'name');
  assert.equal(arg({ feature: 'a b' }), 'feature');
  assert.equal(arg({ method: 'PATCH' }), 'method');
  assert.equal(arg({ method: 'get' }), 'method');
  for (const path_ of ['/products', '/api', '/api/Products', '/api/products/[id]', '/api/a b', 'api/products']) assert.equal(arg({ path: path_ }), 'path', path_);
  assert.equal(arg({ path: '/api/order-items/recent' }), undefined);
  assert.equal(arg({ service: 'products' }), 'service');
  assert.equal(arg({ service: 'Products' }), undefined);
  assert.equal(arg({ fields: 'name:string' }), 'fields');
  assert.deepEqual(HANDLER_SHAPE_METHODS, { list: 'GET', form: 'POST', wizard: 'POST' });
});

test('the flow is in the registry, derived, and a plan step means exactly the CLI command', () => {
  const flow = PLAN_FLOWS['create.handler'];
  assert.equal(flowScopeKind('create.handler'), 'derived');
  assert.deepEqual(Object.keys(flow.args), ['name', 'feature', 'method', 'path', 'service', 'entity', 'fields', 'dir']);
  assert.deepEqual(flow.args.method.enum, ['GET', 'POST', 'PUT', 'DELETE']);
  const args = { name: 'Products', feature: 'shop', method: 'POST', path: '/api/products', service: 'Catalog' };
  assert.deepEqual(planToCommand({ flow: 'create.handler', args }).argv, ['create', 'handler', 'Products', '--feature', 'shop', '--method', 'POST', '--path', '/api/products', '--service', 'Catalog']);
  const check = (a, executor = 'deterministic') => validatePlan({ version: 1, ticket: { source: 'text', title: 't' }, steps: [{ id: 's1', title: 't', flow: 'create.handler', executor, args: a, touches: { features: [], files: [] } }] });
  assert.equal(check(args).valid, true);
  assert.equal(check({ ...args, method: 'PATCH' }).errors[0].code, 'STEP_ARG_ENUM');
  assert.equal(check({ name: 'Products', feature: 'shop', method: 'GET' }).errors[0].code, 'STEP_ARG_MISSING');
  assert.equal(check({ ...args, path: '/products' }).errors[0].code, 'STEP_ARG_TYPE');
  assert.equal(check({ ...args, name: 'products' }).errors[0].code, 'STEP_ARG_TYPE');
  assert.equal(check(args, 'local-model').errors[0].code, 'STEP_EXECUTOR_NOT_ALLOWED', 'a fixed template: no model');
});

test('the touches are derived: the route, the domain unit and the service, the types and barrel, the proof; react-spa derives nothing', () => {
  const dir = shapeProject('nextjs');
  const touched = (args) => (expectedFiles(dir, 'create.handler', args) ?? []).map((f) => `${f.change} ${f.path}`);
  assert.deepEqual(touched({ name: 'Products', feature: 'shop', method: 'GET', path: '/api/products' }), [
    'create features/shop/domain/ProductsApi.domain.ts', 'create features/shop/services/ProductsApi.service.ts', 'create app/api/products/route.ts', 'modify features/shop/types.ts', 'modify features/shop/index.ts',
    'create features/shop/tests/generated/ProductsApi.proof.test.ts', 'modify architecture.yml',
  ]);
  fs.writeFileSync(path.join(dir, 'features/shop/services/Catalog.service.ts'), "import { defineService } from '@line/construct-core/typed-contracts';\n\n/** c */\nexport const loadCatalog = defineService('loadCatalog', async ({ input }: { input: unknown }) => ({ status: 'ready' as const, body: input }));\n");
  assert.deepEqual(touched({ name: 'Products', feature: 'shop', method: 'GET', path: '/api/products', service: 'Catalog' }).filter((f) => f.includes('service')), [], 'a named service is not written');
  assert.equal(expectedFiles(dir, 'create.handler', { name: 'Products', feature: 'shop', method: 'GET', path: '/products' }), null, 'an invalid request derives nothing');
  assert.equal(expectedFiles(dir, 'create.handler', { name: 'Products', feature: 'shop', method: 'GET', path: '/api/products', service: 'Ghost' }), null, 'a service that is not there derives nothing');
  assert.deepEqual(flowBlock('create.handler').declaredScope({ name: 'Products', feature: 'shop', method: 'GET', path: '/api/products' }, { root: dir }).features, ['shop']);
  assert.equal(handlerTouches(dir, { name: 'Products', feature: 'shop', method: 'GET', path: '/api/order-items/recent' }).find((f) => f.layer === 'route').path, 'app/api/order-items/recent/route.ts');
  const spa = shapeProject('react-spa');
  assert.equal(expectedFiles(spa, 'create.handler', { name: 'Products', feature: 'shop', method: 'GET', path: '/api/products' }), null, 'a react-spa project has no route handler');
});

test('the route holds no logic: it imports the service and the domain unit, answers one method, and every other method is a typed 405; no secret, no if', () => {
  const dir = shapeProject('nextjs');
  const res = handler(dir, '--method', 'POST', '--path', '/api/products');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /POST \/api\/products is served by app\/api\/products\/route\.ts, delegating to a typed in-memory service\. Run: construct test proof shop/);
  const route = fs.readFileSync(path.join(dir, 'app/api/products/route.ts'), 'utf8');
  assert.deepEqual([...route.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['../../../features/shop/domain/ProductsApi.domain', '../../../features/shop/services/ProductsApi.service', '../../../features/shop/types'], 'the route imports only the domain unit, the service and the types');
  assert.deepEqual([...route.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]), ['POST', 'GET', 'PUT', 'DELETE'], 'the chosen method first, then a typed 405 for every other');
  assert.match(route, /const input: unknown = await request\.json\(\)\.catch\(\(\) => undefined\);\n {2}return respond\(await serveProducts\(\{ input \}\)\);/);
  assert.match(route, /return respond\(\{ status: 'not-allowed', allow: \['POST'\] \}\);/);
  assert.doesNotMatch(route, /\bprocess\.env\b|\bif\b|\bswitch\b|\bfetch\(|\bsecret/i, 'no secret, no branching, no network call in the route');
  assert.doesNotMatch(route.replace(/\/\*\*.*?\*\//g, ''), /\b(200|400|405|500)\b/, 'the statuses are decided in the domain unit, not in the route');
  const domain = fs.readFileSync(path.join(dir, 'features/shop/domain/ProductsApi.domain.ts'), 'utf8');
  for (const [status, code] of [['ready', 200], ['invalid', 400], ['not-allowed', 405], ['error', 500]]) assert.match(domain, new RegExp(`case '${status}':\\n {6}return \\{ status: ${code},`));
  assert.match(domain, /headers: \{ Allow: result\.allow\.join\(', '\) \}/);
  const service = fs.readFileSync(path.join(dir, 'features/shop/services/ProductsApi.service.ts'), 'utf8');
  assert.match(service, /defineService\('serveProducts', async \(\{ input \}: \{ input: unknown \}\): Promise<ApiResult<unknown>>/);
  assert.match(service, /environment variables and secrets are read here, never in the route/);
  for (const f of handlerFiles(dir, { name: 'Products', feature: 'shop', method: 'POST', path: '/api/products' })) assert.equal(fs.readFileSync(f.path, 'utf8'), f.content, path.basename(f.path));
  assert.deepEqual(featureViolations(dir), [], 'the written files pass the default rules (the route entry, ROUTE-001 and ROUTE-002, is not weakened)');
});

test('every method: the CLI writes a service that answers it, typed, and the closed list of statuses stays the same', () => {
  for (const method of HANDLER_METHODS) {
    const dir = shapeProject('nextjs');
    const res = handler(dir, '--method', method, '--path', '/api/products', '--fields', 'id:number,title:string,done:boolean');
    assert.equal(res.status, 0, `${method}: ${res.stderr}`);
    const route = fs.readFileSync(path.join(dir, 'app/api/products/route.ts'), 'utf8');
    assert.deepEqual([...route.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1])[0], method);
    assert.equal(/await request\.json\(\)/.test(route), method === 'POST' || method === 'PUT');
    assert.equal(/searchParams\.get\('id'\)/.test(route), method === 'DELETE');
    const service = fs.readFileSync(path.join(dir, 'features/shop/services/ProductsApi.service.ts'), 'utf8');
    assert.match(service, /const rows: Product\[\] = \[\];/);
    assert.match(fs.readFileSync(path.join(dir, 'features/shop/types.ts'), 'utf8'), /export interface Product \{\n {2}id: number;\n {2}title: string;\n {2}done: boolean;\n\}/);
    if (method === 'POST') assert.match(service, /const row: Product = \{ id: rows\.length \+ 1, \.\.\.input \};/, 'a number id is the next number');
    assert.deepEqual(featureViolations(dir), [], method);
  }
});

test('idempotent: a second run changes nothing and says so; another method for the same path, or a route file with other content, is refused', () => {
  const dir = shapeProject('nextjs');
  assert.equal(handler(dir, '--method', 'GET', '--path', '/api/products').status, 0);
  const snapshot = projectFiles(dir);
  const again = handler(dir, '--method', 'GET', '--path', '/api/products');
  assert.equal(again.status, 0);
  assert.match(again.stdout, /^Unchanged: GET \/api\/products is already served by app\/api\/products\/route\.ts\./);
  assert.deepEqual(projectFiles(dir), snapshot);
  const json = JSON.parse(handler(dir, '--method', 'GET', '--path', '/api/products', '--format', 'json').stdout);
  assert.deepEqual([json.ok, json.kind, json.method, json.route, json.service, json.files], [true, 'handler', 'GET', 'app/api/products/route.ts', 'in-memory', []]);
  const other = handler(dir, '--method', 'POST', '--path', '/api/products');
  assert.equal(other.status, 2);
  assert.match(other.stderr, /already exist|already exists with other content/);
  assert.deepEqual(projectFiles(dir), snapshot, 'nothing was written');
});

test('a service you name: the handler delegates to its first defineService unit, the proof does not call it, and a service that is not there is refused', () => {
  const dir = shapeProject('nextjs');
  assert.match(handler(dir, '--method', 'GET', '--path', '/api/report', '--service', 'Report').stderr, /The service Report does not exist in feature "shop"/);
  fs.writeFileSync(path.join(dir, 'features/shop/services/Report.service.ts'), 'export const x = 1;\n');
  assert.match(handler(dir, '--method', 'GET', '--path', '/api/report', '--service', 'Report').stderr, /exports no unit built with defineService/);
  fs.writeFileSync(path.join(dir, 'features/shop/services/Report.service.ts'), "import { defineService } from '@line/construct-core/typed-contracts';\nimport type { ApiResult } from '../types';\n\n/** The report. */\nexport const loadReport = defineService('loadReport', async ({ input }: { input: unknown }): Promise<ApiResult<unknown>> => ({ status: 'ready', body: { input: input ?? null } }));\n");
  const res = run(['create', 'handler', 'Report', '--feature', 'shop', '--method', 'GET', '--path', '/api/report', '--service', 'Report'], dir);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /delegating to the Report service\./);
  const route = fs.readFileSync(path.join(dir, 'app/api/report/route.ts'), 'utf8');
  assert.match(route, /import \{ loadReport \} from '\.\.\/\.\.\/\.\.\/features\/shop\/services\/Report\.service';/);
  assert.match(route, /return respond\(await loadReport\(\{ input: undefined \}\)\);/);
  assert.equal(fs.existsSync(path.join(dir, 'features/shop/services/ReportApi.service.ts')), false, 'no in-memory service beside the one named');
  const proof = fs.readFileSync(path.join(dir, 'features/shop/tests/generated/ReportApi.proof.test.ts'), 'utf8');
  assert.match(proof, /A service you named may do I\/O, so the proof does not call it/);
  assert.doesNotMatch(proof, /GET answers 200/, 'no request reaches the named service');
});

test('refusals say why and write nothing: react-spa, a missing feature, a type declared for something else, an entity with other fields, bad flags', () => {
  const spa = shapeProject('react-spa');
  const tree = featureTree(spa);
  const refused = handler(spa, '--method', 'GET', '--path', '/api/products');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /A route handler needs a Next\.js project: this project is react-spa, which has no server of its own to answer \/api requests/);
  assert.deepEqual(featureTree(spa), tree, 'nothing was written');
  assert.equal(fs.existsSync(path.join(spa, 'app')), false);

  const dir = shapeProject('nextjs');
  assert.match(run(['create', 'handler', 'Products', '--feature', 'ghost', '--method', 'GET', '--path', '/api/products'], dir).stderr, /Feature "ghost" not found/);
  assert.match(run(['create', 'handler', 'Products', '--feature', 'shop', '--method', 'GET'], dir).stderr, /Usage: construct create handler/);
  assert.match(handler(dir, '--method', 'PATCH', '--path', '/api/products').stderr, /The method is one of: GET, POST, PUT, DELETE/);
  assert.match(handler(dir, '--method', 'GET', '--path', '/products').stderr, /A handler path starts with \/api\//);
  assert.match(handler(dir, '--method', 'GET', '--path', '/api/products', '--llm', 'claude').stderr, /no model/);
  assert.match(handler(dir, '--method', 'GET', '--path', '/api/products', '--fields', 'name:string').stderr, /Fields are name:type pairs/);
  fs.appendFileSync(path.join(dir, 'features/shop/types.ts'), '\nexport type ApiResult = string;\n');
  assert.match(handler(dir, '--method', 'GET', '--path', '/api/products').stderr, /already declares ApiResult for something else/);
  const mismatch = shapeProject('nextjs');
  fs.appendFileSync(path.join(mismatch, 'features/shop/types.ts'), '\nexport interface Product {\n  id: string;\n  label: string;\n}\n');
  assert.match(handler(mismatch, '--method', 'GET', '--path', '/api/products').stderr, /already declares Product with the fields id:string,label:string, not id:string,name:string/);
  assert.equal(fs.existsSync(path.join(mismatch, 'app/api/products/route.ts')), false);
});

test('every typed result is a status, and every method the route does not answer is a typed 405: type-checked and proven on a Next.js project', NEEDS_RUNTIME, () => {
  const dir = initProject('nextjs', 'handlers');
  assert.equal(run(['create', 'feature', 'shop'], dir).status, 0);
  for (const [name, method, p, fields] of [['Products', 'GET', '/api/products', 'id:string,name:string,price:number'], ['Orders', 'POST', '/api/orders', 'id:string,name:string'], ['Notes', 'PUT', '/api/notes', 'id:string,text:string'], ['Tags', 'DELETE', '/api/tags', 'id:number,label:string']]) {
    const res = run(['create', 'handler', name, '--feature', 'shop', '--method', method, '--path', p, '--fields', fields], dir);
    assert.equal(res.status, 0, res.stderr);
  }
  const tsc = typeCheck(dir, ['app/api/products/route.ts', 'app/api/orders/route.ts', 'app/api/notes/route.ts', 'app/api/tags/route.ts']);
  assert.equal(tsc.status, 0, tsc.output);
  const proof = run(['test', 'proof', 'shop', '--format', 'json'], dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  const result = JSON.parse(proof.stdout);
  assert.deepEqual([result.counts.failed, result.counts.total], [0, 17]);
  assert.ok(result.tests.some((t) => t.title === 'Orders handler: POST with a good body answers 200 and the row, with its id'));
  assert.ok(result.tests.some((t) => t.title === 'Tags handler: DELETE with no id or an unknown id answers 400'));
});

test('q-handler: a closed question with add first, raised only for a Next.js screen that calls an endpoint nothing answers', async () => {
  const dir = shapeProject('nextjs');
  const ask = (extra = {}) => handlerOffer(dir, { id: 'q-handler', name: 'Products', shape: 'list', source: 'endpoint', path: '/api/products', ...extra });
  const offer = ask();
  assert.deepEqual([offer.question.id, offer.method, offer.add, offer.question.default, offer.question.options.map((o) => o.id), offer.question.chosen], ['q-handler', 'GET', true, 'add-handler', ['add-handler', 'skip'], null]);
  assert.match(offer.question.options[0].label, /^Add GET \/api\/products$/);
  for (const o of offer.question.options) assert.ok(o.label.length <= 60 && o.why.length <= 120, `${o.id} fits the fixed size`);
  assert.equal(ask({ shape: 'form' }).method, 'POST');
  assert.equal(ask({ answer: 'skip' }).add, false);
  assert.deepEqual([ask({ answer: { option: 'skip', by: 'person' } }).question.chosen, ask({ answer: 'nonsense' }).refused], ['skip', '"nonsense" is not an option of q-handler: add-handler, skip.']);
  assert.equal(ask({ source: 'local' }).question, null, 'a local source makes no request');
  assert.equal(ask({ source: 'openapi' }).question, null);
  const detail = ask({ shape: 'detail', path: '/api/products' });
  assert.deepEqual([detail.question, detail.note], [null, 'Products calls /api/products, but a handler for a detail screen is not generated yet: add the route handler by hand.']);
  assert.equal(handlerOffer(shapeProject('react-spa'), { id: 'q-handler', name: 'Products', shape: 'list', source: 'endpoint', path: '/api/products' }).question, null, 'a react-spa project has no handlers');
  assert.equal(handler(dir, '--method', 'GET', '--path', '/api/products').status, 0);
  const taken = ask();
  assert.deepEqual([taken.question, taken.note], [null, '/api/products is already answered by app/api/products/route.ts, so no handler is offered for Products.']);
  const s = await suggest({ id: offer.question.id, question: offer.question.question, options: offer.question.options });
  assert.deepEqual([s.option, s.provider], ['add-handler', 'rules']);
  assert.equal(wiringChooserId('q-handler'), 'requirement.plan.handler');
  assert.equal(wiringChooserId('q-handler-orders'), 'requirement.plan.handler');
});

test('planFromBlocks: q-handler is raised only when the card is handed over, the screen reads an endpoint on Next.js, and a refused answer is a typed error', () => {
  const dir = shapeProject('nextjs');
  const card = cardOf('A user wants to see a list of products');
  const placed = placeCard(card, { framework: 'nextjs', answers: { 'q-shape': { option: 'list', by: 'person' } } });
  const endpoint = { 'q-source': { option: 'endpoint', by: 'person' } };
  const opts = { feature: 'items', root: dir, decisions: placed.decisions };
  assert.equal(planFromBlocks(placed.blocks, { ...opts, answers: endpoint }).offers.some((o) => o.id === 'q-handler'), false, 'no card, no question: existing plans are as they were');
  assert.equal(planFromBlocks(placed.blocks, { ...opts, card }).offers.some((o) => o.id === 'q-handler'), false, 'the rules default source is local, which makes no request');
  const planned = planFromBlocks(placed.blocks, { ...opts, card, answers: endpoint });
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(planned.handlers, [{ name: 'Products', method: 'GET', path: '/api/products', question: 'q-handler', step: 's8' }]);
  assert.deepEqual(planned.plan.steps.find((s) => s.flow === 'create.handler').args, { name: 'Products', feature: 'items', method: 'GET', path: '/api/products', entity: 'Product', fields: 'id:string,name:string,price:number' });
  assert.deepEqual(planned.proof.steps.map((p) => p.name).at(-1), 'ProductsApi');
  const skipped = planFromBlocks(placed.blocks, { ...opts, card, answers: { ...endpoint, 'q-handler': { option: 'skip', by: 'llm', provider: 'claude' } } });
  assert.equal(skipped.plan.steps.some((s) => s.flow === 'create.handler'), false);
  assert.deepEqual(skipped.decisions.filter((d) => d.question === 'q-handler'), [{ question: 'q-handler', option: 'skip', by: 'llm', provider: 'claude' }]);
  const refused = planFromBlocks(placed.blocks, { ...opts, card, answers: { ...endpoint, 'q-handler': 'nonsense' } });
  assert.deepEqual([refused.ok, refused.errors[0].code], [false, 'PLAN_HANDLER_UNAVAILABLE']);
  const spa = shapeProject('react-spa');
  const spaPlaced = placeCard(card, { framework: 'react-spa', answers: { 'q-shape': { option: 'list', by: 'person' } } });
  assert.equal(planFromBlocks(spaPlaced.blocks, { feature: 'items', root: spa, decisions: spaPlaced.decisions, card, answers: endpoint }).offers.some((o) => o.id === 'q-handler'), false, 'a react-spa project has no handlers');
  assert.equal(handlerContext(dir, { name: 'Products', feature: 'shop', method: 'GET', path: '/api/products' }).routeFile, 'app/api/products/route.ts');
});
