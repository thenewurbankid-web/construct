// cg1 -- POST /api/line/trace (lineTraceApi.mjs) on examples/line-sample: a request lights its controls with the
// sample's names resolved, open steps light Approve, refusals are one sentence, and nothing is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createLineTraceRouter } from './lineTraceApi.mjs';
import { assertTraceMatch } from '../../../packages/engine/line/contract.mjs';
import { staticDecide } from '../../../packages/engine/line/trace.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');
const ORIGIN = 'http://localhost:3000';

async function serve(t, getRoot = () => ({ ok: true, root: SAMPLE })) {
  const app = express();
  app.use(express.json());
  app.use('/api/line', createLineTraceRouter({ clientOrigin: ORIGIN, getRoot, decide: staticDecide }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  return async (body, headers = {}) => {
    const r = await fetch(`${base}/trace`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
}

const listing = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

test('trace: a request lights its controls with the sample\'s names; open steps light Approve; nothing is written', async (t) => {
  const post = await serve(t);
  const before = listing(SAMPLE);
  const r = await post({ request: 'Base a new StatusBadge on Badge in orders', steps: [{ id: 's1', n: 1, tool: 'line.promote', state: 'waiting' }] });
  assert.equal(r.status, 200);
  assertTraceMatch(r.body);
  assert.deepEqual(r.body.tools.map((x) => x.toolId), ['line.baseOn', 'plan.approve']);
  assert.deepEqual(r.body.tools[0].args, { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' });
  assert.deepEqual(listing(SAMPLE), before);
});

test('trace: with no project open it still maps the words; bad input and foreign pages are refused in one sentence', async (t) => {
  const post = await serve(t, () => ({ ok: false, error: 'No project is open; pick a project first.' }));
  const r = await post({ request: 'Promote OrderButton to the library' });
  assert.equal(r.body.tools[0].toolId, 'line.promote');
  assert.deepEqual(r.body.tools[0].args, {});
  assert.deepEqual((await post({ request: 7 })).body, { ok: false, sentence: 'The request must be text.', code: 'BAD_ARGS' });
  assert.equal((await post({ steps: 'x' })).status, 400);
  assert.equal((await post({}, { origin: 'http://evil.test' })).status, 403);
});
