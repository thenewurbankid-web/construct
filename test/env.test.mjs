// #632 -- `add.env`: one environment variable in .env.example (a comment and a placeholder, never a real value), the closed
// question `q-env` a card with `server-only-secret` or `validated-redirect` raises, and the plan that carries the step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { PLAN_FLOWS, planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { expectedFiles } from '../packages/core/plan-touches.mjs';
import { flowScopeKind } from '../packages/core/block-flows.mjs';
import { validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { choicesFromWiring, wiringChooserId } from '../packages/core/decision-trace-adapters.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { addEnv, envArgProblem, envOffers, envTouches, envVariableName, looksSecret, secretsOfCard, ENV_FILE } from '../packages/core/env.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const run = (args, cwd) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd });
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const SENTENCE = 'A logged-in user wants to safely manage billing details Stripe';

function project(framework = 'nextjs') {
  const dir = makeTempDir(`construct-env-${framework}-`);
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yaml.dump({ version: 1, preset: 'strict-nextjs', project: { framework }, features: { root: 'features' } }));
  return dir;
}

test('names are [A-Z][A-Z0-9_]{0,63}; the scope is a closed choice; a server name carries no public prefix', () => {
  for (const name of ['A', 'STRIPE_SECRET_KEY', 'A'.repeat(64), 'X1_Y2']) assert.equal(envArgProblem({ name, scope: 'server' }), null, name);
  for (const name of ['', 'stripe', '1ABC', '_ABC', 'A-B', 'A B', 'A'.repeat(65), 'Abc']) assert.match(envArgProblem({ name, scope: 'server' }), /upper case letters/, JSON.stringify(name));
  assert.match(envArgProblem({ name: 'API_URL', scope: 'both' }), /scope is one of: server, public/);
  assert.match(envArgProblem({ name: 'API_URL' }), /scope is one of/);
  assert.match(envArgProblem({ name: 'NEXT_PUBLIC_API_URL', scope: 'server' }), /starts with a public prefix/);
  assert.match(envArgProblem({ name: 'VITE_API_URL', scope: 'server' }), /starts with a public prefix/);
  assert.equal(envArgProblem({ name: 'NEXT_PUBLIC_API_URL', scope: 'public' }), null);
});

test('a secret-shaped name is refused ONLY when a value is supplied; without one a placeholder is written', () => {
  for (const name of ['STRIPE_SECRET_KEY', 'DB_PASSWORD', 'GITHUB_TOKEN', 'SIGNING_KEY', 'API_KEY', 'PRIVATE_KEY', 'AWS_ACCESS_KEY', 'AUTH_SALT']) {
    assert.equal(looksSecret(name), true, name);
    assert.match(envArgProblem({ name, scope: 'server', value: 'abc' }), /looks like a secret/, `${name} with a value`);
    assert.equal(envArgProblem({ name, scope: 'server' }), null, `${name} without a value`);
  }
  for (const name of ['API_URL', 'PORT', 'NODE_ENV', 'FEATURE_FLAG', 'MONKEY_URL']) assert.equal(looksSecret(name), false, name);
  assert.equal(envArgProblem({ name: 'API_URL', scope: 'server', value: 'https://example.test' }), null, 'a value for a name that is not secret-shaped is fine');
  assert.match(envArgProblem({ name: 'API_URL', scope: 'server', value: 'has space' }), /plain token/);
  assert.match(envArgProblem({ name: 'API_URL', scope: 'server', value: '"quoted"' }), /plain token/);
  assert.match(envArgProblem({ name: 'API_URL', scope: 'server', value: '$HOME' }), /plain token/);
  assert.match(envArgProblem({ name: 'API_URL', scope: 'server', comment: 'two\nlines' }), /one line/);
  assert.match(envArgProblem({ name: 'API_URL', scope: 'server', comment: 'x'.repeat(121) }), /one line/);
});

test('the scope decides the public prefix: NEXT_PUBLIC_ for Next.js, VITE_ for react-spa, never twice', () => {
  assert.equal(envVariableName({ name: 'API_URL', scope: 'server' }, 'nextjs'), 'API_URL');
  assert.equal(envVariableName({ name: 'API_URL', scope: 'public' }, 'nextjs'), 'NEXT_PUBLIC_API_URL');
  assert.equal(envVariableName({ name: 'API_URL', scope: 'public' }, 'react-spa'), 'VITE_API_URL');
  assert.equal(envVariableName({ name: 'NEXT_PUBLIC_API_URL', scope: 'public' }, 'nextjs'), 'NEXT_PUBLIC_API_URL');
});

test('addEnv creates .env.example with a comment and a placeholder, never a real value; running it twice changes nothing', () => {
  const dir = project();
  assert.deepEqual(envTouches(dir, { name: 'STRIPE_SECRET_KEY', scope: 'server' }), [{ path: ENV_FILE, change: 'create' }]);
  const first = addEnv(dir, { name: 'STRIPE_SECRET_KEY', scope: 'server' });
  assert.deepEqual([first.file, first.variable, first.changed, first.created], ['.env.example', 'STRIPE_SECRET_KEY', true, true]);
  assert.equal(read(dir, '.env.example'), '# Server only: read in a server action, route handler or server component, never in a "use client" file.\nSTRIPE_SECRET_KEY=your-stripe-secret-key-here\n');
  assert.deepEqual(envTouches(dir, { name: 'STRIPE_SECRET_KEY', scope: 'server' }), [{ path: ENV_FILE, change: 'modify' }]);
  assert.equal(addEnv(dir, { name: 'STRIPE_SECRET_KEY', scope: 'server' }).changed, false, 'idempotent');
  assert.equal(read(dir, '.env.example').match(/STRIPE_SECRET_KEY/g).length, 1);

  const pub = addEnv(dir, { name: 'API_URL', scope: 'public', comment: 'Where the browser reaches the API.' });
  assert.deepEqual([pub.variable, pub.created, pub.warning], ['NEXT_PUBLIC_API_URL', false, null]);
  assert.equal(read(dir, '.env.example'), '# Server only: read in a server action, route handler or server component, never in a "use client" file.\nSTRIPE_SECRET_KEY=your-stripe-secret-key-here\n\n# Where the browser reaches the API.\nNEXT_PUBLIC_API_URL=your-next-public-api-url-here\n', 'appended after a blank line, the rest kept');
  const value = addEnv(dir, { name: 'PORT', scope: 'server', value: '3000' });
  assert.equal(value.line, 'PORT=3000');
  assert.equal(fs.existsSync(path.join(dir, '.env')), false, 'the real .env is never written');
});

test('addEnv keeps an existing file byte for byte, recognises a name that is already listed (also with `export`), and refuses a symbolic link', () => {
  const dir = project('react-spa');
  fs.writeFileSync(path.join(dir, '.env.example'), '# mine\nexport API_URL=x\nDEBUG=1');
  assert.equal(addEnv(dir, { name: 'API_URL', scope: 'server' }).changed, false, 'listed with export');
  const added = addEnv(dir, { name: 'SITE', scope: 'public' });
  assert.equal(added.variable, 'VITE_SITE', 'react-spa: the public prefix is VITE_');
  assert.equal(read(dir, '.env.example'), '# mine\nexport API_URL=x\nDEBUG=1\n\n# Public: inlined into the browser bundle. Never put a secret here.\nVITE_SITE=your-vite-site-here\n');
  const looksPublicSecret = addEnv(dir, { name: 'STRIPE_SECRET', scope: 'public' });
  assert.match(looksPublicSecret.warning, /public variable .* name looks like a secret/, 'a public secret-shaped name is written with a warning, not silently');

  const linked = project();
  fs.writeFileSync(path.join(linked, 'real.txt'), 'x');
  fs.symlinkSync(path.join(linked, 'real.txt'), path.join(linked, '.env.example'));
  assert.throws(() => addEnv(linked, { name: 'A', scope: 'server' }), /symbolic link/);
  assert.equal(read(linked, 'real.txt'), 'x');
  assert.throws(() => addEnv(project(), { name: 'lower', scope: 'server' }), /upper case letters/);
  assert.throws(() => addEnv(project(), { name: 'STRIPE_SECRET_KEY', scope: 'server', value: 'sk_live_123' }), /looks like a secret/);
});

test('the flow: registered, mapped to `construct create env`, scope derived, arguments validated by the plan validator', () => {
  const flow = PLAN_FLOWS['add.env'];
  assert.deepEqual([flow.cli, flow.writes, flow.executors], [['create', 'env'], true, ['deterministic', 'user']]);
  assert.deepEqual(planToCommand({ flow: 'add.env', args: { name: 'STRIPE_SECRET_KEY', scope: 'server', comment: 'The key.' } }).argv, ['create', 'env', 'STRIPE_SECRET_KEY', '--scope', 'server', '--comment', 'The key.']);
  assert.equal(flowScopeKind('add.env'), 'derived');
  const dir = project();
  assert.deepEqual(expectedFiles(dir, 'add.env', { name: 'STRIPE_SECRET_KEY', scope: 'server' }), [{ path: '.env.example', change: 'create' }]);
  assert.equal(expectedFiles(dir, 'add.env', { name: 'bad', scope: 'server' }), null, 'an invalid request derives nothing');
  const check = (args) => validatePlan({ version: 1, ticket: { source: 'text', title: 't' }, steps: [{ id: 's1', title: 't', flow: 'add.env', args, executor: 'deterministic', touches: { features: [], files: [{ path: '.env.example', change: 'create' }] } }] }).errors.map((e) => `${e.code} ${e.path}`);
  assert.deepEqual(check({ name: 'STRIPE_SECRET_KEY', scope: 'server' }), []);
  assert.deepEqual(check({ name: 'stripe', scope: 'server' }), ['STEP_ARG_TYPE steps[0].args.name']);
  assert.deepEqual(check({ name: 'STRIPE_SECRET_KEY', scope: 'private' }), ['STEP_ARG_ENUM steps[0].args.scope']);
  assert.ok(check({ name: 'STRIPE_SECRET_KEY' }).includes('STEP_ARG_MISSING steps[0].args.scope'), 'the scope is required, not guessed');
  assert.deepEqual(check({ name: 'STRIPE_SECRET_KEY', scope: 'server', value: 'sk_live_x' }), ['STEP_ARG_TYPE steps[0].args.value'], 'a secret-shaped name with a value is a plan error, not a runtime surprise');
});

test('the CLI: create env, text and json; a bad name, a missing scope, a value for a secret and --llm are usage errors', () => {
  const dir = project();
  const text = run(['create', 'env', 'STRIPE_SECRET_KEY', '--scope', 'server'], dir);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Created \.env\.example: added STRIPE_SECRET_KEY=your-stripe-secret-key-here/);
  assert.match(run(['create', 'env', 'STRIPE_SECRET_KEY', '--scope', 'server'], dir).stdout, /Unchanged \.env\.example: STRIPE_SECRET_KEY is already listed/);
  const json = JSON.parse(run(['create', 'env', 'API_URL', '--scope', 'public', '--format', 'json'], dir).stdout);
  assert.deepEqual([json.ok, json.kind, json.variable, json.files], [true, 'env', 'NEXT_PUBLIC_API_URL', ['.env.example']]);
  assert.equal(run(['create', 'env', 'lower', '--scope', 'server'], dir).status, 2);
  assert.equal(run(['create', 'env', 'API_URL'], dir).status, 2, 'the scope is not guessed');
  const secret = run(['create', 'env', 'DB_PASSWORD', '--scope', 'server', '--value', 'hunter2'], dir);
  assert.equal(secret.status, 2);
  assert.match(secret.stderr, /looks like a secret/);
  assert.equal(read(dir, '.env.example').includes('hunter2'), false, 'the value never reached the file');
  assert.equal(run(['create', 'env', 'API_URL', '--scope', 'server', '--llm', 'claude'], dir).status, 2);
});

test('CLIENT-001 (the reader of the other half): a server variable read in a client file is a violation, a public one is not', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yaml.dump({ version: 1, preset: 'strict-nextjs', project: { framework: 'nextjs' }, features: { root: 'features' }, rules: { 'CLIENT-001': { severity: 'error' } } }));
  fs.mkdirSync(path.join(dir, 'features', 'shop', 'components'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/shop/components/Pay.tsx'), "'use client';\nexport const Pay = () => <b>{process.env.STRIPE_SECRET_KEY}{process.env.NEXT_PUBLIC_API_URL}</b>;\n");
  const found = validateArchitecture(dir).violations.filter((v) => v.rule === 'CLIENT-001');
  assert.equal(found.length, 1, JSON.stringify(found.map((v) => v.message)));
  assert.match(found[0].message, /STRIPE_SECRET_KEY/);
  assert.equal(found[0].message.includes('NEXT_PUBLIC_API_URL'), false);
});

// ------------------------------------------------------------------------------------------------ the card and the plan

test('secretsOfCard: server-only-secret names one variable per outside service, validated-redirect the allow-list; a card without those checks names none', () => {
  const card = parseRequirement(SENTENCE).card;
  assert.deepEqual(secretsOfCard(card).map((s) => [s.name, s.scope, s.check]), [['STRIPE_SECRET_KEY', 'server', 'server-only-secret'], ['ALLOWED_REDIRECT_ORIGINS', 'server', 'validated-redirect']]);
  assert.deepEqual(secretsOfCard(parseRequirement('A user wants to see a list of products').card), []);
  assert.deepEqual(secretsOfCard({ nouns: [], checks: [{ name: 'server-only-secret' }] }), [], 'a secret with no named service gets no invented variable');
  assert.deepEqual(secretsOfCard({ nouns: [{ kind: 'external', text: 'Pay Pal!' }], checks: [{ name: 'server-only-secret' }] }).map((s) => s.name), ['PAY_PAL_SECRET_KEY']);
  assert.deepEqual(secretsOfCard(null), []);
});

test('envOffers: one closed question per variable (add | skip, default add), ids stable, a variable already listed raises none', () => {
  const dir = project();
  const secrets = secretsOfCard(parseRequirement(SENTENCE).card);
  const offers = envOffers(dir, secrets);
  assert.deepEqual(offers.map((o) => o.id), ['q-env-stripe-secret-key', 'q-env-allowed-redirect-origins']);
  for (const o of offers) assert.deepEqual([o.question.default, o.question.chosen, o.question.options.map((x) => x.id), o.add], ['add', null, ['add', 'skip'], true]);
  assert.ok(offers.every((o) => o.question.question.length <= 160 && o.question.options.every((x) => x.label.length <= 60 && x.why.length <= 120)), 'the chooser summary limits hold');
  const skipped = envOffers(dir, secrets, { 'q-env-stripe-secret-key': { option: 'skip', by: 'person' } });
  assert.deepEqual(skipped.map((o) => [o.question.chosen, o.add]), [['skip', false], [null, true]]);
  assert.deepEqual(envOffers(dir, secrets, { 'q-env-stripe-secret-key': 'nonsense' }).map((o) => o.add), [true, true], 'an option that is not offered is ignored, the default applies');
  addEnv(dir, { name: 'STRIPE_SECRET_KEY', scope: 'server' });
  assert.deepEqual(envOffers(dir, secrets).map((o) => o.id), ['q-env'], 'one variable left: the plain id');
  assert.equal(envOffers(dir, secretsOfCard(parseRequirement('A user wants to see a list of products').card)).length, 0);
});

const planFor = (dir, options = {}, sentence = SENTENCE) => {
  const card = parseRequirement(sentence).card;
  const placed = placeCard(card, { framework: 'nextjs' });
  assert.equal(placed.complete, true, JSON.stringify(placed.open));
  return planFromBlocks(placed.blocks, { feature: 'billing', root: dir, decisions: placed.decisions, card, ...options });
};

test('the plan of a card with server-only-secret and validated-redirect carries an add.env step per variable, valid, with the file declared and no value in it', () => {
  const dir = project();
  const planned = planFor(dir);
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
  const envSteps = planned.plan.steps.filter((s) => s.flow === 'add.env');
  assert.deepEqual(envSteps.map((s) => s.args), [{ name: 'STRIPE_SECRET_KEY', scope: 'server' }, { name: 'ALLOWED_REDIRECT_ORIGINS', scope: 'server' }]);
  assert.deepEqual(envSteps.map((s) => s.touches), Array(2).fill({ features: [], files: [{ path: '.env.example', change: 'create' }] }));
  assert.ok(envSteps.every((s) => s.executor === 'deterministic' && !JSON.stringify(s).includes('sk_')), 'no value anywhere in the step');
  assert.deepEqual(planned.env.map((e) => [e.variable, e.scope, e.question, e.step]), [['STRIPE_SECRET_KEY', 'server', 'q-env-stripe-secret-key', envSteps[0].id], ['ALLOWED_REDIRECT_ORIGINS', 'server', 'q-env-allowed-redirect-origins', envSteps[1].id]]);
  assert.deepEqual(planned.offers.filter((o) => o.id.startsWith('q-env')).map((o) => o.id), ['q-env-stripe-secret-key', 'q-env-allowed-redirect-origins']);
  assert.deepEqual(planned.decisions, [], 'unanswered: nobody chose');
  const again = planFor(dir);
  assert.deepEqual(JSON.stringify(again.plan), JSON.stringify(planned.plan), 'deterministic: the same input, the same plan');
});

test('q-env answers: skip leaves the step out, is recorded with who chose, becomes a decision trace; wire: false, no card and a listed variable plan none', () => {
  const dir = project();
  const planned = planFor(dir, { answers: { 'q-env-stripe-secret-key': { option: 'skip', by: 'decision-model', provider: 'rules' }, 'q-env-allowed-redirect-origins': 'add' } });
  assert.deepEqual(planned.plan.steps.filter((s) => s.flow === 'add.env').map((s) => s.args.name), ['ALLOWED_REDIRECT_ORIGINS']);
  assert.deepEqual(planned.env.map((e) => e.step === null), [true, false]);
  assert.deepEqual(planned.decisions, [{ question: 'q-env-stripe-secret-key', option: 'skip', by: 'decision-model', provider: 'rules' }, { question: 'q-env-allowed-redirect-origins', option: 'add', by: 'person' }]);

  const choices = choicesFromWiring(planned);
  assert.deepEqual(choices.map((c) => [c.chooser.id, c.chosen, c.by, c.summary.chosen, c.summary.options.map((o) => o.id)]), [['requirement.plan.env', 'skip', 'decision-model', null, ['add', 'skip']], ['requirement.plan.env', 'add', 'person', null, ['add', 'skip']]]);
  assert.equal(JSON.stringify(choices).includes(dir), false, 'no path in a recorded choice');
  assert.deepEqual(['q-env', 'q-env-stripe-secret-key', 'q-envx', 'q-verify'].map(wiringChooserId), ['requirement.plan.env', 'requirement.plan.env', 'requirement.plan.other', 'requirement.plan.verify']);

  assert.equal(planFor(dir, { wire: false }).plan.steps.some((s) => s.flow === 'add.env'), false);
  const noCard = planFromBlocks(placeCard(parseRequirement(SENTENCE).card, { framework: 'nextjs' }).blocks, { feature: 'billing', root: dir });
  assert.equal(noCard.plan.steps.some((s) => s.flow === 'add.env'), false, 'without the card the plan cannot name a secret');
  addEnv(dir, { name: 'STRIPE_SECRET_KEY', scope: 'server' });
  addEnv(dir, { name: 'ALLOWED_REDIRECT_ORIGINS', scope: 'server' });
  const done = planFor(dir);
  assert.deepEqual([done.env, done.plan.steps.some((s) => s.flow === 'add.env'), done.offers.some((o) => o.id.startsWith('q-env'))], [[], false, false], 'already listed: nothing to add, nothing to ask');
});

test('a card with a secret but no named outside service plans no variable and says so; a plain card is unchanged', () => {
  const dir = project();
  const planned = planFor(dir, {}, 'A logged-in user wants to securely see the current subscription plan');
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(planned.plan.steps.filter((s) => s.flow === 'add.env').map((s) => s.args.name), []);
  assert.ok(planned.notes.some((n) => /names no outside service/.test(n)), planned.notes.join('|'));
  const plain = planFor(dir, {}, 'A user wants to see a list of products');
  assert.deepEqual([plain.env, plain.offers.filter((o) => o.id.startsWith('q-env'))], [[], []]);
});

test('the rules-only provider suggests `add` for the question, and the step runs through the CLI exactly as planned', async () => {
  const dir = project();
  const planned = planFor(dir);
  const q = planned.offers.find((o) => o.id === 'q-env-stripe-secret-key');
  const s = await suggest({ id: q.id, question: q.question, options: q.options });
  assert.equal(s.option, 'add');
  for (const step of planned.plan.steps.filter((x) => x.flow === 'add.env')) {
    const { argv } = planToCommand(step);
    const res = run(argv, dir);
    assert.equal(res.status, 0, `${argv.join(' ')}\n${res.stderr}`);
  }
  assert.equal(read(dir, '.env.example'), '# Server only: read in a server action, route handler or server component, never in a "use client" file.\nSTRIPE_SECRET_KEY=your-stripe-secret-key-here\n\n# Server only: read in a server action, route handler or server component, never in a "use client" file.\nALLOWED_REDIRECT_ORIGINS=your-allowed-redirect-origins-here\n');
});
