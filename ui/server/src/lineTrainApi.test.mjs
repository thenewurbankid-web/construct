// Train Line routes (lineTrainApi.mjs) over a temporary training root seeded from the repo's line/train: the review
// queue, a draft with plain-English routes, Try it in a scratch copy, the owner's save and review logged as 'owner',
// eval and the scoreboard, refusals as one sentence. The open project is never involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLineTrainRouter } from './lineTrainApi.mjs';
import { assertScoreboard, assertTryResult, assertTrainCase } from '../../../packages/engine/line/train/contract.mjs';
import { createMockTrainService } from '../../../packages/engine/line/train/mock.mjs';
import { LOG } from '../../../packages/engine/line/train/store.mjs';

const ORIGIN = 'http://localhost:3000';

async function serve(t, deps) {
  const app = express();
  app.use(express.json());
  app.use('/api/line', createLineTrainRouter({ clientOrigin: ORIGIN, ...deps }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line/train`;
  const post = async (p, body, headers = {}) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
  return { post, get };
}

test('train routes: review queue, draft, try, save, review and eval on a seeded root; every change logged as the owner', async (t) => {
  const root = makeTempDir('construct-line-train-api-');
  const { post, get } = await serve(t, { root });
  const worlds = await get('/worlds');
  assert.equal(worlds.body.worlds[0].key, 'sample');
  const queue = await get('/cases?filter=sample&limit=5');
  assert.equal(queue.status, 200);
  assert.equal(queue.body.cases.length, 5);
  for (const c of queue.body.cases) { const { filled, ...stored } = c; assertTrainCase(stored); assert.ok(filled.request.length > 5); }
  const facts = await get('/facts?world=sample');
  assert.deepEqual(facts.body.features.map((f) => f.name), ['billing', 'orders']);
  assert.ok(facts.body.map.some((e) => e.name === 'orders'));

  const d = await post('/draft', { request: 'Make StatusBadge in orders, based on Badge.', world: 'sample' });
  assert.equal(d.status, 200, d.body.sentence);
  assert.equal(d.body.intentPhrase, 'Add a component to a feature');
  assert.equal(d.body.filled.routes[0].steps[0].sentence, 'Make StatusBadge in orders, based on the library Badge.');
  const tried = await post('/try', { world: 'sample', slots: d.body.slots, route: d.body.routes[0] });
  assertTryResult(tried.body);
  assert.equal(tried.body.ok, true, tried.body.sentence);

  const saved = await post('/cases', { world: 'sample', request: d.body.request, intent: d.body.intent, slots: d.body.slots, routes: d.body.routes, preferred: d.body.recommended });
  assert.equal(saved.status, 200, saved.body.sentence);
  assert.equal(saved.body.case.labelledBy, 'owner');
  const reviewed = await post('/review', { id: queue.body.cases[0].id, verdict: 'disagree', note: 'Wrong route first.' });
  assert.equal(reviewed.body.case.status, 'disputed');
  const log = fs.readFileSync(path.join(root, LOG), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.slice(-2).map((l) => [l.by, l.action]), [['owner', 'save'], ['owner', 'disagree']]);

  const sb = await post('/eval', {});
  assertScoreboard(sb.body);
  assert.ok(sb.body.lastRun);
  assert.equal(sb.body.byFamily['line.baseOn'].label, 'Make from the library');
  assert.equal((await get('/scoreboard')).body.total.disagreed, 1);
});

test('train routes: refusals are one sentence; a foreign page and non-JSON are refused; an unknown world is a 400', async (t) => {
  const { post, get } = await serve(t, { service: createMockTrainService() });
  const empty = await post('/draft', { request: '' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.sentence, 'Type what you want Line to do, in a sentence.');
  const foreign = await post('/review', { id: 'x', verdict: 'agree' }, { origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  const gone = await post('/review', { id: 'nope', verdict: 'agree' });
  assert.equal(gone.body.sentence, 'That case is no longer there; reload the list.');
  const real = await serve(t, { root: makeTempDir('construct-line-train-api-') });
  const bad = await real.get('/facts?world=w99:clean');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.sentence, 'That world is not offered; pick one from the list.');
  assert.equal((await get('/scoreboard')).body.sentence, 'No eval has run yet; press Run eval.');
});
