// System 1 drafter routes (lineDraftApi.mjs) on a copy of examples/line-sample with the built-in plan store: off by
// default; on, a request lists checked routes, a picked route's steps join the plan and wait for approval, a refused
// route is one sentence, an answered question is remembered, and the stored record holds no project names.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLinePlanRouter } from './linePlanApi.mjs';
import { createLineDraftRouter } from './lineDraftApi.mjs';
import { assertDraftView, assertPlanView } from '../../../packages/engine/line/contract.mjs';
import { createLinePlanService, loadPlanApi } from '../../../packages/engine/line/planService.mjs';
import { assertNoIdentifiers } from '../../../packages/engine/line/drafter/contract.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');
const ORIGIN = 'http://localhost:3000';
const NO_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };

async function serve(t, { enabled = true } = {}) {
  const dir = makeTempDir('construct-line-draft-api-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  const app = express();
  app.use(express.json());
  const svc = createLinePlanService({ root: dir, commands: null, load: (o) => loadPlanApi({ ...o, linkOptions: NO_LINK }) });
  const getRoot = () => ({ ok: true, root: dir });
  app.use('/api/line', createLinePlanRouter({ clientOrigin: ORIGIN, getRoot, serviceFor: () => svc }));
  app.use('/api/line', createLineDraftRouter({ clientOrigin: ORIGIN, getRoot, serviceFor: () => svc, enabled }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const post = async (p, body) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async (p) => (await fetch(`${base}${p}`)).json();
  return { dir, post, get };
}

test('drafter routes: off by default, a draft is a 404 with one sentence', async (t) => {
  const { get, post } = await serve(t, { enabled: false });
  assert.deepEqual(await get('/plan/draft'), { ok: true, on: false });
  const r = await post('/plan/draft', { request: 'add a badge to orders' });
  assert.equal(r.status, 404);
  assert.equal(r.body.sentence, 'The drafter is off; start the server with LINE_DRAFTER=1 to turn it on.');
});

test('drafter routes: a request lists checked routes; the picked route joins the plan waiting for approval; approve + run writes it', async (t) => {
  const { dir, get, post } = await serve(t);
  assert.deepEqual(await get('/plan/draft'), { ok: true, on: true });
  const d = await post('/plan/draft', { request: 'Add a badge to the orders feature' });
  assert.equal(d.status, 200, d.body.sentence);
  assertDraftView(d.body);
  const r = d.body.routes[0];
  assert.equal(d.body.recommended, r.id);
  assert.equal(r.label, 'Add a new component OrdersBadge to orders, based on the library Badge.');
  assert.equal(r.sentence, 'Construct tried it on a copy of the project: every check passes.');
  const file = path.join(dir, 'features/orders/components/OrdersBadge.tsx');
  assert.equal(fs.existsSync(file), false, 'drafting writes nothing');
  const added = await post('/plan/draft/add', { request: 'Add a badge to the orders feature', routeId: r.id });
  assert.equal(added.status, 200, added.body.sentence);
  assertPlanView(added.body);
  assert.equal(added.body.sentence, 'Added one step to the plan; approve it to run.');
  const step = added.body.steps.find((s) => s.id === added.body.added[0]);
  assert.equal(step.state, 'waiting');
  assert.equal(fs.existsSync(file), false, 'nothing runs before a person approves');
  assert.equal((await post('/plan/approve', { stepId: step.id })).status, 200);
  const ran = await post('/plan/run', {});
  assert.equal(ran.status, 200, ran.body.sentence);
  assert.ok(fs.existsSync(file));
  const rec = fs.readFileSync(path.join(dir, 'line/drafter/transitions.jsonl'), 'utf8');
  assertNoIdentifiers(JSON.parse(rec.trim()), ['orders', 'billing', 'Badge', 'OrdersBadge', 'OrderButton', 'InvoicesPage']);
});

test('drafter routes: a two-step route adds what can be planned now and says when to add the rest', async (t) => {
  const { post } = await serve(t);
  const d = await post('/plan/draft', { request: 'use OrderButton in billing' });
  assert.equal(d.body.recommended, 'via-library:ui:C1>F1');
  const added = await post('/plan/draft/add', { request: 'use OrderButton in billing', routeId: 'via-library:ui:C1>F1' });
  assert.equal(added.status, 200, added.body.sentence);
  assert.equal(added.body.added.length, 1);
  assert.equal(added.body.next, 1);
  assert.match(added.body.sentence, /^Added 1 of 2 steps; add the rest after step 1 runs, because there is no library item "components\/OrderButton"/);
  await post('/plan/approve', { stepId: added.body.added[0] });
  assert.equal((await post('/plan/run', {})).status, 200);
  const rest = await post('/plan/draft/add', { request: 'use OrderButton in billing', routeId: 'via-library:ui:C1>F1', from: 1 });
  assert.equal(rest.status, 200, rest.body.sentence);
  assert.equal(rest.body.added.length, 1);
});

test('drafter routes: a refused route is one sentence; a question answered once is remembered in the project', async (t) => {
  const { dir, post } = await serve(t);
  const d = await post('/plan/draft', { request: 'create a feature called returns' });
  const refused = d.body.routes.find((r) => r.status === 'refused');
  assert.ok(refused);
  const r = await post('/plan/draft/add', { request: 'create a feature called returns', routeId: refused.id });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'ROUTE_REFUSED');
  const q = await post('/plan/draft', { request: 'add a badge to the shop feature' });
  assert.equal(q.body.questions[0].sentence, 'Which part of the project do you mean by "shop"?');
  const a = await post('/plan/draft/answer', { word: 'shop', key: 'feature:orders' });
  assert.equal(a.status, 200);
  assert.equal(a.body.sentence, 'Line will read "shop" that way from now on in this project.');
  assert.ok(fs.existsSync(path.join(dir, 'line/domain-map.json')));
  const again = await post('/plan/draft', { request: 'add a badge to the shop feature' });
  assert.equal(again.body.questions.length, 0);
  assert.equal(again.body.routes[0].label, 'Add a new component OrdersBadge to orders, based on the library Badge.');
});
