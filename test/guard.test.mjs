// #629 -- `guard.route`: choose who may open a screen (public | signed-in | role), as a deterministic block with a CLI verb
// (`construct create guard`), a PLAN_FLOWS entry, derived touches, a closed question (`q-access`) with a rules default read off the
// requirement card, and refusals that say why and write nothing. The whole chain (sentence to plan to run to validate, tsc and the proof) is
// test/guard-chain.test.mjs; this file is the block itself: arguments, files, the route edit, the question and the refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GUARD_ACCESS, accessOffer, cardRoles, guardArgIssue, guardFiles, guardRouteSource, guardTouches, sessionSourceOf } from '../packages/core/guard.mjs';
import { PLAN_FLOWS, planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { expectedFiles } from '../packages/core/plan-touches.mjs';
import { flowBlock, flowScopeKind } from '../packages/core/block-flows.mjs';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { wiringChooserId } from '../packages/core/decision-trace-adapters.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { cardOf, featureTree, run, shapeProject } from '../test-utils/shapeChain.mjs';

/** A project with the feature `shop`, a `Products` controller and its route entry (the state a guard is added to). */
function guardable(framework = 'react-spa') {
  const dir = shapeProject(framework);
  assert.equal(run(['create', 'layer', 'Products', '--feature', 'shop', '--layers', 'page,controller'], dir).status, 0);
  assert.equal(run(['create', 'route', 'Products', '--feature', 'shop'], dir).status, 0);
  return dir;
}
const guard = (dir, ...more) => run(['create', 'guard', 'Products', '--feature', 'shop', ...more], dir);
const routeFile = (dir, framework = 'react-spa') => path.join(dir, framework === 'react-spa' ? 'src/App.tsx' : 'app/products/page.tsx');

test('the request is checked by named reasons: the access is closed, roles belong to role only, names and paths are plain', () => {
  const ok = { name: 'Products', feature: 'shop', access: 'signed-in' };
  assert.equal(guardArgIssue(ok), null);
  assert.deepEqual(GUARD_ACCESS, ['public', 'signed-in', 'role']);
  const arg = (extra) => guardArgIssue({ ...ok, ...extra })?.arg;
  assert.equal(arg({ name: 'products' }), 'name');
  assert.equal(arg({ feature: 'a b' }), 'feature');
  assert.equal(arg({ access: 'everyone' }), 'access');
  assert.equal(arg({ access: 'role' }), 'roles', 'the role access needs its roles');
  assert.equal(arg({ access: 'role', roles: ['Admin'] }), 'roles');
  assert.equal(arg({ access: 'role', roles: ['a', 'a'] }), 'roles', 'roles are different');
  assert.equal(arg({ access: 'role', roles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), 'roles', 'at most six');
  assert.equal(arg({ access: 'role', roles: 'admin,manager' }), undefined, 'a comma text is a list');
  assert.equal(arg({ roles: ['admin'] }), 'roles', 'signed-in takes no roles');
  assert.equal(arg({ redirect: 'sign-in' }), 'redirect');
  assert.equal(arg({ redirect: '/sign-in' }), undefined);
  assert.equal(arg({ route: '/Products' }), 'route');
});

test('the flow is in the registry, derived, and a plan step means exactly the CLI command', () => {
  const flow = PLAN_FLOWS['guard.route'];
  assert.equal(flowScopeKind('guard.route'), 'derived');
  assert.deepEqual(Object.keys(flow.args), ['name', 'feature', 'access', 'roles', 'redirect', 'route', 'dir']);
  assert.deepEqual(flow.args.access.enum, ['public', 'signed-in', 'role']);
  const args = { name: 'Reports', feature: 'reports', access: 'role', roles: ['admin', 'manager'], redirect: '/sign-in', route: '/reports' };
  assert.deepEqual(planToCommand({ flow: 'guard.route', args }).argv, ['create', 'guard', 'Reports', '--feature', 'reports', '--access', 'role', '--roles', 'admin,manager', '--redirect', '/sign-in', '--route', '/reports']);
  const check = (a) => validatePlan({ version: 1, ticket: { source: 'text', title: 't' }, steps: [{ id: 's1', title: 't', flow: 'guard.route', executor: 'deterministic', args: a, touches: { features: [], files: [] } }] });
  assert.equal(check(args).valid, true);
  assert.equal(check({ ...args, access: 'nobody' }).errors[0].code, 'STEP_ARG_ENUM');
  assert.equal(check({ name: 'Reports', feature: 'reports' }).errors[0].code, 'STEP_ARG_MISSING');
  assert.equal(check({ ...args, roles: ['Bad Role'] }).errors[0].code, 'STEP_ARG_TYPE');
  assert.equal(check({ ...args, access: 'signed-in' }).errors[0].code, 'STEP_ARG_TYPE', 'roles with signed-in');
  assert.equal(validatePlan({ version: 1, ticket: { source: 'text', title: 't' }, steps: [{ id: 's1', title: 't', flow: 'guard.route', executor: 'local-model', args, touches: { features: [], files: [] } }] }).errors[0].code, 'STEP_EXECUTOR_NOT_ALLOWED');
});

test('the touches are derived: the units, the types and barrel, the route entry and the proof; public writes nothing', () => {
  const dir = guardable();
  const touched = (args) => (expectedFiles(dir, 'guard.route', args) ?? []).map((f) => `${f.change} ${f.path}`);
  assert.deepEqual(touched({ name: 'Products', feature: 'shop', access: 'signed-in' }), [
    'create features/shop/domain/ProductsAccess.domain.ts', 'create features/shop/hooks/useSession.hook.ts', 'create features/shop/components/ProductsFallback.component.tsx', 'create features/shop/expressions/ProductsByAccess.expression.tsx',
    'create features/shop/controllers/ProductsGuardController.controller.tsx', 'modify features/shop/types.ts', 'modify features/shop/index.ts', 'modify src/App.tsx', 'create features/shop/tests/generated/ProductsGuard.proof.test.ts', 'modify architecture.yml',
  ]);
  assert.deepEqual(touched({ name: 'Products', feature: 'shop', access: 'public' }), [], 'public: nothing');
  assert.equal(expectedFiles(dir, 'guard.route', { name: 'products', feature: 'shop', access: 'signed-in' }), null, 'an invalid request derives nothing');
  assert.deepEqual(flowBlock('guard.route').declaredScope({ name: 'Products', feature: 'shop', access: 'signed-in' }, { root: dir }).features, ['shop']);
  assert.deepEqual(guardTouches(dir, { name: 'Products', feature: 'shop', access: 'signed-in', route: '/store' }).find((f) => f.layer === 'route').path, 'src/App.tsx');
  const next = guardable('nextjs');
  assert.equal(guardTouches(next, { name: 'Products', feature: 'shop', access: 'signed-in' }).find((f) => f.layer === 'route').path, 'app/products/page.tsx');
});

test('the CLI writes the guard, wires the route, is idempotent, and every file it wrote is what guardFiles said', () => {
  const dir = guardable();
  const res = guard(dir, '--access', 'role', '--roles', 'admin,manager', '--redirect', '/sign-in');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Guarded src\/App\.tsx: ProductsGuardController wraps ProductsController \(access role\)\. Run: construct test proof shop/);
  assert.match(res.stdout, /Note: The session is signed out until a SessionContext\.Provider above the screen supplies one/);
  for (const f of guardFiles(dir, { name: 'Products', feature: 'shop', access: 'role', roles: 'admin,manager', redirect: '/sign-in' })) assert.equal(fs.readFileSync(f.path, 'utf8'), f.content, path.basename(f.path));
  const domain = fs.readFileSync(path.join(dir, 'features/shop/domain/ProductsAccess.domain.ts'), 'utf8');
  assert.match(domain, /const needs = \['admin', 'manager'\];/);
  const fallback = fs.readFileSync(path.join(dir, 'features/shop/components/ProductsFallback.component.tsx'), 'utf8');
  assert.match(fallback, /<a href="\/sign-in">Go to \/sign-in<\/a>/);
  assert.match(fallback, /'wrong-role': 'You need one of these roles to open the products screen: admin, manager\.'/);
  const validated = JSON.parse(run(['validate', '--format', 'json'], dir).stdout);
  assert.deepEqual(validated.violations, [], 'the written slice passes the default rules');
  const snapshot = featureTree(dir);
  const app = fs.readFileSync(routeFile(dir), 'utf8');
  const again = guard(dir, '--access', 'role', '--roles', 'admin,manager', '--redirect', '/sign-in');
  assert.equal(again.status, 0);
  assert.match(again.stdout, /^Unchanged: the Products screen is already guarded \(role\)\./);
  assert.deepEqual(featureTree(dir), snapshot);
  assert.equal(fs.readFileSync(routeFile(dir), 'utf8'), app);
  const json = JSON.parse(guard(dir, '--access', 'role', '--roles', 'admin,manager', '--redirect', '/sign-in', '--format', 'json').stdout);
  assert.deepEqual([json.ok, json.kind, json.access, json.noop, json.route, json.session, json.files], [true, 'guard', 'role', false, 'src/App.tsx', 'stub', []], 'the JSON form of a repeated run: nothing changed');
});

test('public is a documented no-op: it says so, writes nothing and exits 0', () => {
  const dir = guardable();
  const before = fs.readFileSync(routeFile(dir), 'utf8');
  const tree = featureTree(dir);
  const res = guard(dir, '--access', 'public');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^public: no guard was written\. A route without a guard is open to everyone/);
  assert.deepEqual(featureTree(dir), tree);
  assert.equal(fs.readFileSync(routeFile(dir), 'utf8'), before);
  const json = JSON.parse(guard(dir, '--access', 'public', '--format', 'json').stdout);
  assert.deepEqual([json.noop, json.files, json.route], [true, [], null]);
});

test('refusals say why and write nothing: no route, another rule, a type that means something else, a missing feature, bad flags', () => {
  const dir = shapeProject('react-spa'); // a feature but no controller, no route
  const tree = featureTree(dir);
  const noRoute = guard(dir, '--access', 'signed-in');
  assert.equal(noRoute.status, 2);
  assert.match(noRoute.stderr, /The route entry renders <ProductsController \/> nowhere, so the guard cannot be wired to it\. Wire the route first: construct create route Products/);
  assert.deepEqual(featureTree(dir), tree, 'nothing was written');
  assert.match(run(['create', 'guard', 'Products', '--feature', 'ghost', '--access', 'signed-in'], dir).stderr, /Feature "ghost" not found/);
  assert.match(run(['create', 'guard', 'Products', '--feature', 'shop'], dir).stderr, /Usage: construct create guard/);
  assert.match(run(['create', 'guard', 'Products', '--feature', 'shop', '--access', 'signed-in', '--llm', 'claude'], dir).stderr, /no model/);
  assert.match(guard(dir, '--access', 'role').stderr, /The role access needs the roles/);
  assert.match(guard(dir, '--access', 'signed-in', '--roles', 'admin').stderr, /Roles only belong to the role access/);

  const wired = guardable();
  assert.equal(guard(wired, '--access', 'signed-in').status, 0);
  const other = guard(wired, '--access', 'role', '--roles', 'admin');
  assert.equal(other.status, 2);
  assert.match(other.stderr, /The Products screen is already guarded by another rule \(features\/shop\/domain\/ProductsAccess\.domain\.ts differs/);

  const clash = guardable();
  fs.appendFileSync(path.join(clash, 'features/shop/types.ts'), "\nexport interface Session { user: string }\n");
  const before = fs.readFileSync(routeFile(clash), 'utf8');
  const res = guard(clash, '--access', 'signed-in');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /types\.ts of "shop" already declares Session for something else/);
  assert.equal(fs.readFileSync(routeFile(clash), 'utf8'), before, 'the route entry is untouched');
  assert.equal(fs.existsSync(path.join(clash, 'features/shop/domain/ProductsAccess.domain.ts')), false);
});

test('the route edit is a pure, minimal splice: it wraps the one element, adds one import, is idempotent and refuses what it cannot place', () => {
  const opts = { controller: 'ProductsController', guard: 'ProductsGuardController', importPath: '../features/shop/controllers/ProductsGuardController.controller' };
  const source = "import { Routes, Route } from 'react-router-dom';\nimport { ProductsController } from '../features/shop/controllers/ProductsController';\n\nexport const App = () => (\n  <Routes>\n    <Route path=\"/p\" element={<ProductsController />} />\n  </Routes>\n);\n";
  const edited = guardRouteSource(source, opts);
  assert.equal(edited.changed, true);
  assert.equal(edited.source, "import { Routes, Route } from 'react-router-dom';\nimport { ProductsController } from '../features/shop/controllers/ProductsController';\nimport { ProductsGuardController } from '../features/shop/controllers/ProductsGuardController.controller';\n\nexport const App = () => (\n  <Routes>\n    <Route path=\"/p\" element={<ProductsGuardController><ProductsController /></ProductsGuardController>} />\n  </Routes>\n);\n");
  assert.deepEqual(guardRouteSource(edited.source, opts), { source: edited.source, changed: false }, 'idempotent');
  assert.throws(() => guardRouteSource(source.replace('<ProductsController />', '<Other />'), opts), /renders <ProductsController \/> nowhere/);
  assert.throws(() => guardRouteSource(source.replace('</Routes>', '<Route path="/q" element={<ProductsController />} />\n  </Routes>'), opts), /2 times/);
  assert.throws(() => guardRouteSource(source.replace("import { ProductsController } from '../features/shop/controllers/ProductsController';", 'const x = 1;'), opts), /does not import ProductsController by name/);
});

test('the session comes from the project\'s own provider when it has a session provider of Session, else the typed stub that is signed out', () => {
  const dir = guardable();
  assert.deepEqual(sessionSourceOf(dir, 'shop'), { kind: 'stub' });
  fs.writeFileSync(path.join(dir, 'features/shop/hooks/useSessionProvider.provider.ts'), [
    "import { defineProvider } from '@line/construct-core/typed-contracts';", "import type { Session } from '../types';", '',
    '/** The session of the app. */', "const SessionProvider = defineProvider<{ session: Session }, Session>('Session', ({ session }) => session);",
    '/** The root. */', 'export const SessionProviderRoot = SessionProvider.ProviderComponent;', '/** The hook. */', 'export const useSessionProvider = SessionProvider.useProvider;', '',
  ].join('\n'));
  fs.appendFileSync(path.join(dir, 'features/shop/types.ts'), "\nexport type Session =\n  | { status: 'signed-out' }\n  | { status: 'signed-in'; userId: string; roles: string[] };\n");
  const source = sessionSourceOf(dir, 'shop');
  assert.deepEqual(source, { kind: 'provider', hook: 'useSessionProvider', spec: './useSessionProvider.provider', id: 'useSessionProvider' });
  const res = guard(dir, '--access', 'signed-in');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Note: The session is read from useSessionProvider/);
  const hook = fs.readFileSync(path.join(dir, 'features/shop/hooks/useProductsSession.hook.ts'), 'utf8');
  assert.match(hook, /import \{ useSessionProvider \} from '\.\/useSessionProvider\.provider';/);
  assert.match(hook, /export function useProductsSession\(\): Session \{\n {2}return useSessionProvider\(\);\n\}/);
  assert.equal(fs.existsSync(path.join(dir, 'features/shop/hooks/useSession.hook.ts')), false, 'no stub beside a real provider');
  assert.deepEqual(JSON.parse(run(['validate', '--format', 'json'], dir).stdout).violations, []);
  const proof = fs.readFileSync(path.join(dir, 'features/shop/tests/generated/ProductsGuard.proof.test.ts'), 'utf8');
  assert.doesNotMatch(proof, /SessionContext/, 'the proof drives the decision and the expression: the session is the project\'s');
  // A provider whose value is not a Session is not used.
  const other = guardable();
  fs.writeFileSync(path.join(other, 'features/shop/hooks/useAuthProvider.provider.ts'), "import { defineProvider } from '@line/construct-core/typed-contracts';\nconst A = defineProvider<Record<string, never>, { name: string }>('Auth', () => ({ name: 'x' }));\n/** r */\nexport const AuthRoot = A.ProviderComponent;\n/** h */\nexport const useAuthProvider = A.useProvider;\n");
  assert.deepEqual(sessionSourceOf(other, 'shop'), { kind: 'stub' });
});

test('q-access: a closed question of at most three options, the rules default FIRST, read off the card (a role, else a session, else public)', async () => {
  const of = (text, answer) => accessOffer(cardOf(text), { name: 'Products', answer });
  const session = of('A logged-in user wants to see a list of products');
  assert.deepEqual([session.question.id, session.access, session.question.default, session.question.options.map((o) => o.id)], ['q-access', 'signed-in', 'signed-in', ['signed-in', 'public', 'role']]);
  assert.equal(session.question.options[2].enabled, false, 'role is offered off, with the reason, when the card names none');
  assert.match(session.question.options[2].why, /names no role/);
  const admin = of('An admin wants to see a list of products');
  assert.deepEqual([admin.access, admin.roles, admin.question.options.map((o) => o.id)], ['role', ['admin'], ['role', 'public', 'signed-in']]);
  assert.match(admin.question.options[0].label, /Only admin/);
  const none = of('A user wants to see a list of products');
  assert.deepEqual([none.access, none.question.options.map((o) => o.id), none.question.chosen], ['public', ['public', 'signed-in', 'role'], null], 'no session noun: public, the rules default');
  assert.deepEqual(cardRoles(cardOf('An admin wants to see a list of products')), ['admin']);
  const chosen = of('A user wants to see a list of products', { option: 'signed-in', by: 'person' });
  assert.deepEqual([chosen.access, chosen.question.chosen, chosen.refused], ['signed-in', 'signed-in', null]);
  assert.match(of('A user wants to see a list of products', 'role').refused, /names no role/, 'an answer the card cannot support is refused, not replaced');
  assert.match(of('A user wants to see a list of products', 'nobody').refused, /not an option of q-access/);
  // Every option carries a label and a reason at a fixed size, and the rules-only provider suggests the default.
  for (const o of session.question.options) assert.ok(o.label.length <= 60 && o.why.length <= 120, `${o.id} fits the fixed size`);
  const s = await suggest({ id: session.question.id, question: session.question.question, options: session.question.options });
  assert.deepEqual([s.option, s.provider], ['signed-in', 'rules']);
  assert.equal(wiringChooserId('q-access'), 'requirement.plan.access');
  assert.equal(wiringChooserId('q-access-orders'), 'requirement.plan.access');
});

test('planFromBlocks: q-access is raised only when the card is handed over, an answer is a recorded decision, and a refused answer is a typed error', () => {
  const dir = guardable();
  const card = cardOf('A logged-in user wants to see a list of products');
  const first = placeCard(card, { framework: 'react-spa' });
  const placed = placeCard(card, { framework: 'react-spa', answers: { 'q-shape': { option: 'list', by: 'person' } } });
  assert.deepEqual(first.errors, []);
  const feature = 'items';
  const noCard = planFromBlocks(placed.blocks, { feature, root: dir, decisions: placed.decisions });
  assert.equal(noCard.offers.some((o) => o.id === 'q-access'), false, 'no card, no question: existing plans are as they were');
  const withCard = planFromBlocks(placed.blocks, { feature, root: dir, decisions: placed.decisions, card });
  assert.equal(withCard.ok, true, JSON.stringify(withCard.errors));
  assert.deepEqual(withCard.offers.find((o) => o.id === 'q-access').options.map((o) => o.id), ['signed-in', 'public', 'role']);
  const answered = planFromBlocks(placed.blocks, { feature, root: dir, decisions: placed.decisions, card, answers: { 'q-access': { option: 'public', by: 'llm', provider: 'claude' } } });
  assert.equal(answered.plan.steps.some((s) => s.flow === 'guard.route'), false);
  assert.deepEqual(answered.decisions.filter((d) => d.question === 'q-access'), [{ question: 'q-access', option: 'public', by: 'llm', provider: 'claude' }]);
  const refused = planFromBlocks(placed.blocks, { feature, root: dir, decisions: placed.decisions, card, answers: { 'q-access': 'role' } });
  assert.equal(refused.ok, false);
  assert.equal(refused.errors[0].code, 'PLAN_ACCESS_UNAVAILABLE');
  const skipRoute = planFromBlocks(placed.blocks, { feature, root: dir, decisions: placed.decisions, card, wire: false });
  assert.equal(skipRoute.offers.some((o) => o.id === 'q-access'), false, 'no wiring, no route to guard, no question');
});
