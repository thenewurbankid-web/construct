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
import { assertMemoryRecordsView, assertMemoryExport } from '../../../packages/engine/line/knows/contract.mjs';

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

// "What Line knows", Memory tab: the page's routes (knows/contract.mjs KNOWS_API) on im3's real store. Every write and
// the export are a person's in Cockpit (the page's Origin plus the approval token); each change is logged.
test('Memory tab routes: records read; edit, forget one, forget all, export, import and embeddings are a person\'s, and logged', async () => {
  const root = makeTempDir('line-memory-page-');
  fs.cpSync(SAMPLE, root, { recursive: true });
  const mem = createMemory(root, { words: [] });
  for (let i = 0; i < 3; i++) await mem.recordOutcome('drafter.route', { intent: 'use.item', structure: null, slots: [], neighbourhood: [], options: ['via-library:ui:I>F', 'base-on:ui:L>F'], proposed: 'via-library:ui:I>F' }, { kind: 'picked', chosen: 'via-library:ui:I>F', by: 'person' });
  const s = await serve(root);
  const person = { origin: ORIGIN, 'x-line-approval': TOKEN };
  const post = (p, body, headers = person) => fetch(`${s.url}/api/line/memory/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const view = await (await fetch(`${s.url}/api/line/memory/records`)).json();
    assertMemoryRecordsView(view);
    assert.equal(view.records.length, 3);
    assert.equal(view.embeddings.on, false);
    const [a, b] = view.records.map((r) => r.id);
    assert.equal((await fetch(`${s.url}/api/line/memory/records?step=..%2Fx`)).status, 400);

    // An agent (no Origin) or a page without the token changes nothing.
    for (const [p, body] of [['edit', { id: a, chosen: 'base-on:ui:L>F' }], ['forget-record', { id: a }], ['forget-all', {}], ['embeddings', { on: true }], ['import', { v: 1, kind: 'line-memory', steps: {} }]]) {
      const agent = await post(p, body, {});
      assert.equal(agent.status, 403, `${p} without Origin`);
      assert.equal((await agent.json()).code, 'NOT_COCKPIT');
      const noToken = await post(p, body, { origin: ORIGIN });
      assert.equal((await noToken.json()).code, 'NO_APPROVAL', `${p} without the token`);
    }
    const agentExport = await fetch(`${s.url}/api/line/memory/export`);
    assert.equal(agentExport.status, 403);
    assert.equal(mem.records('drafter.route').length, 3, 'nothing changed without the person');

    const edited = await (await post('edit', { id: a, chosen: 'base-on:ui:L>F' })).json();
    assertMemoryRecordsView(edited);
    assert.equal(mem.records('drafter.route').find((r) => r.id === a)?.chosen, 'base-on:ui:L>F');
    const badEdit = await post('edit', { id: a, chosen: 'nope' });
    assert.equal(badEdit.status, 400);

    const forgot = await (await post('forget-record', { id: b })).json();
    assert.equal(forgot.records.length, 2);
    assert.ok(!mem.records('drafter.route').some((r) => r.id === b));

    const file = await (await fetch(`${s.url}/api/line/memory/export`, { headers: person })).json();
    assertMemoryExport(file);
    assert.equal(file.steps['drafter.route'].length, 2);

    const on = await (await post('embeddings', { on: true })).json();
    assert.equal(on.embeddings.on, true);

    const all = await (await post('forget-all', {})).json();
    assert.equal(all.records.length, 0);
    assert.deepEqual(mem.sizes(), {});

    const back = await (await post('import', file)).json();
    assert.equal(back.records.length, 2);

    // im3's forget-a-step is logged too.
    await fetch(`${s.url}/api/line/memory/forget`, { method: 'POST', headers: { 'content-type': 'application/json', ...person }, body: JSON.stringify({ step: 'drafter.route' }) });
    const final = await (await fetch(`${s.url}/api/line/memory/records`)).json();
    assert.deepEqual(final.log.map((e) => e.action), ['edit', 'forget', 'embeddings', 'forgetAll', 'import', 'forgetStep']);
    assert.ok(final.log.every((e) => e.by === 'person'));
    assert.equal(final.records.length, 0);
  } finally { await s.close(); }
});
