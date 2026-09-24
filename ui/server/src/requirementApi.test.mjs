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
  assert.deepEqual(shaped.plan.steps.slice(7).map((s) => s.flow), ['create.proof', 'test.proof'], '#623: the plan ends with the proof of the screen and its read-only run');
  assert.deepEqual(shaped.plan.steps[1].args, { layer: 'domain', name: 'Products', feature: 'products', shape: 'list', entity: 'Product', fields: 'id:string,name:string,price:number' });
  assert.deepEqual(shaped.placement.decisions, [{ question: 'q-shape', option: 'list', by: 'person' }]);
  assert.equal(shaped.offers[0].chosen, 'list');

  const bad = (await post({ text: sentence, answers: [{ id: 'q-shape', option: 'grid' }] })).body;
  assert.equal(bad.placement.ok, false, 'an unknown option is a typed error, never a guess');
  assert.deepEqual(bad.placement.errors.map((e) => e.code), ['PLACE_UNKNOWN_OPTION']);
  assert.equal(bad.plan, null);
  assert.deepEqual((await post({ text: SEARCH })).body.offers, [], 'a search is not a plain list: no offer');
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
