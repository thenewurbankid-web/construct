// cu4 -- the Components editor over HTTP, on a copy of examples/line-sample plus the cu4 overlay: GET /api/line/component
// reads one component (Behaviour, Events, States), every edit is a plan step that writes nothing before Approve, and an
// edit of a library component is refused in one sentence with its typed fix ("base a feature item on it").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLinePlanRouter } from './linePlanApi.mjs';
import { createLineRouter } from './lineApi.mjs';
import { createLinePlanService } from '../../../packages/engine/line/planService.mjs';
import { studioEditor, workingCopyPath } from '../../../packages/engine/line/components.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(HERE, '../../../examples/line-sample');
const OVERLAY = path.resolve(HERE, '../../../fixtures/line-cu4');
const ORIGIN = 'http://localhost:3000';
const FILE = 'features/orders/components/OrderDetails.tsx';

async function serve(t) {
  const dir = makeTempDir('construct-line-components-api-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  for (const sub of ['library', 'features']) fs.cpSync(path.join(OVERLAY, sub), path.join(dir, sub), { recursive: true });
  const app = express();
  app.use(express.json());
  const svc = createLinePlanService({ root: dir, commands: null });
  const getRoot = () => ({ ok: /** @type {const} */ (true), root: dir });
  app.use('/api/line', createLineRouter({ getRoot }));
  app.use('/api/line', createLinePlanRouter({ clientOrigin: ORIGIN, getRoot, serviceFor: () => svc }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
  const token = (await get('/plan')).body.approvalToken;
  const post = async (p, body) => {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-line-approval': token }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { dir, get, post };
}

test('GET /api/line/component reads a feature component and a library one; a bad file is one sentence', async (t) => {
  const { get } = await serve(t);
  const r = await get(`/component?file=${encodeURIComponent(FILE)}`);
  assert.equal(r.status, 200, r.body.sentence);
  assert.deepEqual([r.body.name, r.body.kind, r.body.readOnly, r.body.baseName], ['OrderDetails', 'feature', false, 'Disclosure']);
  const lib = await get('/component?file=library/components/Disclosure.tsx');
  assert.equal(lib.body.readOnly, true);
  const bad = await get('/component?file=../x.tsx');
  assert.deepEqual([bad.status, bad.body.code], [400, 'BAD_REQUEST']);
  const unknown = await get('/component?file=features/orders/components/Nope.tsx');
  assert.deepEqual([unknown.status, unknown.body.code], [400, 'UNKNOWN_ITEM']);
});

test('an edit is a plan step: nothing is written before Approve, then the working copy lands and the editor reads it', { skip: studioEditor().ok ? false : 'Studio is not linked here' }, async (t) => {
  const { dir, get, post } = await serve(t);
  const added = await post('/plan/step', { tool: 'line.attachComponentPrimitive', args: { file: FILE, primitive: 'disclosure' } });
  assert.equal(added.status, 200, added.body.sentence);
  assert.equal(fs.existsSync(path.join(dir, workingCopyPath(FILE))), false);
  assert.equal((await post('/plan/approve', { stepId: added.body.stepId })).status, 200);
  const ran = await post('/plan/run', {});
  assert.equal(ran.status, 200, ran.body.sentence);
  assert.ok(fs.existsSync(path.join(dir, workingCopyPath(FILE))));
  const ev = await post('/plan/step', { tool: 'line.addComponentEvent', args: { file: FILE, source: { kind: 'click', slot: 'trigger' }, action: { kind: 'primitive', primitive: 'disclosure-1', action: 'toggle' } } });
  assert.equal(ev.status, 200, ev.body.sentence);
  await post('/plan/approve', { stepId: ev.body.stepId });
  await post('/plan/run', {});
  const v = await get(`/component?file=${encodeURIComponent(FILE)}`);
  assert.equal(v.body.events.groups.length, 1);
  assert.equal(v.body.behaviour.primitives[0].primitive, 'disclosure');
});

test('editing a library component is refused in one sentence with its typed fix, and starts no plan', async (t) => {
  const { dir, post } = await serve(t);
  const r = await post('/plan/step', { tool: 'line.addComponentEvent', args: { file: 'library/components/Disclosure.tsx', source: { kind: 'click', slot: 'trigger' }, action: { kind: 'set', prop: 'open', value: true } } });
  assert.deepEqual([r.status, r.body.code], [400, 'LIBRARY_ITEM']);
  assert.match(r.body.sentence, /^Disclosure is a library component, which stays complete and is never changed here; base a feature item on it and change that\.$/);
  assert.equal(r.body.fixes[0].step.tool, 'line.baseOn');
  assert.equal(fs.existsSync(path.join(dir, 'line/plans')), false);
});
