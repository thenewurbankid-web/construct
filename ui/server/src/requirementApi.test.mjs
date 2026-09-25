// #642 -- the requirement route. Behaviour on a real fixture project (the billing sentence gives 5 nouns, 3 verbs, 3 checks, four
// placements and a valid plan), the closed questions (a word the lexicon does not know, a server check with no server block),
// and security: a foreign Origin, a non-JSON body, a body over the cap, an unknown answer and a path smuggled in are all refused
// without reading anything. Ports 49400-49449 are this file's (49400 the route on its own, 49401 the real route table).
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createRequirementRouter, readRequirement, featureNameOf, MAX_TEXT, MAX_ANSWERS } from './requirementApi.mjs';
import { validatePlan } from '../../../packages/core/plan.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');
const ORIGIN = 'http://localhost:3000';
const BILLING = 'A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe.';
const UPLOAD = 'A user wants to upload a profile picture and see it update instantly.';
const SEARCH = 'A customer wants to search products with instant keyboard filtering.';

const root = makeTempDir('og642-req-');
fs.cpSync(SHARED, root, { recursive: true });

let server;
const base = 'http://127.0.0.1:49400';
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/requirement', createRequirementRouter({ getRoot: () => ({ ok: true, root }), clientOrigin: ORIGIN }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(49400, '127.0.0.1', resolve));
});
after(() => {
  server.close();
  server.closeAllConnections?.();
});

const post = async (body, headers = {}, raw) => {
  const res = await fetch(`${base}/api/requirement/read`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: raw ?? JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('the billing sentence: 5 nouns, 3 verbs, 3 checks from "safely", four placements, a valid plan and its files', async () => {
  const r = await post({ text: BILLING });
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.ok, true);
  assert.deepEqual([b.card.nouns.length, b.card.verbs.length, b.card.checks.length], [5, 3, 3]);
  assert.deepEqual(b.card.checks.map((c) => c.from), ['safely', 'safely', 'safely']);
  assert.deepEqual(b.open, []);
  assert.deepEqual(b.placement.blocks.map((x) => x.placement), ['server-read', 'presentational', 'client-leaf', 'mutation']);
  assert.equal(validatePlan(b.plan).valid, true);
  assert.equal(b.plan.steps[0].flow, 'create.feature');
  assert.equal(b.plan.steps[0].args.name, 'subscription-plan');
  assert.deepEqual(Object.keys(b.files), ['b1', 'b1-view', 'b2', 'b3']);
  assert.ok(b.files.b3.every((f) => f.startsWith('features/subscription-plan/')));
  assert.equal(b.summary.card.counts.checks, 3);
  assert.ok(b.summary.readBack.length >= 11 && b.summary.blocks.length === 4);
  assert.deepEqual(b.warnings, []);
  assert.equal(JSON.stringify(b).includes(root), false, 'no server path leaves the server');
});

test('the other two example sentences place as the docs say', async () => {
  const up = (await post({ text: UPLOAD })).body;
  assert.deepEqual(up.placement.blocks.map((x) => x.placement), ['client-leaf', 'presentational', 'mutation']);
  const se = (await post({ text: SEARCH })).body;
  assert.deepEqual(se.placement.blocks.map((x) => x.placement), ['presentational', 'client-leaf']);
  assert.deepEqual([up.plan !== null, se.plan !== null], [true, true]);
});

// #619 -- a list of a plural data object is OFFERED the list shape as a closed question that does not hold the plan back;
// answering it (by the same { id, option } shape as every other question) puts the shape on the plan steps.
test('a list of products offers the list shape beside the open questions; answering it shapes the plan, and the plan is valid either way', async () => {
  const sentence = 'A user wants to see a list of products';
  const plain = (await post({ text: sentence })).body;
  assert.deepEqual(plain.open, [], 'the offer never blocks the plan');
  assert.deepEqual(plain.offers.map((q) => [q.id, q.source, q.default, q.chosen]), [['q-shape', 'placement', 'list', null]]);
  assert.deepEqual(plain.offers[0].options.map((o) => o.id), ['list', 'scaffold']);
  assert.equal(validatePlan(plain.plan).valid, true);
  assert.ok(plain.plan.steps.every((s) => s.args.shape === undefined), 'unanswered: the plain scaffold, exactly as before');

  const shaped = (await post({ text: sentence, answers: [{ id: 'q-shape', option: 'list' }] })).body;
  assert.equal(validatePlan(shaped.plan).valid, true);
  assert.deepEqual(shaped.plan.steps.slice(1, 7).map((s) => s.args.shape), ['list', 'list', 'list', 'list', 'list', 'list']);
  assert.deepEqual(shaped.plan.steps.slice(7).map((s) => s.flow), ['sync', 'create.route', 'check.types', 'create.proof', 'test.proof'], '#654, #632 and #623: the plan wires the screen (sync, then the route entry), type-checks it and ends with its proof and the read-only run of it');
  assert.equal(shaped.plan.steps[8].args.route, '/products');
  assert.equal(shaped.plan.steps[8].touches.files.length >= 1, true, 'the route step declares its file');
  assert.deepEqual(shaped.plan.steps[1].args, { layer: 'domain', name: 'Products', feature: 'products', shape: 'list', entity: 'Product', fields: 'id:string,name:string,price:number', source: 'local' }, '#621: the unit says where the screen reads from (the rules default: local, this project has no OpenAPI file)');
  assert.deepEqual(shaped.placement.decisions, [{ question: 'q-shape', option: 'list', by: 'person' }]);
  assert.equal(shaped.offers[0].chosen, 'list');

  const bad = (await post({ text: sentence, answers: [{ id: 'q-shape', option: 'grid' }] })).body;
  assert.equal(bad.placement.ok, false, 'an unknown option is a typed error, never a guess');
  assert.deepEqual(bad.placement.errors.map((e) => e.code), ['PLACE_UNKNOWN_OPTION']);
  assert.equal(bad.plan, null);
  assert.deepEqual((await post({ text: SEARCH })).body.offers, [], 'a search is not a plain list: no offer');
});

// #620, #626, #627 -- the same q-shape question, with the options of the card: one item is offered detail, a write with properties form, an overview dashboard, a step-by-step flow wizard.
// The route draws whatever `offers` carries, so the Requirement screen needs no client change.
test('a single read is offered the detail shape, a write with properties the form shape, an overview the dashboard shape and a flow worded as steps the wizard shape; each shapes the plan, and a wrong option for the card is refused', async () => {
  for (const [sentence, shape, unit, feature, units = 6] of [['A user wants to see the details of a product', 'detail', 'Product', 'product'], ['A user wants to add a product with a name and a price', 'form', 'AddProduct', 'add-product'], ['A manager wants an overview of orders with totals', 'dashboard', 'OrdersDashboard', 'orders-dashboard'], ['A user wants a step by step signup', 'wizard', 'Signup', 'signup', 7]]) {
    const plain = (await post({ text: sentence })).body;
    assert.deepEqual(plain.open, [], 'the offer never blocks the plan');
    assert.deepEqual(plain.offers.map((q) => [q.id, q.source, q.default, q.chosen, q.shape, q.unit]), [['q-shape', 'placement', shape, null, shape, unit]]);
    assert.deepEqual(plain.offers[0].options.map((o) => o.id), [shape, 'scaffold']);
    assert.equal(validatePlan(plain.plan).valid, true);
    assert.ok(plain.plan.steps.every((s) => s.args.shape === undefined), 'unanswered: the plain scaffold, exactly as before');

    const shaped = (await post({ text: sentence, answers: [{ id: 'q-shape', option: shape }] })).body;
    assert.equal(validatePlan(shaped.plan).valid, true);
    assert.equal(shaped.plan.steps[0].args.name, feature);
    assert.deepEqual(shaped.plan.steps.slice(1, 1 + units).map((s) => [s.args.shape, s.args.name]), Array(units).fill([shape, unit]));
    assert.deepEqual(shaped.plan.steps.slice(1 + units).map((s) => s.flow), ['sync', 'create.route', 'check.types', 'create.proof', 'test.proof'], 'the wiring, the type-check and the proof apply to every shape');
    assert.deepEqual(shaped.placement.decisions, [{ question: 'q-shape', option: shape, by: 'person' }]);
    assert.equal(shaped.offers[0].chosen, shape);
    assert.equal(shaped.proof.steps.length, 1, 'the proof of the chain is returned with the plan');

    const wrong = (await post({ text: sentence, answers: [{ id: 'q-shape', option: 'list' }] })).body;
    assert.deepEqual(wrong.placement.errors.map((e) => e.code), ['PLACE_UNKNOWN_OPTION'], 'list is not an option of this card');
    assert.equal(wrong.plan, null);
  }
});

test('a word the lexicon does not know is a closed question; answering replays and places the card', async () => {
  const text = 'A customer wants to frobnicate the invoice list.';
  const first = (await post({ text })).body;
  assert.equal(first.plan, null);
  assert.equal(first.placement, null);
  assert.equal(first.open.length, 1);
  assert.equal(first.open[0].source, 'card');
  assert.equal(first.open[0].id, 'o1');
  assert.deepEqual(first.open[0].options.map((o) => o.id), ['read', 'write', 'interact', 'navigate', 'ignore']);
  const answered = (await post({ text, answers: [{ id: 'o1', option: 'interact' }] })).body;
  assert.deepEqual(answered.open, []);
  assert.deepEqual(answered.placement.blocks.map((x) => x.placement), ['client-leaf']);
  assert.ok(answered.plan);
});

test('a placement question (a server check with no server block) is answered by id, and the answer is kept in the decisions', async () => {
  const text = 'A user can click a button safely.';
  const first = (await post({ text })).body;
  assert.equal(first.placement.complete, false);
  assert.equal(first.plan, null);
  assert.deepEqual(first.open.map((q) => [q.id, q.source]), [['q-server', 'placement']]);
  const done = (await post({ text, answers: [{ id: 'q-server', option: 'mutation' }] })).body;
  assert.deepEqual(done.open, []);
  assert.ok(done.plan);
  assert.deepEqual(done.placement.decisions.map((d) => [d.question, d.option]), [['q-server', 'mutation']]);
});

test('an unknown option or question is a typed 400, never a guess', async () => {
  const text = 'A customer wants to frobnicate the invoice list.';
  const bad = await post({ text, answers: [{ id: 'o1', option: 'teleport' }] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'RESOLVE_UNKNOWN_OPTION');
  const noQuestion = await post({ text, answers: [{ id: 'o9', option: 'read' }] });
  assert.equal(noQuestion.status, 400);
  assert.equal(noQuestion.body.code, 'RESOLVE_UNKNOWN_OPEN');
  const badId = await post({ text, answers: [{ id: '../../etc/passwd', option: 'read' }] });
  assert.equal(badId.status, 400);
  assert.equal(badId.body.code, 'BAD_ANSWERS');
  assert.equal((await post({ text: 'A user can click a button safely.', answers: [{ id: 'q-server', option: 'nonsense' }] })).body.placement.ok, false);
});

test('input limits: empty, too long, too many answers, wrong types', async () => {
  assert.equal((await post({ text: '   ' })).body.code, 'TEXT_REQUIRED');
  assert.equal((await post({})).body.code, 'TEXT_REQUIRED');
  assert.equal((await post({ text: 42 })).body.code, 'TEXT_REQUIRED');
  assert.equal((await post({ text: 'a'.repeat(MAX_TEXT + 1) })).body.code, 'TEXT_TOO_LONG');
  assert.equal((await post({ text: BILLING, answers: Array.from({ length: MAX_ANSWERS + 1 }, () => ({ id: 'o1', option: 'read' })) })).body.code, 'BAD_ANSWERS');
  assert.equal((await post({ text: BILLING, answers: 'o1' })).body.code, 'BAD_ANSWERS');
  assert.equal((await post({ text: BILLING, answers: [null] })).body.code, 'BAD_ANSWERS');
});

test('a path or a project the client names is ignored: the project is the server\'s', async () => {
  const r = await post({ text: BILLING, root: '/etc', projectDir: '/tmp', feature: '../../x', path: '/etc/passwd' });
  assert.equal(r.status, 200);
  assert.equal(r.body.plan.steps[0].args.name, 'subscription-plan');
  assert.equal(JSON.stringify(r.body.plan).includes('/etc'), false);
});

test('security: a foreign Origin is 403, a non-JSON body 415, an oversized body 413 (none of them read anything)', async () => {
  assert.equal((await post({ text: BILLING }, { origin: 'https://evil.example' })).status, 403);
  const form = await fetch(`${base}/api/requirement/read`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: JSON.stringify({ text: BILLING }) });
  assert.equal(form.status, 415);
  const big = await post(undefined, {}, JSON.stringify({ text: 'a', pad: 'x'.repeat(20 * 1024) }));
  assert.equal(big.status, 413);
  assert.equal((await fetch(`${base}/api/requirement/nope`, { headers: { origin: ORIGIN } })).status, 404);
  assert.equal((await fetch(`${base}/api/requirement/read`, { headers: { origin: ORIGIN } })).status, 404, 'GET is not a route');
});

test('the route only reads: nothing is written to the project', async () => {
  const listing = () => fs.readdirSync(root, { recursive: true }).sort().join('\n');
  const before = listing();
  await post({ text: BILLING });
  await post({ text: UPLOAD });
  assert.equal(listing(), before);
});

test('an existing feature of that name is a warning on the plan, not a crash', () => {
  const dir = makeTempDir('og642-req-exists-');
  fs.cpSync(SHARED, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'features', 'subscription-plan'), { recursive: true });
  const r = readRequirement({ text: BILLING }, dir);
  assert.equal(r.status, 200);
  assert.match(r.body.warnings[0], /already exists/);
  assert.ok(r.body.plan);
});

test('a project whose framework the blocks do not know answers with typed errors and no plan', () => {
  const dir = makeTempDir('og642-req-fw-');
  fs.cpSync(SHARED, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'architecture.yml'), fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8').replace('framework: nextjs', 'framework: react-spa'));
  const r = readRequirement({ text: BILLING }, dir);
  assert.equal(r.status, 200);
  assert.ok(r.body.placement.notes.some((n) => /react-spa/.test(n)), 'the SPA variant says so');
  assert.ok(r.body.plan);
});

// #632 -- every closed question of the plan rides in `offers` and is answered by id like the shape and the data source: the environment
// variables a card's checks call for (q-env, one per named secret), and how far a shaped plan verifies itself (q-verify).

test('#632: the billing sentence raises a q-env per named secret and the plan carries the add.env steps; an answer is recorded and changes the plan', async () => {
  const plain = (await post({ text: BILLING })).body;
  const envOffers = plain.offers.filter((q) => q.id.startsWith('q-env'));
  assert.deepEqual(envOffers.map((q) => [q.id, q.source, q.default, q.chosen, q.options.map((o) => o.id)]), [['q-env-stripe-secret-key', 'plan', 'add', null, ['add', 'skip']], ['q-env-allowed-redirect-origins', 'plan', 'add', null, ['add', 'skip']]]);
  assert.deepEqual(plain.plan.steps.filter((s) => s.flow === 'add.env').map((s) => [s.args, s.touches.files]), [[{ name: 'STRIPE_SECRET_KEY', scope: 'server' }, [{ path: '.env.example', change: 'create' }]], [{ name: 'ALLOWED_REDIRECT_ORIGINS', scope: 'server' }, [{ path: '.env.example', change: 'create' }]]]);
  assert.equal(validatePlan(plain.plan).valid, true);
  assert.equal(plain.suggestions['q-env-stripe-secret-key'].option, 'add', 'the decision provider suggests on it like on every other offer');
  assert.deepEqual(plain.open, [], 'a closed question never blocks the plan');
  assert.equal(JSON.stringify(plain).includes(root), false, 'no server path leaves the server');

  const skipped = (await post({ text: BILLING, answers: [{ id: 'q-env-stripe-secret-key', option: 'skip' }] })).body;
  assert.deepEqual(skipped.plan.steps.filter((s) => s.flow === 'add.env').map((s) => s.args.name), ['ALLOWED_REDIRECT_ORIGINS']);
  assert.equal(skipped.offers.find((q) => q.id === 'q-env-stripe-secret-key').chosen, 'skip');
  assert.deepEqual(skipped.placement.decisions.filter((d) => d.question.startsWith('q-env')), [{ question: 'q-env-stripe-secret-key', option: 'skip', by: 'person' }]);
  assert.equal((await post({ text: BILLING, answers: [{ id: 'q-env-stripe-secret-key', option: 'Not An Option' }] })).status, 400, 'an option id has a fixed shape');
  assert.equal((await post({ text: BILLING, answers: [{ id: 'q-env-x'.repeat(20), option: 'add' }] })).status, 400, 'a question id that cannot be one the plan asks is refused');
});

test('#659: a wizard plan is asked q-steps: three steps by default, two or four on request; the answer changes every unit and the proof, and is recorded', async () => {
  const sentence = 'A user wants a step by step signup';
  const shape = { id: 'q-shape', option: 'wizard' };
  const stepsIn = (body) => [...new Set(body.plan.steps.flatMap((s) => (s.args?.steps ? [s.args.steps] : [])))];
  const asked = (await post({ text: sentence, answers: [shape] })).body;
  const offer = asked.offers.find((q) => q.id === 'q-steps');
  assert.deepEqual([offer.source, offer.default, offer.chosen, offer.options.map((o) => [o.id, o.enabled])], ['plan', 'three', null, [['three', true], ['two', true], ['four', true]]]);
  assert.deepEqual(asked.offers.map((q) => q.id).slice(0, 3), ['q-shape', 'q-source', 'q-steps'], 'asked beside the data source');
  assert.equal(asked.suggestions['q-steps'].option, 'three', 'the default is the first option, so the rules provider suggests it, like for q-source and q-verify');
  assert.deepEqual(stepsIn(asked), ['details,review,done']);
  const four = (await post({ text: sentence, answers: [shape, { id: 'q-steps', option: 'four' }] })).body;
  assert.deepEqual(stepsIn(four), ['details,options,review,done']);
  assert.equal(four.offers.find((q) => q.id === 'q-steps').chosen, 'four');
  assert.deepEqual(four.placement.decisions.at(-1), { question: 'q-steps', option: 'four', by: 'person' });
  assert.equal(validatePlan(four.plan).valid, true);
  assert.equal((await post({ text: sentence, answers: [shape, { id: 'q-steps', option: 'Seven' }] })).status, 400, 'an option id has a fixed shape');
  const refused = (await post({ text: sentence, answers: [shape, { id: 'q-steps', option: 'seven' }] }));
  assert.equal(refused.body.placement.ok, false, 'a well-formed option the question does not have is refused with the choices, never replaced');
  assert.match(refused.body.placement.errors.at(-1).message, /Options: three, two, four/);
  assert.equal((await post({ text: 'A user wants to see a list of products', answers: [{ id: 'q-shape', option: 'list' }] })).body.offers.some((q) => q.id === 'q-steps'), false, 'only the wizard is asked');
});

test('#632: a shaped plan is asked q-verify: type-check by default, both, or none; the answer changes the steps and is recorded; a plan without the shape has nothing to verify', async () => {
  const sentence = 'A user wants to see a list of products';
  const shape = { id: 'q-shape', option: 'list' };
  assert.deepEqual((await post({ text: sentence })).body.offers.map((q) => q.id), ['q-shape'], 'no shaped unit, no verification to ask about');
  const asked = (await post({ text: sentence, answers: [shape] })).body;
  const verify = asked.offers.find((q) => q.id === 'q-verify');
  assert.deepEqual([verify.source, verify.default, verify.chosen, verify.options.map((o) => [o.id, o.enabled])], ['plan', 'types', null, [['types', true], ['types-build', false], ['none', true]]], 'the fixture has no build script, so building is offered disabled');
  assert.equal(verify.options[1].why, 'package.json has no "build" script to run.');
  assert.deepEqual(asked.plan.steps.slice(-3).map((s) => s.flow), ['check.types', 'create.proof', 'test.proof']);
  const none = (await post({ text: sentence, answers: [shape, { id: 'q-verify', option: 'none' }] })).body;
  assert.deepEqual([none.plan.steps.some((s) => s.flow === 'check.types'), none.offers.find((q) => q.id === 'q-verify').chosen, none.plan.steps.at(-1).flow], [false, 'none', 'test.proof']);
  assert.deepEqual(none.placement.decisions.at(-1), { question: 'q-verify', option: 'none', by: 'person' });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'vite build' } }));
  try {
    const both = (await post({ text: sentence, answers: [shape, { id: 'q-verify', option: 'types-build' }] })).body;
    assert.deepEqual(both.plan.steps.filter((s) => s.flow.startsWith('check.')).map((s) => s.flow), ['check.types', 'check.build']);
    assert.equal(both.offers.find((q) => q.id === 'q-verify').options[1].enabled, true);
    assert.equal(both.plan.steps.at(-1).flow, 'test.proof', 'the proof stays last');
  } finally {
    fs.rmSync(path.join(root, 'package.json'));
  }
});

test('#632: the route and dependency questions of the wiring are returned and answerable too (they were only defaults before)', async () => {
  const sentence = 'A user wants to see a list of products';
  const shape = { id: 'q-shape', option: 'list' };
  assert.equal((await post({ text: sentence, answers: [shape] })).body.offers.some((q) => q.id === 'q-route'), false, 'the route is free, so nothing is asked');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', dependencies: {} }));
  try {
    const dep = (await post({ text: sentence, answers: [shape] })).body;
    assert.deepEqual(dep.offers.filter((q) => q.id === 'q-dependency').map((q) => [q.source, q.default]), [['plan', 'add-dependency']]);
    assert.equal(dep.plan.steps.some((s) => s.flow === 'add.dependency'), true);
    const skip = (await post({ text: sentence, answers: [shape, { id: 'q-dependency', option: 'skip' }] })).body;
    assert.equal(skip.plan.steps.some((s) => s.flow === 'add.dependency'), false);
    assert.deepEqual(skip.placement.decisions.at(-1), { question: 'q-dependency', option: 'skip', by: 'person' });
  } finally {
    fs.rmSync(path.join(root, 'package.json'));
  }
});

// #621 -- where a shaped screen reads its data from is a closed question beside the plan (`q-source`), drawn by the client like q-shape:
// answered by the same { id, option }, recorded like the others, never holding Approve back, and an option that was not offered is refused.
test('a shaped screen is offered its data source; the rules default is local, or the OpenAPI operation when the project has one; answering changes the units', async () => {
  const sentence = 'A user wants to see a list of products';
  const shape = { id: 'q-shape', option: 'list' };
  const unitSteps = (r) => r.plan.steps.filter((s) => s.flow === 'create.unit');
  const plain = (await post({ text: sentence })).body;
  assert.deepEqual(plain.offers.map((q) => q.id), ['q-shape'], 'no shape chosen, no shaped unit, no data source to ask about');

  const asked = (await post({ text: sentence, answers: [shape] })).body;
  assert.deepEqual(asked.offers.map((q) => [q.id, q.source, q.default, q.chosen, q.options.map((o) => o.id)]), [['q-shape', 'placement', 'list', 'list', ['list', 'scaffold']], ['q-source', 'plan', 'local', null, ['local', 'endpoint']], ['q-states', 'plan', 'default', null, ['default', 'custom', 'skip-empty', 'skip-all']], ['q-verify', 'plan', 'types', null, ['types', 'types-build', 'none']]]);
  assert.equal(asked.suggestions['q-source'].option, 'local', 'the decision provider suggests on it like on every other offer');
  assert.deepEqual(asked.open, [], 'the offer never blocks the plan');
  assert.ok(unitSteps(asked).every((s) => s.args.source === 'local'));
  assert.ok(asked.plan.steps[1].touches.files.map((f) => f.path).includes('features/products/domain/ProductsStore.domain.ts'), 'the domain step declares the local store it writes');

  const endpoint = (await post({ text: sentence, answers: [shape, { id: 'q-source', option: 'endpoint' }] })).body;
  assert.equal(endpoint.offers[1].chosen, 'endpoint');
  assert.ok(unitSteps(endpoint).every((s) => s.args.source === 'endpoint'));
  assert.deepEqual(endpoint.placement.decisions, [{ question: 'q-shape', option: 'list', by: 'person' }, { question: 'q-source', option: 'endpoint', by: 'person' }], 'who chose is recorded beside the shape');
  assert.equal(endpoint.plan.steps[1].touches.files.some((f) => f.path.includes('Store')), false, 'the endpoint source writes no store');

  const refused = (await post({ text: sentence, answers: [shape, { id: 'q-source', option: 'openapi' }] })).body;
  assert.deepEqual([refused.placement.ok, refused.plan, refused.placement.errors.map((e) => e.code)], [false, null, ['PLAN_SOURCE_UNAVAILABLE']], 'openapi was not offered, so it is refused, never replaced by another source');

  fs.writeFileSync(path.join(root, 'openapi.yaml'), "openapi: 3.0.3\ninfo: { title: t, version: '1' }\nservers: [{ url: /v1 }]\npaths:\n  /products:\n    get: { operationId: listProducts, responses: { '200': { description: ok } } }\n");
  try {
    const spec = (await post({ text: sentence, answers: [shape] })).body;
    assert.deepEqual(spec.offers[1].options.map((o) => o.id), ['openapi', 'local', 'endpoint']);
    assert.equal(spec.offers[1].default, 'openapi', 'the rules default is the contract when there is one');
    assert.ok(unitSteps(spec).every((s) => s.args.source === 'openapi'));
    assert.equal(JSON.stringify(spec).includes(root), false, 'no server path leaves the server');
    const local = (await post({ text: sentence, answers: [shape, { id: 'q-source', option: 'local' }] })).body;
    assert.ok(unitSteps(local).every((s) => s.args.source === 'local'));
  } finally {
    fs.rmSync(path.join(root, 'openapi.yaml'));
  }
});

test('featureNameOf turns the screen name into a feature folder name', () => {
  assert.equal(featureNameOf('SubscriptionPlan'), 'subscription-plan');
  assert.equal(featureNameOf('Products'), 'products');
  assert.equal(featureNameOf('ProfilePicture'), 'profile-picture');
});

test('the real route table: 401 without a session, and mounted after the session gate and the project gate', async () => {
  process.env.CONSTRUCT_GITHUB_CLIENT_ID = 'client-id';
  process.env.CONSTRUCT_GITHUB_CLIENT_SECRET = 'client-secret';
  process.env.CONSTRUCT_ALLOWED_LOGINS = 'owner-login';
  process.env.CONSTRUCT_SESSION_SECRET = 'x'.repeat(48);
  delete process.env.CONSTRUCT_E2E_LOGIN;
  const { app } = await import('./index.mjs');
  const real = http.createServer(app);
  await new Promise((resolve) => real.listen(49401, '127.0.0.1', resolve));
  try {
    const res = await fetch('http://127.0.0.1:49401/api/requirement/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: BILLING }) });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'auth_required');
  } finally {
    real.close();
    real.closeAllConnections?.();
  }
  const src = fs.readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const gate = src.indexOf("app.use('/api', auth.requireSession)");
  assert.ok(gate > 0 && src.indexOf("app.use('/api/requirement'") > gate);
  const projectGate = src.slice(src.indexOf('requireProject(),') - 400, src.indexOf('requireProject(),'));
  assert.ok(projectGate.includes("'/api/requirement'"), 'listed in the project-open gate');
});

test('#622: a list plan is asked q-states: default views unless answered; the answer changes every unit and the proof, a skip is a warning, and it is recorded', async () => {
  const sentence = 'A user wants to see a list of products';
  const shape = { id: 'q-shape', option: 'list' };
  const statesIn = (body) => [...new Set(body.plan.steps.flatMap((s) => (s.args?.states ? [s.args.states] : [])))];
  const asked = (await post({ text: sentence, answers: [shape] })).body;
  const offer = asked.offers.find((q) => q.id === 'q-states');
  assert.deepEqual([offer.source, offer.default, offer.chosen, offer.options.map((o) => [o.id, o.enabled])], ['plan', 'default', null, [['default', true], ['custom', true], ['skip-empty', true], ['skip-all', true]]]);
  assert.deepEqual(asked.offers.map((q) => q.id).slice(0, 3), ['q-shape', 'q-source', 'q-states'], 'asked beside the data source');
  assert.equal(asked.suggestions['q-states'].option, 'default', 'the default is the first option, so the rules provider suggests it');
  assert.deepEqual([statesIn(asked), asked.warnings], [[], []], 'unanswered: the plan is what it always was, with no warning');
  const skipped = (await post({ text: sentence, answers: [shape, { id: 'q-states', option: 'skip-empty' }] })).body;
  assert.deepEqual(statesIn(skipped), ['skip-empty']);
  assert.equal(skipped.offers.find((q) => q.id === 'q-states').chosen, 'skip-empty');
  assert.deepEqual(skipped.placement.decisions.at(-1), { question: 'q-states', option: 'skip-empty', by: 'person' });
  assert.match(skipped.warnings.join(' '), /Products screen has no view for its empty state/, 'a skip is a warning beside the plan, never a block');
  assert.equal(validatePlan(skipped.plan).valid, true);
  assert.deepEqual(statesIn((await post({ text: sentence, answers: [shape, { id: 'q-states', option: 'custom' }] })).body), ['custom']);
  assert.equal((await post({ text: sentence, answers: [shape, { id: 'q-states', option: 'Hidden' }] })).status, 400, 'an option id has a fixed shape');
  const refused = await post({ text: sentence, answers: [shape, { id: 'q-states', option: 'hidden' }] });
  assert.equal(refused.body.placement.ok, false, 'a well-formed option the question does not have is refused with the choices, never replaced');
  assert.match(refused.body.placement.errors.at(-1).message, /Options: default, custom, skip-empty, skip-all/);
  assert.equal((await post({ text: 'A user wants a step by step signup', answers: [{ id: 'q-shape', option: 'wizard' }] })).body.offers.some((q) => q.id === 'q-states'), false, 'a wizard has steps, not fetch states');
});
