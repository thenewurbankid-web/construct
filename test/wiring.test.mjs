// #654 -- the two by-hand steps after a generated screen, as blocks: `create.route` (point the route entry at the controller),
// `add.dependency` (one line in package.json), the declared touches of the `sync` step, and the closed questions `q-route` and
// `q-dependency` a shaped plan carries. The whole chain from a sentence, run for real, is test/list-shape-chain.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { PLAN_FLOWS, planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { expectedFiles } from '../packages/core/plan-touches.mjs';
import { flowScopeKind } from '../packages/core/block-flows.mjs';
import { addDependency, dependencyOffer, dependencyTouches, generateRouteEntry, routeEntryTouches, routeOffer, routePathOf, syncTouches, wireRouteSource } from '../packages/core/wiring.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const run = (args, cwd) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd });
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const put = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const CONTROLLER = "export function ProductsController() {\n  return <main>Products</main>;\n}\n";

/** An init project with a `products` feature that has a controller (written directly: what the route step needs is the file). */
function project(framework, { controller = 'ProductsController.controller.tsx' } = {}) {
  const dir = makeTempDir(`construct-wiring-${framework}-`);
  assert.equal(run(['init', '--framework', framework], dir).status, 0);
  put(dir, `features/products/controllers/${controller}`, CONTROLLER);
  return dir;
}

const shapedBlocks = (framework) => placeCard(parseRequirement('A user wants to see a list of products').card, { framework, answers: { 'q-shape': 'list' } });
const planIn = (dir, options = {}, framework = 'react-spa') => {
  const placed = shapedBlocks(framework);
  // #621: these tests are about the wiring, not the data source: q-source is answered (endpoint, what the wiring tests were written against) unless a test says otherwise.
  return planFromBlocks(placed.blocks, { feature: 'products', root: dir, decisions: placed.decisions, ...options, answers: { 'q-source': 'endpoint', ...options.answers } });
};

const SCAFFOLD = "import { Routes, Route } from 'react-router-dom';\nimport { CoreController } from '../features/core/controllers/CoreController';\n\nexport function App() {\n  return (\n    <Routes>\n      <Route path=\"/\" element={<CoreController />} />\n    </Routes>\n  );\n}\n";
const WIRE = { ident: 'ProductsController', importPath: '../features/products/controllers/ProductsController.controller', route: '/products' };

test('the route path is the kebab-case of the screen name', () => {
  assert.equal(routePathOf('Products'), '/products');
  assert.equal(routePathOf('SubscriptionPlan'), '/subscription-plan');
  assert.equal(routePathOf('ClickButton2'), '/click-button2');
});

test('wireRouteSource: the init scaffold loses its dangling import and route and gains the new ones; nothing else moves', () => {
  const out = wireRouteSource(SCAFFOLD, { ...WIRE, exists: () => false });
  assert.deepEqual(out.removed, ['CoreController']);
  assert.equal(out.source, "import { Routes, Route } from 'react-router-dom';\nimport { ProductsController } from '../features/products/controllers/ProductsController.controller';\n\nexport function App() {\n  return (\n    <Routes>\n      <Route path=\"/products\" element={<ProductsController />} />\n    </Routes>\n  );\n}\n");
  assert.equal(wireRouteSource(out.source, { ...WIRE, exists: () => false }).changed, false, 'running it twice changes nothing');
});

test('wireRouteSource: a controller that exists is kept, the new route follows it with the same indent', () => {
  const source = "import { Routes, Route } from 'react-router-dom';\nimport { HomeController } from './home';\n\nexport const App = () => (\n  <Routes>\n    <Route path=\"/\" element={<HomeController />} />\n  </Routes>\n);\n";
  const out = wireRouteSource(source, { ...WIRE, exists: () => true });
  assert.deepEqual(out.removed, []);
  assert.equal(out.source, "import { Routes, Route } from 'react-router-dom';\nimport { HomeController } from './home';\nimport { ProductsController } from '../features/products/controllers/ProductsController.controller';\n\nexport const App = () => (\n  <Routes>\n    <Route path=\"/\" element={<HomeController />} />\n    <Route path=\"/products\" element={<ProductsController />} />\n  </Routes>\n);\n");
});

test('wireRouteSource: a route that belongs to another element, or a file with no <Routes>, is refused in words', () => {
  const taken = "import { Routes, Route } from 'react-router-dom';\n\nexport const App = () => (\n  <Routes>\n    <Route path=\"/products\" element={<Other />} />\n  </Routes>\n);\n";
  assert.throws(() => wireRouteSource(taken, WIRE), /already belongs to another element/);
  assert.throws(() => wireRouteSource('export const App = () => <main />;\n', WIRE), /no <Routes> table.*<Route path="\/products" element=\{<ProductsController \/>\} \/>/);
});

test('react-spa: create route edits src/App.tsx, declares exactly that file, and is idempotent', () => {
  const dir = project('react-spa');
  assert.deepEqual(routeEntryTouches(dir, { name: 'Products', feature: 'products' }), [{ path: 'src/App.tsx', change: 'modify', layer: 'route' }]);
  assert.equal(read(dir, 'src/App.tsx').includes("CoreController"), true, 'the init scaffold imports a CoreController that does not exist');
  const first = generateRouteEntry(dir, { name: 'Products', feature: 'products' });
  assert.deepEqual(first, { framework: 'react-spa', route: '/products', file: 'src/App.tsx', changed: true, removed: ['CoreController'] });
  const app = read(dir, 'src/App.tsx');
  assert.match(app, /import \{ ProductsController \} from '\.\.\/features\/products\/controllers\/ProductsController\.controller';/);
  assert.match(app, /<Route path="\/products" element=\{<ProductsController \/>\} \/>/);
  assert.doesNotMatch(app, /CoreController/);
  assert.equal(generateRouteEntry(dir, { name: 'Products', feature: 'products' }).changed, false);
  assert.equal(read(dir, 'src/App.tsx'), app);
});

test('react-spa: a plain scaffold controller (Name.tsx) is imported too, and a missing controller is named', () => {
  const dir = project('react-spa', { controller: 'ProductsController.tsx' });
  generateRouteEntry(dir, { name: 'Products', feature: 'products' });
  assert.match(read(dir, 'src/App.tsx'), /from '\.\.\/features\/products\/controllers\/ProductsController';/);
  const bare = makeTempDir('construct-wiring-bare-');
  assert.equal(run(['init', '--framework', 'react-spa'], bare).status, 0);
  assert.throws(() => generateRouteEntry(bare, { name: 'Products', feature: 'products' }), /ProductsController does not exist yet.*construct create controller Products --feature products/);
});

test('Next.js: create route writes app/<route>/page.tsx (a controller and nothing else) and removes the dangling init root page', () => {
  const dir = project('nextjs');
  assert.deepEqual(routeEntryTouches(dir, { name: 'Products', feature: 'products' }).map((f) => `${f.change} ${f.path}`), ['create app/products/page.tsx', 'delete app/page.tsx']);
  const result = generateRouteEntry(dir, { name: 'Products', feature: 'products' });
  assert.deepEqual(result, { framework: 'nextjs', route: '/products', file: 'app/products/page.tsx', changed: true, removed: ['app/page.tsx'] });
  assert.equal(read(dir, 'app/products/page.tsx'), "import { ProductsController } from '../../features/products/controllers/ProductsController.controller';\n\nexport default function Page() {\n  return <ProductsController />;\n}\n");
  assert.equal(fs.existsSync(path.join(dir, 'app', 'page.tsx')), false);
  assert.equal(generateRouteEntry(dir, { name: 'Products', feature: 'products' }).changed, false, 'again: nothing to do');
  assert.deepEqual(routeEntryTouches(dir, { name: 'Products', feature: 'products' }).map((f) => f.path), ['app/products/page.tsx'], 'and nothing left to remove');
});

test('Next.js: an edited root page is never removed, and a route another page owns is refused', () => {
  const dir = project('nextjs');
  put(dir, 'app/page.tsx', "export default function Page() {\n  return <h1>Home</h1>;\n}\n");
  assert.deepEqual(routeEntryTouches(dir, { name: 'Products', feature: 'products' }).map((f) => f.path), ['app/products/page.tsx']);
  put(dir, 'app/products/page.tsx', "export default function Page() {\n  return <h1>Mine</h1>;\n}\n");
  assert.throws(() => generateRouteEntry(dir, { name: 'Products', feature: 'products' }), /route \/products already belongs to another page/);
  assert.match(read(dir, 'app/products/page.tsx'), /Mine/);
});

test('q-route: asked only when the path is reserved or taken; the default is the first free alternative, skip leaves the screen unwired', () => {
  const dir = project('nextjs');
  assert.deepEqual(routeOffer(dir, { name: 'Products', feature: 'products' }), { route: '/products', skipped: false, question: null, answer: null }, 'a free path is no question');
  put(dir, 'app/products/page.tsx', "export default function Page() {\n  return <h1>Mine</h1>;\n}\n");
  const taken = routeOffer(dir, { name: 'Products', feature: 'shop' });
  assert.deepEqual([taken.route, taken.answer, taken.question.id, taken.question.default, taken.question.chosen, taken.question.options.map((o) => o.id)], ['/shop/products', 'alternate', 'q-route', 'alternate', null, ['alternate', 'skip']]);
  assert.deepEqual(taken.question.options.map((o) => [o.enabled, typeof o.label, typeof o.why]), [[true, 'string', 'string'], [true, 'string', 'string']]);
  const same = routeOffer(dir, { name: 'Products', feature: 'products' });
  assert.equal(same.route, '/products-screen', 'a feature named like the screen does not give /products/products');
  const skipped = routeOffer(dir, { name: 'Products', feature: 'products', answer: { option: 'skip', by: 'person' } });
  assert.deepEqual([skipped.route, skipped.skipped, skipped.question.chosen], [null, true, 'skip']);
  assert.equal(routeOffer(dir, { name: 'Api', feature: 'api' }).question.id, 'q-route', 'a name the app itself uses is asked about');
  const spa = project('react-spa');
  put(spa, 'src/App.tsx', "import { Routes, Route } from 'react-router-dom';\n\nexport const App = () => (\n  <Routes>\n    <Route path=\"/products\" element={<Other />} />\n  </Routes>\n);\n");
  assert.equal(routeOffer(spa, { name: 'Products', feature: 'products' }).question.id, 'q-route', 'the same in a react-router table');
  generateRouteEntry(spa, { name: 'Products', feature: 'products', route: '/products-screen' });
  put(spa, 'src/App.tsx', read(spa, 'src/App.tsx').replace('<Other />', '<ProductsController />'));
  assert.equal(routeOffer(spa, { name: 'Products', feature: 'products' }).question, null, 'a route that already renders this controller is not taken');
});

test('q-dependency: offered only when package.json lacks @line/construct-core; the line is exact; add-dependency edits one line and installs nothing', () => {
  const dir = project('react-spa');
  const offer = dependencyOffer(dir);
  assert.equal(offer.line, '"@line/construct-core": "^0.9.0"');
  assert.deepEqual([offer.question.id, offer.question.default, offer.question.chosen, offer.question.options.map((o) => o.id), offer.add], ['q-dependency', 'add-dependency', null, ['add-dependency', 'skip'], true]);
  assert.match(offer.question.options[0].label, /"@line\/construct-core": "\^0\.9\.0"/);
  assert.deepEqual([dependencyOffer(dir, 'skip').add, dependencyOffer(dir, { option: 'skip', by: 'person' }).question.chosen, dependencyOffer(dir, 'nonsense').add], [false, 'skip', true], 'an unknown answer is the default');
  assert.deepEqual(dependencyTouches(dir, { name: '@line/construct-core', version: '^0.9.0' }), [{ path: 'package.json', change: 'modify' }]);
  const before = JSON.parse(read(dir, 'package.json'));
  const first = addDependency(dir, { name: '@line/construct-core', version: '^0.9.0' });
  assert.deepEqual(first, { file: 'package.json', changed: true, line: '"@line/construct-core": "^0.9.0"' });
  const after = JSON.parse(read(dir, 'package.json'));
  assert.deepEqual(after.dependencies, { ...before.dependencies, '@line/construct-core': '^0.9.0' });
  assert.deepEqual({ ...after, dependencies: before.dependencies }, before, 'nothing else moved');
  assert.ok(read(dir, 'package.json').endsWith('}\n'));
  assert.equal(fs.existsSync(path.join(dir, 'node_modules')), false, 'never runs a package manager');
  assert.equal(addDependency(dir, { name: '@line/construct-core', version: '^0.9.0' }).changed, false, 'idempotent');
  assert.equal(dependencyOffer(dir), null, 'a project that has it is not asked');
  assert.equal(dependencyOffer(makeTempDir('construct-wiring-nopkg-')), null, 'a folder with no package.json has nowhere to add it');
  assert.throws(() => addDependency(dir, { name: 'Not A Package', version: '^1.0.0' }), /not a package name/);
  assert.throws(() => addDependency(dir, { name: 'left-pad', version: 'latest' }), /not a version range/);
  assert.equal(dependencyTouches(dir, { name: 'left-pad', version: 'latest' }), null);
});

test('the flows are registered, mapped to their commands, and their scope is derived (sync stays declared)', () => {
  assert.deepEqual(planToCommand({ flow: 'create.route', args: { name: 'Products', feature: 'products', route: '/products' } }).argv, ['create', 'route', 'Products', '--feature', 'products', '--route', '/products']);
  assert.deepEqual(planToCommand({ flow: 'add.dependency', args: { name: '@line/construct-core', version: '^0.9.0' } }).argv, ['create', 'dependency', '@line/construct-core', '--version', '^0.9.0']);
  assert.deepEqual([flowScopeKind('create.route'), flowScopeKind('add.dependency'), flowScopeKind('sync')], ['derived', 'derived', 'declared']);
  const dir = project('react-spa');
  assert.deepEqual(expectedFiles(dir, 'create.route', { name: 'Products', feature: 'products' }), [{ path: 'src/App.tsx', change: 'modify', layer: 'route' }]);
  assert.equal(expectedFiles(dir, 'create.route', { name: 'products', feature: 'x', route: 'Products' }), null, 'a bad route derives nothing');
  assert.deepEqual(syncTouches(dir, 'products'), { features: ['products'], files: [{ path: 'features/products/index.ts', change: 'modify' }, { path: '.dependency-cruiser.cjs', change: 'create' }] });
  const step = (flow, args) => ({ id: 's1', title: 't', flow, args, executor: 'deterministic', touches: { features: [], files: [] } });
  const codes = (flow, args) => validatePlan({ version: 1, ticket: { source: 'text', title: 'x' }, steps: [step(flow, args)] }).errors.map((e) => e.code);
  assert.deepEqual(codes('create.route', { name: 'Products', feature: 'products', route: '/Products' }), ['STEP_ARG_TYPE']);
  assert.deepEqual(codes('create.route', { name: 'Products', feature: 'products', route: '/products' }), []);
  assert.deepEqual(codes('add.dependency', { name: '@line/construct-core', version: 'latest' }), ['STEP_ARG_TYPE']);
  assert.deepEqual(Object.keys(PLAN_FLOWS).filter((f) => ['create.route', 'add.dependency'].includes(f)), ['create.route', 'add.dependency']);
});

test('a shaped plan: dependency, sync, route between the units and the proof; the answers change it and are recorded', () => {
  const dir = project('react-spa');
  const planned = planIn(dir);
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(planned.plan.steps.slice(7).map((s) => `${s.id} ${s.flow}`), ['s8 add.dependency', 's9 sync', 's10 create.route', 's11 check.types', 's12 create.proof', 's13 test.proof']);
  assert.deepEqual(planned.plan.steps[8].touches, { features: ['products'], files: [{ path: 'features/products/index.ts', change: 'modify' }, { path: '.dependency-cruiser.cjs', change: 'create' }] });
  assert.deepEqual(planned.plan.steps[9].dependsOn, ['s7', 's9'], 'the route waits for the controller and for the barrel');
  assert.deepEqual(planned.offers.map((o) => o.id), ['q-source', 'q-dependency', 'q-verify']);
  assert.deepEqual(planned.decisions, [{ question: 'q-shape', option: 'list', by: 'person' }, { question: 'q-source', option: 'endpoint', by: 'person' }], 'an unanswered question records no decision');

  const skipDep = planIn(dir, { answers: { 'q-dependency': { option: 'skip', by: 'decision-model', provider: 'rules' } } });
  assert.deepEqual(skipDep.plan.steps.slice(7).map((s) => s.flow), ['sync', 'create.route', 'check.types', 'create.proof', 'test.proof']);
  assert.deepEqual(skipDep.decisions.at(-1), { question: 'q-dependency', option: 'skip', by: 'decision-model', provider: 'rules' });
  assert.equal(skipDep.wiring.dependency, null);

  addDependency(dir, { name: '@line/construct-core', version: '^0.9.0' });
  const has = planIn(dir);
  assert.deepEqual([has.offers.map((o) => o.id), has.wiring.dependency, has.plan.steps.length], [['q-source', 'q-verify'], null, 12], 'a project that has the dependency is not asked');

  put(dir, 'src/App.tsx', "import { Routes, Route } from 'react-router-dom';\n\nexport const App = () => (\n  <Routes>\n    <Route path=\"/products\" element={<Other />} />\n  </Routes>\n);\n");
  const taken = planIn(dir);
  assert.deepEqual(taken.offers.filter((o) => o.id === 'q-route').map((o) => [o.id, o.default]), [['q-route', 'alternate']]);
  assert.deepEqual([taken.wiring.routes[0].route, taken.plan.steps[8].args.route], ['/products-screen', '/products-screen']);
  const skipRoute = planIn(dir, { answers: { 'q-route': 'skip' } });
  assert.deepEqual([skipRoute.wiring.routes, skipRoute.plan.steps.some((s) => s.flow === 'create.route'), skipRoute.decisions.at(-1)], [[], false, { question: 'q-route', option: 'skip', by: 'person' }]);
  assert.match(skipRoute.notes[0], /no route step .*add its controller to the route entry by hand/);
  assert.deepEqual(validatePlan(skipRoute.plan), { valid: true, errors: [] });

  assert.deepEqual([planIn(dir, { wire: false }).wiring, planIn(dir, { wire: false }).plan.steps.length], [null, 9], 'wire: false leaves the plan as it was before #654');
});

test('the CLI: create route and create dependency, text and json, and a refusal is a usage error', () => {
  const dir = project('nextjs');
  const text = run(['create', 'route', 'Products', '--feature', 'products'], dir);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Created app\/products\/page\.tsx .*: \/products renders ProductsController/);
  assert.match(text.stdout, /Removed app\/page\.tsx/);
  assert.match(run(['create', 'route', 'Products', '--feature', 'products'], dir).stdout, /Unchanged app\/products\/page\.tsx/);

  const json = JSON.parse(run(['create', 'route', 'Orders', '--feature', 'orders', '--format', 'json'], dir).stdout);
  assert.equal(json.ok, false, 'no orders controller: a refusal, not a guess');
  assert.equal(json.error.code, 'USAGE_ERROR');
  assert.match(json.error.message, /OrdersController does not exist yet/);

  const dep = run(['create', 'dependency', '@line/construct-core', '--version', '^0.9.0'], dir);
  assert.equal(dep.status, 0, dep.stderr);
  assert.match(dep.stdout, /Updated package\.json: added "@line\/construct-core": "\^0\.9\.0" to dependencies\. Nothing is installed/);
  const again = JSON.parse(run(['create', 'dependency', '@line/construct-core', '--version', '^0.9.0', '--format', 'json'], dir).stdout);
  assert.deepEqual([again.ok, again.kind, again.files], [true, 'dependency', []]);
  assert.equal(run(['create', 'dependency', '@line/construct-core'], dir).status, 2, 'a missing --version is a usage error');
  assert.equal(run(['create', 'route', 'Products'], dir).status, 2, 'a missing --feature is a usage error');
  assert.equal(run(['create', 'route', 'Products', '--feature', 'products', '--llm', 'claude'], dir).status, 2, 'no model writes a route');
});
