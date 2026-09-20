// #302 -- the step document's endpoints (GET/POST /api/tests/:feature/steps[/preview]). Security first: session
// gate, foreign Origin, hostile names, generated/ and symlinks, stale and unreviewed writes, hostile field values
// (refused, or written escaped and PARSED to prove it), and a file that does not round-trip. Then behaviour.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { generateFeatureTests } from '../../../src/engine/testGenerator.mjs';
import { parseToAst } from '../../../src/ast/index.mjs';
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

function project() {
  const dir = makeTempDir('construct-testsapisteps-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE_YML + LOCK_YML);
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Simple.ts'), MACHINE);
  generateFeatureTests(dir, 'jobs');
  return dir;
}
const gen = (dir) => path.join(dir, 'features', 'jobs', 'tests', 'generated');
const tests = (dir) => path.join(dir, 'features', 'jobs', 'tests');
const firstGenerated = (dir) => fs.readdirSync(gen(dir)).sort()[0];
/** What the client sends back: the document's steps minus the display-only fields. */
const send = (doc) => doc.steps.map(({ keyword, sentence, binding, ...s }) => s);

async function withClone(fn) {
  const dir = project();
  const auth = createAuth(resolveAuthConfig(ENV, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  app.use(express.json());
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/tests', createTestsRouter({ clientOrigin: ORIGIN, getRoot: () => ({ ok: true, root: dir }) }));
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
    const src = firstGenerated(dir);
    const c = await json('POST', '/api/tests/jobs/clone', { body: { source: src, name: 'mine' } });
    assert.equal(c.status, 200);
    await fn({ dir, call, json, src, name: 'mine.spec.ts' });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

test('every step route is refused with 401 without a session, and the real server mounts them after the gate', async () => {
  await withClone(async ({ call, name }) => {
    for (const [method, p, body] of [
      ['GET', `/api/tests/jobs/steps?name=${name}`],
      ['POST', '/api/tests/jobs/steps/preview', { name, baseHash: 'x', steps: [] }],
      ['POST', '/api/tests/jobs/steps', { name, baseHash: 'x', resultSha: 'x', steps: [] }],
    ]) {
      assert.equal((await call(method, p, { body, headers: { cookie: '' } })).status, 401, `${method} ${p}`);
    }
    assert.equal((await call('GET', `/api/tests/jobs/steps?name=${name}`)).status, 200);
  });
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const router = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/tests'));
  assert.ok(router > gate && gate >= 0);
});

test('the step POSTs refuse a foreign Origin and a non-JSON body; an unknown feature is a 404', async () => {
  await withClone(async ({ dir, call, json, name }) => {
    const doc = (await json('GET', `/api/tests/jobs/steps?name=${name}`)).body;
    const before = fs.readFileSync(path.join(tests(dir), name), 'utf8');
    for (const p of ['/api/tests/jobs/steps/preview', '/api/tests/jobs/steps']) {
      const foreign = await call('POST', p, { body: { name, baseHash: doc.hash, resultSha: 'x', steps: send(doc) }, headers: { origin: 'https://evil.example' } });
      assert.equal(foreign.status, 403, p);
      assert.equal((await call('POST', p, { headers: { 'content-type': 'text/plain' } })).status, 415, p);
    }
    assert.equal((await json('GET', `/api/tests/nosuch/steps?name=${name}`)).status, 404);
    assert.equal((await json('POST', '/api/tests/nosuch/steps/preview', { body: { name, baseHash: doc.hash, steps: send(doc) } })).status, 404);
    assert.equal(fs.readFileSync(path.join(tests(dir), name), 'utf8'), before);
  });
});

test('hostile names, a generated/ file, a symlinked file and a symlinked tests/ are refused', async () => {
  await withClone(async ({ dir, json, src, name }) => {
    const get = (n) => json('GET', `/api/tests/jobs/steps?name=${encodeURIComponent(n)}`);
    for (const n of [`../generated/${src}`, '/etc/passwd', 'a\0b.spec.ts', 'a\nb.spec.ts', 'a/b.spec.ts', '..', '', 'A.spec.ts']) {
      const r = await get(n);
      assert.ok([400, 404].includes(r.status), `${JSON.stringify(n)} -> ${r.status}`);
      assert.equal(r.body.ok, false);
    }
    assert.equal((await get(src)).status, 403, 'a generated test cannot be edited');
    assert.equal((await json('POST', '/api/tests/jobs/steps', { body: { name: src, baseHash: 'x', resultSha: 'x', steps: [] } })).status, 403);
    const genBefore = fs.readFileSync(path.join(gen(dir), src), 'utf8');
    const outside = path.join(makeTempDir('construct-testsapisteps-out-'), 'o.spec.ts');
    fs.copyFileSync(path.join(tests(dir), name), outside);
    fs.symlinkSync(outside, path.join(tests(dir), 'link.spec.ts'));
    assert.equal((await get('link.spec.ts')).status, 400);
    const doc = (await get(name)).body;
    const w = await json('POST', '/api/tests/jobs/steps', { body: { name: 'link.spec.ts', baseHash: doc.hash, resultSha: 'x', steps: send(doc) } });
    assert.equal(w.status, 400);
    assert.equal(fs.readFileSync(outside, 'utf8'), fs.readFileSync(path.join(tests(dir), name), 'utf8'), 'nothing was written through the link');
    assert.equal(fs.readFileSync(path.join(gen(dir), src), 'utf8'), genBefore, 'nothing under generated/ ever changes');
  });
  await withClone(async ({ dir, json, name }) => {
    const real = path.join(dir, 'features', 'jobs', 'tests-real');
    fs.renameSync(tests(dir), real);
    fs.symlinkSync(real, tests(dir));
    assert.equal((await json('GET', `/api/tests/jobs/steps?name=${name}`)).status, 400);
  });
});

test('read, preview, confirm: the file on disk is what was previewed; a stale or unreviewed write is refused', async () => {
  await withClone(async ({ dir, json, src, name }) => {
    const doc = (await json('GET', `/api/tests/jobs/steps?name=${name}`)).body;
    assert.equal(doc.editable, true);
    assert.ok(doc.machine.events.some((e) => e.event === 'START_JOB'));
    const steps = [...send(doc), { kind: 'check-text', text: 'All done', timeout: 6000 }];
    const pre = await json('POST', '/api/tests/jobs/steps/preview', { body: { name, baseHash: doc.hash, steps } });
    assert.equal(pre.status, 200, JSON.stringify(pre.body));
    assert.ok(pre.body.diff.stats.added >= 1);
    assert.equal(fs.readFileSync(path.join(tests(dir), name), 'utf8').includes('All done'), false, 'a preview writes nothing');
    assert.equal((await json('POST', '/api/tests/jobs/steps', { body: { name, baseHash: doc.hash, resultSha: 'e'.repeat(64), steps } })).status, 409, 'not the reviewed text');
    const original = fs.readFileSync(path.join(tests(dir), name), 'utf8');
    fs.writeFileSync(path.join(tests(dir), name), `${original}// touched\n`);
    const stale = await json('POST', '/api/tests/jobs/steps', { body: { name, baseHash: doc.hash, resultSha: pre.body.resultSha, steps } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'stale');
    fs.writeFileSync(path.join(tests(dir), name), original);
    const ok = await json('POST', '/api/tests/jobs/steps', { body: { name, baseHash: doc.hash, resultSha: pre.body.resultSha, steps } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(fs.readFileSync(path.join(tests(dir), name), 'utf8'), /getByText\("All done"\)/);
    assert.equal(ok.body.hash, (await json('GET', `/api/tests/jobs/steps?name=${name}`)).body.hash);
    assert.equal(fs.readFileSync(path.join(gen(dir), src), 'utf8').includes('All done'), false, 'the locked original is untouched');
    assert.equal((await json('POST', '/api/tests/jobs/steps', { body: { name, baseHash: doc.hash, resultSha: pre.body.resultSha, steps } })).status, 409, 'replaying the same write is stale');
  });
});

test('hostile step values are refused (422) or safely escaped: the written file parses and holds exactly the template statements', async () => {
  await withClone(async ({ dir, json, name }) => {
    const HOSTILE = ['"; process.exit(1); //', '`${process.exit(1)}`', '*/ evil(); /*', "'; evil(); '", 'line\nbreak', 'ls ps', 'ps x', '\\', 'nul\0', 'x'.repeat(500)];
    for (const v of HOSTILE) {
      const doc = (await json('GET', `/api/tests/jobs/steps?name=${name}`)).body;
      const base = send(doc);
      for (const bad of [{ kind: 'event', event: v }, { kind: 'state', state: v }]) {
        const r = await json('POST', '/api/tests/jobs/steps/preview', { body: { name, baseHash: doc.hash, steps: [...base, bad] } });
        assert.equal(r.status, 422, `${JSON.stringify(bad).slice(0, 60)} -> ${r.status}`);
      }
      const url = await json('POST', '/api/tests/jobs/steps/preview', { body: { name, baseHash: doc.hash, steps: base.map((s) => (s.kind === 'goto' ? { kind: 'goto', url: v } : s)) } });
      assert.equal(url.status, 422, `url ${JSON.stringify(v).slice(0, 40)}`);
      for (const field of ['text', 'note']) {
        const step = field === 'text' ? { kind: 'check-text', text: v, timeout: 5000 } : { kind: 'check-text', text: 'ok', timeout: 5000, note: v };
        const steps = [...base, step];
        const pre = await json('POST', '/api/tests/jobs/steps/preview', { body: { name, baseHash: doc.hash, steps } });
        if (pre.status !== 200) { assert.equal(pre.status, 422); continue; }
        const done = await json('POST', '/api/tests/jobs/steps', { body: { name, baseHash: doc.hash, resultSha: pre.body.resultSha, steps } });
        assert.equal(done.status, 200);
        const ast = parseToAst(fs.readFileSync(path.join(tests(dir), name), 'utf8'));
        const body = ast.body[ast.body.length - 1].expression.arguments[1].body.body;
        assert.equal(body.length, steps.length + 1, `exactly the template statements for ${field} ${JSON.stringify(v).slice(0, 30)}`);
        const back = (await json('GET', `/api/tests/jobs/steps?name=${name}`)).body;
        assert.equal(back.editable, true);
        assert.equal(back.steps.at(-1).text, field === 'text' ? v : 'ok');
        const cleaned = send(back).slice(0, -1);
        const p2 = await json('POST', '/api/tests/jobs/steps/preview', { body: { name, baseHash: back.hash, steps: cleaned } });
        await json('POST', '/api/tests/jobs/steps', { body: { name, baseHash: back.hash, resultSha: p2.body.resultSha, steps: cleaned } });
      }
    }
  });
});

test('a file that does not round-trip is shown read-only with the reason and every edit of it is refused', async () => {
  await withClone(async ({ dir, json, name }) => {
    const good = fs.readFileSync(path.join(tests(dir), name), 'utf8');
    const odd = good.replace('await page.goto(START_URL);', 'await page.goto(START_URL);\n  await page.waitForTimeout(500);');
    fs.writeFileSync(path.join(tests(dir), 'odd.spec.ts'), odd);
    const doc = await json('GET', '/api/tests/jobs/steps?name=odd.spec.ts');
    assert.equal(doc.status, 200);
    assert.equal(doc.body.editable, false);
    assert.match(doc.body.reason, /line \d+/);
    assert.equal(doc.body.steps, undefined);
    for (const p of ['/api/tests/jobs/steps/preview', '/api/tests/jobs/steps']) {
      const r = await json('POST', p, { body: { name: 'odd.spec.ts', baseHash: doc.body.hash, resultSha: 'x', steps: [{ kind: 'goto', url: '/x' }] } });
      assert.equal(r.status, 422, p);
      assert.equal(r.body.code, 'not-editable');
    }
    assert.equal(fs.readFileSync(path.join(tests(dir), 'odd.spec.ts'), 'utf8'), odd, 'not corrupted');
  });
});
