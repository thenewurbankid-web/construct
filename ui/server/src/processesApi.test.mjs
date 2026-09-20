// #292 — the Processes API and socket: the security properties first (every
// route sits behind the session gate, the socket takes the same `auth`, an id
// is looked up and never used as a path), then the behaviour (the machine, not
// the UI, decides which control is legal).
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { botBranch } from '../../../src/engine/botRunner.mjs';
import { WebSocket } from 'ws';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createProcess, recordArtifact } from '../../../src/engine/processModel.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createProcessesService } from './processesService.mjs';
import { createProcessesRouter } from './processesApi.mjs';
import { attachProcessesSocket } from './processesSocket.mjs';
import { app as realApp, auth as realAuth } from './index.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;

const touching = (file) => ({ features: ['checkout'], files: [{ path: file, change: 'create' }] });
const PLAN = {
  version: 1,
  ticket: { source: 'text', title: 'Add totals to checkout' },
  steps: [
    { id: 'feature', title: 'Create the checkout feature', flow: 'create.feature', args: { name: 'checkout' }, executor: 'deterministic', touches: touching('features/checkout/index.ts') },
    { id: 'domain', title: 'Scaffold the Total domain unit', flow: 'create.unit', args: { layer: 'domain', name: 'Total', feature: 'checkout' }, executor: 'deterministic', dependsOn: ['feature'], touches: touching('features/checkout/domain/Total.ts') },
  ],
};

/** Steps wait on a gate the test opens, so the process can be observed mid-run. */
function gates() {
  const waiting = new Map();
  const fail = new Set();
  return {
    fail,
    executeStep: ({ step, signal }) => new Promise((resolve, reject) => {
      const done = () => (fail.has(step.id) ? resolve({ ok: false, llm: null, error: 'boom' }) : resolve({ ok: true, llm: null }));
      waiting.set(step.id, done);
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    release: (id) => { const fn = waiting.get(id); waiting.delete(id); fn?.(); },
    isWaiting: (id) => waiting.has(id),
  };
}

async function until(fn, what) {
  for (let i = 0; i < 400; i += 1) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function withStack({ authOn = true } = {}, fn) {
  const projectDir = makeTempDir('construct-procapi-project-');
  const stateDir = makeTempDir('construct-procapi-state-');
  const g = gates();
  const service = createProcessesService({ getProjectDir: () => projectDir, stateDir, executeStep: g.executeStep });
  const auth = createAuth(resolveAuthConfig(authOn ? ENV : {}, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  app.use(express.json());
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/processes', createProcessesRouter(service));
  const server = http.createServer(app);
  attachProcessesSocket(server, service, '/ws/processes', ORIGIN, auth);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const seed = (id = 'p1') => service.store().save(createProcess(PLAN, { id, projectRoot: service.currentRoot() }));
  const call = (method, path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { origin: ORIGIN, ...headers } });
  try {
    await fn({ service, g, port, seed, call, authed: { cookie: cookie() } });
  } finally {
    for (const ws of server.listeners('upgrade')) void ws;
    server.close();
    server.closeAllConnections?.();
  }
}

// --- security --------------------------------------------------------------

test('every /api/processes route is refused with 401 when there is no session', async () => {
  await withStack({}, async ({ seed, call }) => {
    seed();
    for (const [method, path] of [
      ['GET', '/api/processes'], ['GET', '/api/processes/p1'], ['GET', '/api/processes/p1/diff?path=a.ts'],
      ['POST', '/api/processes/p1/pause'], ['POST', '/api/processes/p1/resume'], ['POST', '/api/processes/p1/cancel'], ['POST', '/api/processes/p1/retry'],
    ]) {
      const res = await call(method, path);
      assert.equal(res.status, 401, `${method} ${path} must need a session`);
    }
    assert.equal((await call('GET', '/api/processes', { cookie: cookie() })).status, 200);
  });
});

test('the real server registers /api/processes AFTER the session gate', () => {
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const processes = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/processes'));
  assert.ok(gate >= 0, 'the session gate is in the route table');
  assert.ok(processes > gate, 'the processes router must come after the gate');
});

async function upgrade(port, options) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/processes`, options);
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
}

test('the processes socket refuses an upgrade with no session, a forged one, or a foreign origin', async () => {
  await withStack({}, async ({ port }) => {
    assert.equal(await upgrade(port, { origin: ORIGIN }), 401);
    const forged = signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, 'x'.repeat(48));
    assert.equal(await upgrade(port, { origin: ORIGIN, headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(forged)}` } }), 401);
    assert.equal(await upgrade(port, { origin: 'http://evil.example', headers: { cookie: cookie() } }), 401);
    assert.equal(await upgrade(port, { origin: ORIGIN, headers: { cookie: cookie() } }), 'open');
  });
});

test('an id is looked up in the store, never used as a path: unknown and traversal ids are 404', async () => {
  await withStack({}, async ({ seed, call, authed }) => {
    seed();
    for (const id of ['nope', '..%2F..%2Fetc%2Fpasswd', '%2e%2e', 'p1%00', 'p1.json']) {
      const res = await call('GET', `/api/processes/${id}`, authed);
      assert.equal(res.status, 404, `GET ${id}`);
      const post = await call('POST', `/api/processes/${id}/cancel`, authed);
      assert.equal(post.status, 404, `POST ${id}/cancel`);
    }
  });
});

test('no GET changes state: a GET on a control path is not a route', async () => {
  await withStack({}, async ({ seed, call, authed, service }) => {
    seed();
    const res = await call('GET', '/api/processes/p1/cancel', authed);
    assert.equal(res.status, 404);
    assert.equal(service.store().load('p1').state, 'queued');
  });
});

test('an unknown control verb is refused, including names that exist on Object.prototype', async () => {
  await withStack({}, async ({ seed, call, authed }) => {
    seed();
    for (const verb of ['explode', 'constructor', 'toString', '__proto__']) {
      assert.equal((await call('POST', `/api/processes/p1/${verb}`, authed)).status, 400, verb);
    }
  });
});

test('the diff route only serves paths recorded on the process', async () => {
  await withStack({}, async ({ seed, call, authed }) => {
    seed();
    assert.equal((await call('GET', '/api/processes/p1/diff', authed)).status, 400);
    assert.equal((await call('GET', '/api/processes/p1/diff?path=..%2F..%2Fetc%2Fpasswd', authed)).status, 404);
  });
});

// --- the machine decides ---------------------------------------------------

test('a control the machine does not allow is refused with 409 and changes nothing', async () => {
  await withStack({}, async ({ seed, call, authed, service }) => {
    seed();
    const before = JSON.stringify(service.store().load('p1'));
    for (const verb of ['pause', 'resume', 'retry']) {
      const res = await call('POST', `/api/processes/p1/${verb}`, authed);
      assert.equal(res.status, 409, verb);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.ok(Array.isArray(body.controls), 'the refusal says what is legal');
    }
    assert.equal(JSON.stringify(service.store().load('p1')), before, 'a refused control must not touch the record');
  });
});

test('the list and detail carry the machine\'s own controls; pause, resume, cancel drive the real engine', async () => {
  await withStack({}, async ({ seed, call, authed, service, g }) => {
    seed();
    const list = await (await call('GET', '/api/processes', authed)).json();
    assert.equal(list.processes.length, 1);
    assert.deepEqual(list.processes[0].controls, ['START', 'CANCEL']);
    assert.equal(typeof list.processes[0].version, 'number', 'summaries carry a growing version so a client keeps the newest');

    service.engine().start('p1');
    await until(() => g.isWaiting('feature'), 'the first step to be in flight');
    const running = (await (await call('GET', '/api/processes/p1', authed)).json()).process;
    assert.equal(running.summary.state, 'running');
    assert.deepEqual(running.steps.map((s) => s.status), ['running', 'pending']);
    assert.ok(running.summary.controls.includes('PAUSE'));

    assert.equal((await call('POST', '/api/processes/p1/pause', authed)).status, 200);
    g.release('feature');
    await until(() => service.store().load('p1').state === 'paused', 'the process to pause');
    const paused = (await (await call('GET', '/api/processes/p1', authed)).json()).process;
    assert.deepEqual(paused.summary.controls.sort(), ['CANCEL', 'RESUME']);

    assert.equal((await call('POST', '/api/processes/p1/resume', authed)).status, 200);
    await until(() => g.isWaiting('domain'), 'the second step');
    assert.equal((await call('POST', '/api/processes/p1/cancel', authed)).status, 200);
    await until(() => service.store().load('p1').state === 'cancelled', 'the process to cancel');
    const cancelled = (await (await call('GET', '/api/processes/p1', authed)).json()).process;
    assert.equal(cancelled.summary.terminal, true);
    assert.deepEqual(cancelled.summary.controls, []);
    assert.equal((await call('POST', '/api/processes/p1/pause', authed)).status, 409);
    assert.ok(cancelled.log.some((e) => e.provenance === 'ok'));
  });
});

test('a failed process can be retried, and only then', async () => {
  await withStack({}, async ({ seed, call, authed, service, g }) => {
    seed();
    g.fail.add('feature');
    service.engine().start('p1');
    await until(() => g.isWaiting('feature'), 'the step');
    g.release('feature');
    await until(() => service.store().load('p1').state === 'failed', 'failure');
    const failed = (await (await call('GET', '/api/processes/p1', authed)).json()).process;
    assert.ok(failed.summary.controls.includes('RETRY'));
    assert.equal(failed.log.at(-1).provenance, 'warn');
    g.fail.clear();
    assert.equal((await call('POST', '/api/processes/p1/retry', authed)).status, 200);
    await until(() => g.isWaiting('feature'), 'the retried step');
    g.release('feature');
    await until(() => g.isWaiting('domain'), 'the next step');
    g.release('domain');
    await until(() => service.store().load('p1').state === 'done', 'completion');
  });
});

test('the socket streams every persisted change as an update carrying the log', async () => {
  await withStack({}, async ({ seed, port, service, g }) => {
    seed();
    const frames = [];
    const ws = new WebSocket(`ws://localhost:${port}/ws/processes`, { origin: ORIGIN, headers: { cookie: cookie() } });
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    service.engine().start('p1');
    await until(() => g.isWaiting('feature'), 'the step');
    await until(() => frames.some((f) => f.type === 'update' && f.process.summary.state === 'running'), 'a running update');
    const update = frames.filter((f) => f.type === 'update').at(-1).process;
    assert.equal(update.summary.id, 'p1');
    assert.ok(update.log.length > 0);
    ws.close();
  });
});

test('the diff of a recorded artifact is read from the bot branch, read-only', async () => {
  await withStack({}, async ({ service, call, authed }) => {
    const root = service.currentRoot();
    const vcs = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd: root, encoding: 'utf8' });
    vcs('init', '-q', '-b', 'main');
    vcs('commit', '-q', '--allow-empty', '-m', 'base');
    vcs('checkout', '-q', '-b', botBranch('p1'));
    fs.writeFileSync(`${root}/a.ts`, 'export const a = 1;\n');
    vcs('add', '.');
    vcs('commit', '-q', '-m', 'bot');
    vcs('checkout', '-q', 'main');
    const record = recordArtifact(createProcess(PLAN, { id: 'p1', projectRoot: root }), { path: 'a.ts', change: 'create', before: null, after: 'export const a = 1;\n' });
    service.store().save(record);
    const body = await (await call('GET', '/api/processes/p1/diff?path=a.ts', authed)).json();
    assert.match(body.diff, /\+export const a = 1;/);
    const view = (await (await call('GET', '/api/processes/p1', authed)).json()).process;
    assert.equal(view.artifacts[0].approved, null, 'artifacts are shown awaiting approval; nothing here applies them');
  });
});
