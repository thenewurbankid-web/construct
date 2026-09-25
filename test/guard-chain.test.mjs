// #629 -- the whole chain for the ROUTE GUARD, run for real: the sentence "A logged-in user wants to see a list of products" goes through parseRequirement, placeCard,
// planFromBlocks (the requirement card is handed over, so the closed question `q-access` is raised and its rules default is signed-in: the card has a session
// state noun) and the plan's own commands (planToCommand, run through the CLI) in a fresh `construct init` project with the typed-contracts phase 1 rules ON.
// Then: every file that changed is a file the plan declared, `construct validate` reports no error and no warning, `tsc --noEmit` passes, the proof RUNS
// green (a signed-out visitor sees only the fallback, an allowed person only the screen) and a deliberately broken guard makes it FAIL naming who was let in,
// and a second run in a fresh project writes the same bytes. The role access (a card that names an admin) and the Next.js route entry follow.
// Same guard as test/list-shape-chain.test.mjs: a lane without react-dom skips with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planTouches } from '../packages/core/plan.mjs';
import { NEEDS_RUNTIME, execute, featureFiles, initProject, planFor, projectFiles, run, typeCheck, validateJson } from '../test-utils/shapeChain.mjs';

const FEATURE = 'features/products';
const SIGNED_IN = 'A logged-in user wants to see a list of products';
const ADMIN = 'An admin wants to see a list of products';
const plan = (dir, sentence = SIGNED_IN, answers = {}) => planFor(dir, sentence, 'products', 'list', 'endpoint', { card: true, answers });
const proofRun = (dir, name) => run(['test', 'proof', 'products', '--format', 'json', ...(name ? ['--name', name] : [])], dir);
const violations = (dir) => validateJson(dir).violations.map((v) => `${v.severity} ${v.rule} ${v.file}`);

test('the sentence becomes a plan with a guard step, runs, and gives a screen only a signed-in person sees: validates, type-checks and is PROVEN', NEEDS_RUNTIME, async (t) => {
  const dir = initProject('react-spa', 'guard');
  const { planned } = await plan(dir);
  const offer = planned.offers.find((o) => o.id === 'q-access');
  assert.deepEqual([offer.default, offer.options.map((o) => [o.id, o.enabled])], ['signed-in', [['signed-in', true], ['public', true], ['role', false]]], 'the rules default is signed-in (the card has a session noun); role is off with a reason: the card names no role');
  assert.match(offer.options[2].why, /names no role/);
  assert.deepEqual(planned.plan.steps.map((s) => s.flow), ['create.feature', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'create.unit', 'add.dependency', 'sync', 'create.route', 'guard.route', 'check.types', 'create.proof', 'test.proof', 'test.proof']);
  const step = planned.plan.steps.find((s) => s.flow === 'guard.route');
  assert.deepEqual(step.args, { name: 'Products', feature: 'products', access: 'signed-in', route: '/products' });
  assert.deepEqual(step.dependsOn, ['s10'], 'the guard waits for the route it wraps');
  assert.deepEqual(planned.guards, [{ name: 'Products', access: 'signed-in', roles: [], question: 'q-access', step: 's11' }]);
  assert.deepEqual(planned.proof.steps.map((p) => [p.name, p.proofStep, p.verifiedBy]), [['Products', 's13', 's14'], ['ProductsGuard', 's11', 's15']], 'the guard is part of the chain: its proof must be green too');
  assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-access'), [], 'unanswered: the rules default is used and nothing is recorded as a person\'s choice');

  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const written = featureFiles(dir);
  const declared = planTouches(planned.plan).files.map((f) => f.path).sort();
  const after = projectFiles(dir);
  assert.deepEqual(Object.keys(after).filter((f) => after[f] !== before[f]).sort(), declared, 'every file the commands created or changed is a file the plan declared: nothing was done by hand');

  await t.test('the files it wrote', () => {
    const files = Object.keys(written).filter((f) => f.startsWith(`${FEATURE}/`)).map((f) => f.slice(FEATURE.length + 1));
    for (const want of ['domain/ProductsAccess.domain.ts', 'hooks/useSession.hook.ts', 'components/ProductsFallback.component.tsx', 'expressions/ProductsByAccess.expression.tsx', 'controllers/ProductsGuardController.controller.tsx', 'tests/generated/ProductsGuard.proof.test.ts']) assert.ok(files.includes(want), want);
    assert.ok(Object.values(written).every((c) => !/\bTODO\b/.test(c)), 'no stub is left to fill');
    const at = (f) => written[`${FEATURE}/${f}`];
    assert.match(at('domain/ProductsAccess.domain.ts'), /defineDomain<\{ session: Session \}, Access>\('decideProductsAccess'/);
    assert.match(at('controllers/ProductsGuardController.controller.tsx'), /defineController<ProductsGuardProps>/);
    assert.match(at('expressions/ProductsByAccess.expression.tsx'), /if \(access\.status === 'allowed'\) return <>\{children\}<\/>;/);
    assert.match(at('types.ts'), /export type Session =\n {2}\| \{ status: 'signed-out' \}\n {2}\| \{ status: 'signed-in'; userId: string; roles: string\[\] \};/);
    assert.match(at('index.ts'), /ProductsGuardController/, 'the barrel exports the guard controller (SLICE-003 stays quiet)');
    assert.doesNotMatch(at('hooks/useSession.hook.ts'), /^'use client'/, 'react-spa has no server components');
  });

  await t.test('the route entry renders the guard around the controller, and nothing else changed there', () => {
    const app = fs.readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8');
    assert.match(app, /<Route path="\/products" element=\{<ProductsGuardController><ProductsController \/><\/ProductsGuardController>\} \/>/);
    assert.match(app, /import \{ ProductsGuardController \} from '\.\.\/features\/products\/controllers\/ProductsGuardController\.controller';/);
  });

  await t.test('construct validate: no error and no warning, with the phase 1 rules on', () => {
    assert.deepEqual(violations(dir), []);
  });

  await t.test('tsc --noEmit passes on the features (the proofs included) and the route entry', () => {
    const tsc = typeCheck(dir, ['src/App.tsx']);
    assert.equal(tsc.status, 0, tsc.output);
  });

  await t.test('the proof passes: signed-out sees only the fallback, signed-in only the screen, and the chain is complete', () => {
    const res = proofRun(dir, 'ProductsGuard.proof.test.ts');
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const result = JSON.parse(res.stdout);
    assert.deepEqual(result.tests.map((x) => x.title), ['Products guard: a signed-out visitor sees only the fallback', 'Products guard: a signed-in person sees only the screen', 'Products guard: a screen with no session provider above it is closed', 'Products guard: the decision', 'Products guard: the fallback replaces the screen, it does not sit beside it']);
    assert.equal(result.chain.complete, true);
    const both = proofRun(dir);
    assert.equal(both.status, 0, 'the screen proof and the guard proof run together');
    assert.equal(JSON.parse(both.stdout).counts.failed, 0);
  });

  await t.test('a broken guard FAILS the proof, and the message names who was let in or kept out', () => {
    const feature = path.join(dir, 'features', 'products');
    const cases = [
      // The decision lets a signed-out visitor in.
      { file: path.join(feature, 'domain', 'ProductsAccess.domain.ts'), from: "if (session.status === 'signed-out') return { status: 'signed-out' };", to: "if (session.status === 'signed-out') return { status: 'allowed' };", title: 'Products guard: a signed-out visitor sees only the fallback', expected: ['fallback', 'screen'] },
      // The expression shows the fallback for everyone.
      { file: path.join(feature, 'expressions', 'ProductsByAccess.expression.tsx'), from: "if (access.status === 'allowed') return <>{children}</>;", to: "if (access.status === 'nobody') return <>{children}</>;", title: 'Products guard: a signed-in person sees only the screen', expected: ['screen', 'fallback'] },
      // The screen is rendered BESIDE the fallback: it leaks.
      { file: path.join(feature, 'expressions', 'ProductsByAccess.expression.tsx'), from: 'return <ProductsFallback access={access} />;', to: 'return <><ProductsFallback access={access} />{children}</>;', title: 'Products guard: the fallback replaces the screen, it does not sit beside it', expected: ['fallback', 'screen'] },
    ];
    for (const c of cases) {
      const good = fs.readFileSync(c.file, 'utf8');
      const broken = good.replace(c.from, c.to);
      assert.notEqual(broken, good, `the line was there: ${c.from}`);
      fs.writeFileSync(c.file, broken);
      try {
        const res = proofRun(dir, 'ProductsGuard.proof.test.ts');
        assert.equal(res.status, 1, 'exit 1: the proof ran and failed');
        const result = JSON.parse(res.stdout);
        const own = result.tests.find((x) => x.title === c.title);
        assert.equal(own.status, 'failed', `${c.title} failed: ${result.tests.filter((x) => x.status === 'failed').map((x) => x.title)}`);
        assert.equal(own.failure.kind, 'app', 'the app behaved differently: not a harness problem');
        assert.deepEqual([own.failure.expected, own.failure.reached], c.expected);
        assert.equal(result.chain.complete, false);
      } finally {
        fs.writeFileSync(c.file, good);
      }
    }
    assert.equal(proofRun(dir).status, 0, 'and the proof is green again once the guard is');
  });

  await t.test('the guarded screen renders only the fallback when signed out (the same markup a person would get)', async () => {
    const { build } = await import('esbuild');
    fs.mkdirSync(path.join(dir, 'smoke'));
    fs.writeFileSync(path.join(dir, 'smoke', 'entry.tsx'), [
      "import { renderToString } from 'react-dom/server';",
      "import { ProductsGuardController } from '../features/products/controllers/ProductsGuardController.controller';",
      "import { SessionContext } from '../features/products/hooks/useSession.hook';",
      "export const html = (signedIn: boolean) => renderToString(<SessionContext.Provider value={signedIn ? { status: 'signed-in', userId: 'u1', roles: [] } : { status: 'signed-out' }}><ProductsGuardController><main>the screen</main></ProductsGuardController></SessionContext.Provider>);",
    ].join('\n'));
    const reactDir = fs.realpathSync(path.join(dir, 'node_modules', 'react'));
    await build({ entryPoints: [path.join(dir, 'smoke', 'entry.tsx')], outfile: path.join(dir, 'smoke', 'entry.cjs'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', alias: { react: reactDir }, absWorkingDir: dir, logLevel: 'silent' });
    const { createRequire } = await import('node:module');
    const screen = createRequire(import.meta.url)(path.join(dir, 'smoke', 'entry.cjs'));
    assert.equal(screen.html(false), '<p role="alert">Sign in to open the products screen.</p>');
    assert.equal(screen.html(true), '<main>the screen</main>');
  });

  await t.test('a second run in a fresh project writes the same bytes', async () => {
    const other = initProject('react-spa', 'guard');
    const again = await plan(other);
    assert.deepEqual(again.planned.plan, planned.plan, 'the same plan');
    execute(other, again.planned.plan);
    assert.deepEqual(featureFiles(other), written, 'the guard and its proof included');
    for (const f of ['src/App.tsx', 'architecture.yml']) assert.equal(fs.readFileSync(path.join(other, f), 'utf8'), fs.readFileSync(path.join(dir, f), 'utf8'), `${f} too`);
  });

  await t.test('running the guard again changes nothing at all', () => {
    const snapshot = projectFiles(dir);
    const again = run(['create', 'guard', 'Products', '--feature', 'products', '--access', 'signed-in', '--route', '/products'], dir);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /^Unchanged: the Products screen is already guarded \(signed-in\)\./);
    assert.deepEqual(projectFiles(dir), snapshot);
  });
});

test('the role access: a card that names an admin makes role the rules default, and the guard is proven for a signed-in person WITHOUT the role', NEEDS_RUNTIME, async () => {
  const dir = initProject('react-spa', 'guard-role');
  const { planned } = await plan(dir, ADMIN);
  const offer = planned.offers.find((o) => o.id === 'q-access');
  assert.deepEqual([offer.default, offer.options.map((o) => o.id), offer.options.map((o) => o.enabled)], ['role', ['role', 'public', 'signed-in'], [true, true, true]]);
  const step = planned.plan.steps.find((s) => s.flow === 'guard.route');
  assert.deepEqual(step.args, { name: 'Products', feature: 'products', access: 'role', roles: ['admin'], route: '/products' });
  execute(dir, planned.plan);
  assert.deepEqual(violations(dir), []);
  assert.equal(typeCheck(dir, ['src/App.tsx']).status, 0);
  const result = JSON.parse(proofRun(dir, 'ProductsGuard.proof.test.ts').stdout);
  assert.equal(result.counts.failed, 0);
  assert.ok(result.tests.some((x) => x.title === 'Products guard: a signed-in person without the role sees only the fallback'));
  const domain = fs.readFileSync(path.join(dir, 'features', 'products', 'domain', 'ProductsAccess.domain.ts'), 'utf8');
  assert.match(domain, /const needs = \['admin'\];/);
  // A signed-in person without the role must be kept out: let everyone signed in through and the proof names it.
  const file = path.join(dir, 'features', 'products', 'domain', 'ProductsAccess.domain.ts');
  fs.writeFileSync(file, domain.replace("  if (held.length === 0) return { status: 'wrong-role', needs };\n", ''));
  const failed = JSON.parse(proofRun(dir, 'ProductsGuard.proof.test.ts').stdout).tests.filter((x) => x.status === 'failed');
  assert.deepEqual(failed.map((x) => [x.title, x.failure.expected, x.failure.reached]), [['Products guard: a signed-in person without the role sees only the fallback', 'fallback', 'screen'], ['Products guard: the decision', 'wrong-role', 'allowed']]);
});

test('public: the answer that writes nothing. A plan with q-access answered public has no guard step, and the CLI says so and changes no file', NEEDS_RUNTIME, async () => {
  const dir = initProject('react-spa', 'guard-public');
  const { planned } = await plan(dir, SIGNED_IN, { 'q-access': { option: 'public', by: 'person' } });
  assert.equal(planned.plan.steps.some((s) => s.flow === 'guard.route'), false);
  assert.deepEqual(planned.guards, [{ name: 'Products', access: 'public', roles: [], question: 'q-access', step: null }]);
  assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-access'), [{ question: 'q-access', option: 'public', by: 'person' }], 'the choice is a recorded decision');
  execute(dir, planned.plan);
  const snapshot = projectFiles(dir);
  const res = run(['create', 'guard', 'Products', '--feature', 'products', '--access', 'public'], dir);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^public: no guard was written\./);
  assert.deepEqual(projectFiles(dir), snapshot);
  assert.match(fs.readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8'), /element=\{<ProductsController \/>\}/, 'the route is as the wiring step left it: open');
});

test('the same guard on a Next.js project: the route entry is edited, the session hook and the controller are client files, and everything validates and is proven', NEEDS_RUNTIME, async () => {
  const dir = initProject('nextjs', 'guard');
  const { planned } = await plan(dir);
  const guardStep = planned.plan.steps.find((s) => s.flow === 'guard.route');
  assert.ok(guardStep.touches.files.some((f) => f.path === 'app/products/page.tsx' && f.change === 'modify'), 'the guard declares the route entry it edits');
  const before = projectFiles(dir);
  execute(dir, planned.plan);
  const after = projectFiles(dir);
  assert.deepEqual([...Object.keys(after), ...Object.keys(before)].filter((f, i, all) => all.indexOf(f) === i && after[f] !== before[f]).sort(), planTouches(planned.plan).files.map((f) => f.path).sort(), 'no file changed that the plan did not declare');
  assert.equal(after['app/products/page.tsx'], "import { ProductsController } from '../../features/products/controllers/ProductsController.controller';\nimport { ProductsGuardController } from '../../features/products/controllers/ProductsGuardController.controller';\n\nexport default function Page() {\n  return <ProductsGuardController><ProductsController /></ProductsGuardController>;\n}\n");
  const files = featureFiles(dir);
  assert.ok(files['features/products/controllers/ProductsGuardController.controller.tsx'].startsWith("'use client';"));
  assert.ok(files['features/products/hooks/useSession.hook.ts'].startsWith("'use client';"));
  assert.deepEqual(violations(dir), []);
  assert.equal(typeCheck(dir, ['app/products/page.tsx']).status, 0);
  const proof = proofRun(dir);
  assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
  assert.equal(JSON.parse(proof.stdout).counts.failed, 0);
});
