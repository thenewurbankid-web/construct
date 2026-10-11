// cp1 -- /api/line/plan routes (linePlanApi.mjs) on a copy of examples/line-sample: Base on becomes a waiting plan
// step, nothing is written before Approve, Approve + run writes it through the writer, refusals are one sentence.
// Runs on the built-in plan store (the static fallback) and on the default store (@mx/plan when linked).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLinePlanRouter } from './linePlanApi.mjs';
import { assertPlanView } from '../../../packages/engine/line/contract.mjs';
import { createLinePlanService, loadPlanApi } from '../../../packages/engine/line/planService.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');
const ORIGIN = 'http://localhost:3000';
const NO_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };
const BADGE_FILE = 'features/orders/components/StatusBadge.tsx';

async function serve(t, { builtIn = false, saved = [] } = {}) {
  const dir = makeTempDir('construct-line-plan-api-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  const app = express();
  app.use(express.json());
  const svc = createLinePlanService({ root: dir, commands: null, afterSave: (_r, f) => saved.push(f), ...(builtIn ? { load: (o) => loadPlanApi({ ...o, linkOptions: NO_LINK }) } : {}) });
  app.use('/api/line', createLinePlanRouter({ clientOrigin: ORIGIN, getRoot: () => ({ ok: true, root: dir }), serviceFor: () => svc }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const post = async (p, body, headers = {}) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async () => (await fetch(`${base}/plan`)).json();
  return { dir, post, get, saved };
}

for (const builtIn of [true, false]) {
  test(`plan routes (${builtIn ? 'built-in store' : 'default store'}): add, approve, run; nothing written before Approve; plan file in line/plans`, async (t) => {
    const { dir, post, get, saved } = await serve(t, { builtIn });
    const empty = await get();
    assertPlanView(empty);
    assert.equal(empty.steps.length, 0);
    const added = await post('/plan/step', { tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' } });
    assert.equal(added.status, 200, added.body.sentence);
    assertPlanView(added.body);
    const step = added.body.steps.find((s) => s.id === added.body.stepId);
    assert.equal(step.sentence, 'Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge.');
    assert.equal(fs.existsSync(path.join(dir, BADGE_FILE)), false);
    assert.ok(fs.existsSync(path.join(dir, 'line/plans/ses-cockpit.json')));
    const early = await post('/plan/run', {});
    assert.equal(early.status, 400);
    assert.match(early.body.sentence, /waits for a person to approve it\.$/);
    assert.equal((await post('/plan/approve', { stepId: added.body.stepId })).status, 200);
    const ran = await post('/plan/run', {});
    assert.equal(ran.status, 200, ran.body.sentence);
    const done = ran.body.steps.find((s) => s.id === added.body.stepId);
    assert.equal(done.state, 'done');
    assert.match(done.sentence, /^Saved\. Creates StatusBadge/);
    assert.ok(fs.existsSync(path.join(dir, BADGE_FILE)));
    assert.deepEqual(saved, [BADGE_FILE]);
  });
}

test('plan routes: refusals are one sentence with a code and change nothing', async (t) => {
  const { dir, post, get } = await serve(t, { builtIn: true });
  const taken = await post('/plan/step', { tool: 'line.baseOn', args: { libraryId: 'components/Button', feature: 'orders', name: 'OrderButton' } });
  assert.deepEqual([taken.status, taken.body.code], [400, 'NAME_TAKEN']);
  const unknown = await post('/plan/step', { tool: 'construct.nope', args: {} });
  assert.deepEqual([unknown.status, unknown.body.code], [400, 'UNKNOWN_TOOL']);
  const foreign = await post('/plan/step', { tool: 'line.project' }, { origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await get()).steps.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'line/plans')), false, 'a refused step starts no plan');
});
