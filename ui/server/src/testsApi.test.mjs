// #300/#301 -- the Tests API. Security first (every route behind the session gate; only a real feature of THIS
// project; hostile names refused; a symlinked tests/ refused with nothing written outside; never overwrite;
// a clone lands only under features/<f>/tests/ and never under generated/), then behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { generateFeatureTests } from '../../../src/engine/testGenerator.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createTestsRouter } from './testsApi.mjs';
import { app as realApp, auth as realAuth } from './index.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;

const LOCK_YML = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE_YML = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];
const MACHINE = `import { setup } from 'xstate';
export const Simple = setup({}).createMachine({
  id: 'simple',
  initial: 'idle',
  states: {
    idle: { on: { START_JOB: 'working' } },
    working: { on: { finishJob: 'done', JOB_FAILED: 'failed' } },
    failed: { type: 'final' },
    done: { type: 'final' },
  },
});
`;

function project({ lock = true, generate = true } = {}) {
  const dir = makeTempDir('construct-testsapi-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE_YML + (lock ? LOCK_YML : ''));
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Simple.ts'), MACHINE);
  if (generate && lock) generateFeatureTests(dir, 'jobs');
  return dir;
}
const gen = (dir) => path.join(dir, 'features', 'jobs', 'tests', 'generated');
const tests = (dir) => path.join(dir, 'features', 'jobs', 'tests');
const firstGenerated = (dir) => fs.readdirSync(gen(dir)).sort()[0];

async function withStack({ authOn = true, dir = project() } = {}, fn) {
  const auth = createAuth(resolveAuthConfig(authOn ? ENV : {}, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  app.use(express.json());
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/tests', createTestsRouter({ clientOrigin: ORIGIN, getRoot: () => (dir ? { ok: true, root: dir } : { ok: false, error: 'No Construct project found for the current project directory. Pick a project first.' }) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, p, { body, headers = {} } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { origin: ORIGIN, cookie: cookie(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (method, p, opts) => { const r = await call(method, p, opts); return { status: r.status, body: await r.json() }; };
  try {
    await fn({ dir, call, json, port });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

// --- security --------------------------------------------------------------

test('every /api/tests route is refused with 401 when there is no session', async () => {
  await withStack({}, async ({ dir, call }) => {
    const src = firstGenerated(dir);
    for (const [method, p, body] of [
      ['GET', '/api/tests/jobs'],
      ['GET', `/api/tests/jobs/source?area=generated&name=${src}`],
      ['POST', '/api/tests/jobs/clone', { source: src, name: 'x' }],
      ['POST', '/api/tests/jobs/generate', {}],
    ]) {
      const res = await call(method, p, { body, headers: { cookie: '' } });
      assert.equal(res.status, 401, `${method} ${p} must need a session`);
    }
    assert.equal(fs.existsSync(path.join(tests(dir), 'x.spec.ts')), false);
    assert.equal((await call('GET', '/api/tests/jobs')).status, 200);
  });
});

test('the real server registers /api/tests AFTER the session gate', () => {
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const router = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/tests'));
  assert.ok(gate >= 0, 'the session gate is in the route table');
  assert.ok(router > gate, 'the tests router must come after the gate');
});

test('an unknown feature is a 404 on every route; nothing is created', async () => {
  await withStack({}, async ({ dir, json }) => {
    const src = firstGenerated(dir);
    assert.equal((await json('GET', '/api/tests/nosuch')).status, 404);
    assert.equal((await json('GET', `/api/tests/nosuch/source?area=generated&name=${src}`)).status, 404);
    assert.equal((await json('POST', '/api/tests/nosuch/clone', { body: { source: src, name: 'x' } })).status, 404);
    assert.equal((await json('POST', '/api/tests/nosuch/generate', { body: {} })).status, 404);
  });
});

test('hostile feature names are refused', async () => {
  await withStack({}, async ({ call }) => {
    for (const f of ['..', '%2e%2e', '..%2Fetc', '%2Fetc', 'a%00b', 'a%0Ab', '.git', 'x%5Cy']) {
      const r = await call('GET', `/api/tests/${f}`);
      assert.ok([400, 404].includes(r.status), `${f} -> ${r.status}`);
    }
  });
});

test('hostile clone names and sources are refused and nothing is written', async () => {
  await withStack({}, async ({ dir, json }) => {
    const src = firstGenerated(dir);
    const before = fs.readdirSync(tests(dir)).sort();
    for (const name of ['..', '../x', '/etc/passwd', 'a\0b', 'a\nb', 'a b', 'A', '', 'x.spec.ts', 'generated/x', 5, null, ['x']]) {
      const r = await json('POST', '/api/tests/jobs/clone', { body: { source: src, name } });
      assert.equal(r.status, 400, `name ${JSON.stringify(name)} -> ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.ok, false);
    }
    for (const source of ['../architecture.yml', '/etc/passwd', 'a\0', `${src}\n`, `generated/${src}`, 'x--y.spec.ts', 5, null]) {
      const r = await json('POST', '/api/tests/jobs/clone', { body: { source, name: 'fine' } });
      assert.ok([400, 404].includes(r.status), `source ${JSON.stringify(source)} -> ${r.status}`);
      assert.equal(r.body.ok, false);
    }
    assert.deepEqual(fs.readdirSync(tests(dir)).sort(), before);
    assert.equal((await json('GET', '/api/tests/jobs/source?area=generated&name=..%2F..%2Farchitecture.yml')).status, 400);
    assert.equal((await json('GET', '/api/tests/jobs/source?area=yours&name=%2Fetc%2Fpasswd')).status, 400);
    assert.equal((await json('GET', '/api/tests/jobs/source?area=nope&name=x')).status, 400);
  });
});

test('a symlinked tests/ is refused and nothing is written outside the project', async () => {
  const outside = makeTempDir('construct-testsapi-outside-');
  await withStack({}, async ({ dir, json }) => {
    const src = firstGenerated(dir);
    const real = tests(dir);
    fs.renameSync(real, `${real}-moved`);
    fs.symlinkSync(outside, real);
    const r = await json('POST', '/api/tests/jobs/clone', { body: { source: src, name: 'escape' } });
    assert.ok(r.status >= 400);
    assert.equal(r.body.ok, false);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal((await json('GET', '/api/tests/jobs')).body.ok, false);
    const g = await json('POST', '/api/tests/jobs/generate', { body: {} });
    assert.equal(g.body.ok, false);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});

test('overwriting is refused with a suggested free name; the first file is untouched', async () => {
  await withStack({}, async ({ dir, json }) => {
    const src = firstGenerated(dir);
    const a = await json('POST', '/api/tests/jobs/clone', { body: { source: src, name: 'copy' } });
    assert.equal(a.status, 200);
    const first = fs.readFileSync(path.join(tests(dir), 'copy.spec.ts'), 'utf8');
    const b = await json('POST', '/api/tests/jobs/clone', { body: { source: src, name: 'copy' } });
    assert.equal(b.status, 409);
    assert.equal(b.body.code, 'exists');
    assert.equal(b.body.suggested, 'copy-2');
    assert.equal(fs.readFileSync(path.join(tests(dir), 'copy.spec.ts'), 'utf8'), first);
  });
});

test('POST needs a JSON body and refuses a foreign Origin', async () => {
  await withStack({}, async ({ dir, call, port }) => {
    const src = firstGenerated(dir);
    const plain = await fetch(`http://127.0.0.1:${port}/api/tests/jobs/clone`, { method: 'POST', headers: { cookie: cookie(), origin: ORIGIN, 'content-type': 'text/plain' }, body: JSON.stringify({ source: src, name: 'x' }) });
    assert.equal(plain.status, 415);
    const foreign = await call('POST', '/api/tests/jobs/clone', { body: { source: src, name: 'x' }, headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    assert.equal(fs.existsSync(path.join(tests(dir), 'x.spec.ts')), false);
  });
});

// --- behaviour -------------------------------------------------------------

test('list: generated are locked, coverage has a row per scenario, a clone shows under yours', async () => {
  await withStack({}, async ({ dir, json }) => {
    const src = firstGenerated(dir);
    const before = fs.readFileSync(path.join(gen(dir), src), 'utf8');
    const c = await json('POST', '/api/tests/jobs/clone', { body: { source: src, name: 'my-own' } });
    assert.equal(c.status, 200);
    assert.equal(c.body.path, 'features/jobs/tests/my-own.spec.ts');
    const out = fs.readFileSync(path.join(tests(dir), 'my-own.spec.ts'), 'utf8');
    assert.ok(out.endsWith(`\n${before}`), 'clone bytes are the header lines plus the source');
    assert.notEqual(out, before);
    assert.equal(fs.readFileSync(path.join(gen(dir), src), 'utf8'), before, 'the generated file is unchanged');
    assert.equal(fs.readdirSync(gen(dir)).includes('my-own.spec.ts'), false, 'nothing under generated/');

    const l = await json('GET', '/api/tests/jobs');
    assert.equal(l.status, 200);
    assert.ok(l.body.generated.length >= 2 && l.body.generated.every((g) => g.locked === true));
    assert.deepEqual(l.body.yours.map((y) => y.name), ['my-own.spec.ts']);
    const row = l.body.coverage.find((r) => r.file === src);
    assert.deepEqual(row.cloned, ['my-own.spec.ts']);
    assert.equal(row.lastResult, 'none');

    const s = await json('GET', `/api/tests/jobs/source?area=generated&name=${src}`);
    assert.equal(s.status, 200);
    assert.equal(s.body.text, before);
  });
});

test('generate: writes locked tests; without the lock declared it refuses and prints the YAML', async () => {
  await withStack({ dir: project({ generate: false }) }, async ({ dir, json }) => {
    const g = await json('POST', '/api/tests/jobs/generate', { body: {} });
    assert.equal(g.status, 200);
    assert.ok(g.body.written.length >= 2);
    assert.ok(fs.readdirSync(gen(dir)).length >= 2);
    assert.equal((await json('POST', '/api/tests/jobs/generate', { body: {} })).body.written.length, 0);
  });
  await withStack({ dir: project({ lock: false }) }, async ({ dir, json }) => {
    const g = await json('POST', '/api/tests/jobs/generate', { body: {} });
    assert.equal(g.status, 400);
    assert.equal(g.body.code, 'generator-refused');
    assert.match(g.body.error, /frozen:\n {2}- features\/\*\/tests\/generated\/\*\*/);
    assert.equal(fs.existsSync(gen(dir)), false);
  });
});

test('no project directory: a plain 400', async () => {
  await withStack({ dir: null }, async ({ json }) => {
    assert.equal((await json('GET', '/api/tests/jobs')).status, 400);
  });
});
