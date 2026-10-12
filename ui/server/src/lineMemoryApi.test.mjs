// im3 + j5: GET /api/line/memory (the open project's memory per step) and POST /api/line/memory/forget (one click, a
// person in Cockpit only: the page's Origin and the approval token).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLineMemoryRouter } from './lineMemoryApi.mjs';
import { createMemory } from '../../../packages/engine/line/memory/index.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');
const ORIGIN = 'http://localhost:3000';
const TOKEN = 'a'.repeat(48);

async function serve(root) {
  const app = express();
  app.use(express.json());
  app.use('/api/line', createLineMemoryRouter({ getRoot: () => ({ ok: true, root }), clientOrigin: ORIGIN, approvalToken: TOKEN }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('GET /memory shows every memory step with its size; Forget is a person\'s, one click, and clears the step', async () => {
  const root = makeTempDir('line-memory-api-');
  fs.cpSync(SAMPLE, root, { recursive: true });
  const mem = createMemory(root, { words: [] });
  for (let i = 0; i < 3; i++) await mem.recordOutcome('drafter.route', { intent: 'add.component', structure: null, slots: [], neighbourhood: [], options: ['a', 'b'], proposed: 'a' }, { kind: 'picked', chosen: 'b', by: 'person' });
  const s = await serve(root);
  try {
    const view = await (await fetch(`${s.url}/api/line/memory`)).json();
    assert.equal(view.ok, true);
    assert.equal(view.total, 3);
    assert.deepEqual(view.steps.find((x) => x.step === 'drafter.route'), { step: 'drafter.route', label: 'Which drafted route you pick', size: 3 });
    assert.ok(view.steps.some((x) => x.step === 'plan.step' && x.size === 0));
    assert.match(view.sentence, /on this computer only/);
    const post = (headers, body = { step: 'drafter.route' }) => fetch(`${s.url}/api/line/memory/forget`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const agent = await post({});
    assert.equal(agent.status, 403);
    assert.equal((await agent.json()).code, 'NOT_COCKPIT');
    const noToken = await post({ origin: ORIGIN });
    assert.equal((await noToken.json()).code, 'NO_APPROVAL');
    assert.equal(mem.sizes()['drafter.route'], 3, 'nothing forgotten without the person');
    const bad = await post({ origin: ORIGIN, 'x-line-approval': TOKEN }, { step: '../x' });
    assert.equal(bad.status, 400);
    const ok = await post({ origin: ORIGIN, 'x-line-approval': TOKEN });
    assert.equal(ok.status, 200);
    const after = await ok.json();
    assert.equal(after.total, 0);
    assert.equal(after.message, 'Line forgot 3 remembered decisions for this step.');
    assert.equal(mem.recall('drafter.route', { intent: 'add.component' }, 5).length, 0);
  } finally { await s.close(); }
});
