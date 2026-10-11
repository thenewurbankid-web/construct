// Line API (GET /api/line/project): below the session gate, answers the contract's LineProject (mock and
// real model), and every failure is one sentence.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createLineRouter } from './lineApi.mjs';
import { assertLineFeatureDetail, assertLineProject, LineOpError } from '../../../packages/engine/line/contract.mjs';
import { createMockLineOps } from '../../../packages/engine/line/mock.mjs';
import { app as realApp, auth as realAuth } from './index.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;
const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');

async function withStack({ getRoot, readProject, readFeature }, fn) {
  const auth = createAuth(resolveAuthConfig(ENV, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/line', createLineRouter({ getRoot, ...(readProject ? { readProject } : {}), ...(readFeature ? { readFeature } : {}) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const get = async (p, withCookie = true) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { headers: { origin: ORIGIN, ...(withCookie ? { cookie: cookie() } : {}) } });
    return { status: r.status, body: await r.json() };
  };
  try { await fn(get); } finally { server.close(); server.closeAllConnections?.(); }
}

test('GET /api/line/project needs a session (401 without one)', async () => {
  await withStack({ getRoot: () => ({ ok: true, root: SAMPLE }) }, async (get) => {
    assert.equal((await get('/api/line/project', false)).status, 401);
  });
});

test('GET /api/line/project answers the contract shape from the mock', async () => {
  const mock = createMockLineOps();
  await withStack({ getRoot: () => ({ ok: true, root: '/mock' }), readProject: mock.readLineProject }, async (get) => {
    const r = await get('/api/line/project');
    assert.equal(r.status, 200);
    assertLineProject(r.body);
    assert.deepEqual(r.body, mock.readLineProject('/mock'));
  });
});

test('GET /api/line/project answers the real model for the Line sample', async () => {
  await withStack({ getRoot: () => ({ ok: true, root: SAMPLE }) }, async (get) => {
    const r = await get('/api/line/project');
    assert.equal(r.status, 200);
    assertLineProject(r.body);
    assert.equal(r.body.isLine, true);
    assert.equal(r.body.library.find((l) => l.id === 'components/Card').level, 'molecule');
  });
});

test('no project, a refused read and a crash are each one sentence', async () => {
  await withStack({ getRoot: () => ({ ok: false, error: 'No project is open; pick a project first.' }) }, async (get) => {
    assert.deepEqual(await get('/api/line/project'), { status: 400, body: { ok: false, code: 'NO_PROJECT', sentence: 'No project is open; pick a project first.' } });
  });
  await withStack({ getRoot: () => ({ ok: true, root: '/x' }), readProject: () => { throw new LineOpError('That folder is not a project.', 'NOT_A_PROJECT'); } }, async (get) => {
    assert.deepEqual(await get('/api/line/project'), { status: 400, body: { ok: false, code: 'NOT_A_PROJECT', sentence: 'That folder is not a project.' } });
  });
  await withStack({ getRoot: () => ({ ok: true, root: '/x' }), readProject: () => { throw new Error('boom'); } }, async (get) => {
    const r = await get('/api/line/project');
    assert.equal(r.status, 500);
    assert.match(r.body.sentence, /^Cockpit could not read this project as a Line project\.$/);
  });
});

test('the real server registers /api/line AFTER the session gate', () => {
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const router = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/line'));
  assert.ok(gate >= 0 && router > gate);
});

test('GET /api/line/feature answers the contract shape from the mock and from the real sample', async () => {
  const mock = createMockLineOps();
  await withStack({ getRoot: () => ({ ok: true, root: '/mock' }), readFeature: mock.readLineFeature }, async (get) => {
    const r = await get('/api/line/feature?name=orders');
    assert.equal(r.status, 200);
    assertLineFeatureDetail(r.body);
    assert.deepEqual(r.body, mock.readLineFeature('/mock', 'orders'));
  });
  await withStack({ getRoot: () => ({ ok: true, root: SAMPLE }) }, async (get) => {
    assert.equal((await get('/api/line/feature?name=orders', false)).status, 401);
    const r = await get('/api/line/feature?name=orders');
    assert.equal(r.status, 200);
    assertLineFeatureDetail(r.body);
    assert.deepEqual(r.body.spec.stories[0].points.map((p) => p.covered), [true, false]);
    const billing = await get('/api/line/feature?name=billing');
    assert.deepEqual(billing.body.findings.map((f) => f.rule).sort(), ['LINE-BASE', 'LINE-DIR']);
  });
});

test('GET /api/line/feature refuses a missing or unknown name with one sentence', async () => {
  await withStack({ getRoot: () => ({ ok: true, root: SAMPLE }) }, async (get) => {
    assert.deepEqual(await get('/api/line/feature'), { status: 400, body: { ok: false, code: 'BAD_REQUEST', sentence: 'Name the feature to show, for example ?name=orders.' } });
    assert.equal((await get('/api/line/feature?name=..%2F..')).body.code, 'BAD_REQUEST');
    assert.deepEqual(await get('/api/line/feature?name=nope'), { status: 400, body: { ok: false, code: 'UNKNOWN_ITEM', sentence: 'There is no feature "nope"; pick one from the list.' } });
  });
  await withStack({ getRoot: () => ({ ok: true, root: '/x' }), readFeature: () => { throw new Error('boom'); } }, async (get) => {
    assert.deepEqual(await get('/api/line/feature?name=a'), { status: 500, body: { ok: false, code: 'READ_FAILED', sentence: 'Cockpit could not read this feature.' } });
  });
});
