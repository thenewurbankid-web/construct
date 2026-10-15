// t5-3: GET /api/line/english?file= answers the fluent English view of a project file beside its code, from the same
// module as `construct english` (packages/line-fluent/cli/english.mjs), below the session gate; every failure is one
// sentence.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createLineRouter } from './lineApi.mjs';
import { englishView } from '../../../packages/line-fluent/cli/english.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;

const SOURCE = 'export function add(a, b) {\n  return a + b;\n}\n\nconst double = (x) => x * 2;\n';

function project() {
  const root = makeTempDir('t5-3-english-');
  fs.mkdirSync(path.join(root, 'features/orders'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features/orders/math.ts'), SOURCE);
  fs.writeFileSync(path.join(root, 'features/orders/broken.ts'), 'function oops( {\n');
  return fs.realpathSync(root);
}

async function withStack(getRoot, fn) {
  const auth = createAuth(resolveAuthConfig(ENV, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/line', createLineRouter({ getRoot }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const get = async (p, withCookie = true) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { headers: { origin: ORIGIN, ...(withCookie ? { cookie: cookie() } : {}) } });
    return { status: r.status, body: await r.json() };
  };
  try { await fn(get); } finally { server.close(); server.closeAllConnections?.(); }
}

const q = (file) => `/api/line/english?file=${encodeURIComponent(file)}`;

test('GET /api/line/english needs a session (401 without one)', async () => {
  const root = project();
  await withStack(() => ({ ok: true, root }), async (get) => {
    assert.equal((await get(q('features/orders/math.ts'), false)).status, 401);
  });
});

test('answers each top-level function: the CLI\'s English plus its code and line', async () => {
  const root = project();
  await withStack(() => ({ ok: true, root }), async (get) => {
    const { status, body } = await get(q('features/orders/math.ts'));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.file, 'features/orders/math.ts');
    // The same sentences `construct english` prints: one module, no duplicated logic.
    assert.deepEqual(body.functions.map(({ name, line, english }) => ({ name, line, english })), englishView(SOURCE));
    assert.equal(body.functions[0].english, 'add using a and b: return a + b.');
    assert.equal(body.functions[0].code, 'function add(a, b) {\n  return a + b;\n}');
    assert.equal(body.functions[1].code, 'const double = (x) => x * 2;');
  });
});

test('refusals are one sentence: bad request, missing file, outside the project, parse error, no project', async () => {
  const root = project();
  await withStack(() => ({ ok: true, root }), async (get) => {
    for (const file of ['', '/etc/passwd', 'features/orders/notes.md']) {
      const r = await get(q(file));
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'BAD_REQUEST');
    }
    const missing = await get(q('features/orders/nope.ts'));
    assert.deepEqual([missing.status, missing.body.code, missing.body.sentence], [400, 'UNKNOWN_ITEM', 'There is no file features/orders/nope.ts in this project.']);
    const outside = await get(q('../../etc/hosts.js'));
    assert.deepEqual([outside.status, outside.body.code], [400, 'UNKNOWN_ITEM']);
    const broken = await get(q('features/orders/broken.ts'));
    assert.equal(broken.status, 400);
    assert.equal(broken.body.code, 'PARSE_FAILED');
    assert.match(broken.body.sentence, /^Cockpit cannot read features\/orders\/broken\.ts as code at line \d+\.$/);
  });
  await withStack(() => ({ ok: false, error: 'Pick a project first.' }), async (get) => {
    const r = await get(q('features/orders/math.ts'));
    assert.deepEqual([r.status, r.body.code, r.body.sentence], [400, 'NO_PROJECT', 'Pick a project first.']);
  });
});
