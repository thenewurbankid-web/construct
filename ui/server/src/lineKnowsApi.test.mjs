// "What Line knows" routes (lineKnowsApi.mjs): below the session gate, every route an entry of the one tool registry,
// the contract's shapes from the mock and from the real Line sample, memory writes logged, every failure one sentence.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createLineKnowsRouter } from './lineKnowsApi.mjs';
import { createLineToolGate } from './lineToolGate.mjs';
import { KNOWS_API, assertChangeView, assertGraphRead, assertMemoryRecordsView, assertSmartView, assertMemoryExport } from '../../../packages/engine/line/knows/contract.mjs';
import { createMockKnows } from '../../../packages/engine/line/knows/mock.mjs';
import { entryForRoute } from '../../../packages/engine/line/toolRegistry.mjs';
import { app as realApp, auth as realAuth } from './index.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;
const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');

async function withStack({ getRoot, serviceFor }, fn) {
  const auth = createAuth(resolveAuthConfig(ENV, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  app.use(express.json());
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/line', createLineToolGate({ getRoot, clientOrigin: ORIGIN, planServiceFor: () => ({ addStep: async () => ({ ok: false, sentence: 'no.' }) }) }));
  app.use('/api/line', createLineKnowsRouter({ getRoot, clientOrigin: ORIGIN, ...(serviceFor ? { serviceFor } : {}) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const call = async (method, p, body, withCookie = true) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { method, headers: { origin: ORIGIN, ...(body ? { 'content-type': 'application/json' } : {}), ...(withCookie ? { cookie: cookie() } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  try { await fn(call); } finally { server.close(); server.closeAllConnections?.(); }
}

test('every route of the page is exactly one entry of the tool registry; memory writes are person only', () => {
  for (const r of Object.values(KNOWS_API)) {
    const e = entryForRoute(r.method, r.path);
    assert.ok(e, `${r.method} ${r.path} is registered`);
    if (r.method === 'POST') { assert.equal(e.writes, 'line'); assert.equal(e.personOnly, true, e.id); }
    else assert.equal(e.kind, 'read');
  }
});

test('GET /api/line/graph needs a session', async () => {
  await withStack({ getRoot: () => ({ ok: true, root: SAMPLE }) }, async (call) => {
    assert.equal((await call('GET', '/api/line/graph', null, false)).status, 401);
  });
});

test('GET /api/line/graph on the real Line sample: G1\'s graph, and for OrderButton who uses it and what breaks', async () => {
  await withStack({ getRoot: () => ({ ok: true, root: SAMPLE }) }, async (call) => {
    const r = await call('GET', `/api/line/graph?focus=${encodeURIComponent('item:orders/components/OrderButton')}`);
    assert.equal(r.status, 200);
    assertGraphRead(r.body);
    assert.ok(r.body.graph.edges.some((e) => e.from === 'item:orders/pages/OrdersPage' && e.type === 'BASED_ON' && e.to === 'item:library/pages/ListPage'));
    assert.deepEqual(r.body.focus.whoCalls, ['item:billing/pages/InvoicesPage']);
    assert.ok(r.body.focus.impactOf.includes('item:billing/pages/InvoicesPage'));
    const bad = await call('GET', '/api/line/graph?focus=rm%20-rf');
    assert.deepEqual([bad.status, bad.body.code], [400, 'BAD_REQUEST']);
  });
});

test('GET /api/line/graph/changes on the real sample: the typed fixes of its findings, each a plan step', async () => {
  await withStack({ getRoot: () => ({ ok: true, root: SAMPLE }) }, async (call) => {
    const r = await call('GET', `/api/line/graph/changes?focus=${encodeURIComponent('item:orders/components/OrderButton')}`);
    assert.equal(r.status, 200);
    assertChangeView(r.body);
    assert.deepEqual(r.body.proposals[0].step, { tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } });
    assert.ok(r.body.proposals.some((p) => p.kind === 'rebase' && p.step.tool === 'line.setBase'));
  });
});

test('stats and memory answer the contract from the mock; a memory write is logged as the person\'s', async () => {
  const mock = createMockKnows();
  await withStack({ getRoot: () => ({ ok: true, root: '/mock' }), serviceFor: () => mock }, async (call) => {
    assertSmartView((await call('GET', '/api/line/graph/stats')).body);
    const recs = (await call('GET', '/api/line/memory/records')).body;
    assertMemoryRecordsView(recs);
    assert.equal(recs.embeddings.on, false, 'embeddings are off by default');
    assertMemoryExport((await call('GET', '/api/line/memory/export')).body);
    const one = (await call('GET', '/api/line/memory/records?step=plan.fix')).body;
    assert.ok(one.records.every((r) => r.step === 'plan.fix'));
    const edited = await call('POST', '/api/line/memory/edit', { id: 'm-mock0004', chosen: 'via-library:ui:C>F' });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body.log.map((l) => [l.by, l.action, l.target]), [['person', 'edit', 'm-mock0004']]);
    const wrong = await call('POST', '/api/line/memory/edit', { id: 'm-mock0004', chosen: 'something else' });
    assert.deepEqual([wrong.status, wrong.body.code], [400, 'BAD_ARGS']);
    const on = await call('POST', '/api/line/memory/embeddings', { on: true });
    assert.equal(on.body.embeddings.on, true);
    const gone = await call('POST', '/api/line/memory/forget-all', {});
    assert.equal(gone.body.records.length, 0);
  });
});

test('no project and a crash are each one sentence; a POST from another page is refused', async () => {
  await withStack({ getRoot: () => ({ ok: false, error: 'No project is open; pick a project first.' }) }, async (call) => {
    assert.deepEqual(await call('GET', '/api/line/graph'), { status: 400, body: { ok: false, code: 'NO_PROJECT', sentence: 'No project is open; pick a project first.' } });
  });
  await withStack({ getRoot: () => ({ ok: true, root: '/x' }), serviceFor: () => ({ stats: () => { throw new Error('boom'); } }) }, async (call) => {
    const r = await call('GET', '/api/line/graph/stats');
    assert.deepEqual([r.status, r.body.sentence], [500, 'Cockpit could not measure this project.']);
  });
  const router = createLineKnowsRouter({ getRoot: () => ({ ok: true, root: '/x' }), clientOrigin: ORIGIN, serviceFor: () => createMockKnows() });
  const app = express();
  app.use(express.json());
  app.use('/api/line', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/line/memory/forget-all`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
  } finally { server.close(); server.closeAllConnections?.(); }
});

test('the real server mounts the page\'s routes AFTER the session gate', () => {
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const knows = stack.findIndex((layer) => layer.handle?.stack?.some?.((l) => l.route?.path === '/graph/changes'));
  assert.ok(gate >= 0 && knows > gate);
});
