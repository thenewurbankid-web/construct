// #330 through the REAL route table (index.mjs): the routes exist below the gate, refuse a foreign Origin, and
// answer hostile input with a refusal that never reaches git. Also the connect-a-remote route.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const sandbox = fs.realpathSync(makeTempDir('cloneapi-'));
process.env.CONSTRUCT_WORKSPACE_ROOT = path.join(sandbox, 'ws');
process.env.CONSTRUCT_STATE_DIR = path.join(sandbox, 'state');
fs.mkdirSync(process.env.CONSTRUCT_WORKSPACE_ROOT);
delete process.env.CONSTRUCT_GITHUB_CLIENT_ID;
delete process.env.CONSTRUCT_GITHUB_CLIENT_SECRET;
delete process.env.CONSTRUCT_GITHUB_REPO_CLIENT_ID;
delete process.env.CONSTRUCT_GITHUB_REPO_CLIENT_SECRET;
delete process.env.CONSTRUCT_E2E_PROJECT_DIR;
delete process.env.CONSTRUCT_E2E_CLONE_LOCAL_ROOT;

const { app, CLIENT_ORIGIN } = await import('./index.mjs');
const { createRemoteRouter, createCloneRouter } = await import('./cloneApi.mjs');
const { workspaceRoot } = await import('./workspace.mjs');

let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (method, url, body, headers = {}) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('lists jobs (none yet) and 404s an unknown one', async () => {
  const list = await (await call('GET', '/api/clone')).json();
  assert.deepEqual(list, { ok: true, jobs: [] });
  assert.equal((await call('GET', '/api/clone/nope')).status, 404);
  assert.equal((await call('POST', '/api/clone/nope/cancel', {})).status, 404);
});

test('hostile URLs are refused with 4xx and create nothing in the workspace', async () => {
  const ws = workspaceRoot();
  for (const url of ['https://user:pw@github.com/o/r', '--upload-pack=touch /tmp/x', 'ext::sh -c id', 'file:///etc/passwd', 'ssh://git@github.com/o/r', 'http://github.com/o/r', 'https://evil.com/o/r', 'https://github.com/o/..', 'https://github.com/o/r?x=1']) {
    const res = await call('POST', '/api/clone', { url });
    assert.ok(res.status >= 400 && res.status < 500, `${url} -> ${res.status}`);
  }
  for (const name of ['..', '../x', 'a/b', '.hidden', 'x.']) assert.equal((await call('POST', '/api/clone', { url: 'https://github.com/o/r', name })).status, 400, name);
  for (const body of [{}, { url: 5 }, { url: ['https://github.com/o/r'] }, { url: 'https://github.com/o/r', name: 5 }, null]) assert.equal((await call('POST', '/api/clone', body)).status, 400);
  assert.deepEqual(fs.readdirSync(ws), []);
});

test('a foreign Origin is refused on every clone and remote route (GET and POST)', async () => {
  const evil = { origin: 'https://evil.example' };
  assert.equal((await call('POST', '/api/clone', { url: 'https://github.com/octocat/Hello-World' }, evil)).status, 403);
  assert.equal((await call('POST', '/api/clone/x/cancel', {}, evil)).status, 403);
  assert.equal((await call('GET', '/api/clone', undefined, evil)).status, 403);
  assert.equal((await call('POST', '/api/git/remote', { url: 'https://github.com/o/r' }, evil)).status, 403);
  assert.equal((await call('GET', '/api/git/remote', undefined, evil)).status, 403);
  assert.notEqual((await call('GET', '/api/clone', undefined, { origin: CLIENT_ORIGIN })).status, 403);
  assert.deepEqual(fs.readdirSync(workspaceRoot()), []);
});

test('the routes refuse to run when the session gate did not (401), so they cannot be mounted above it by mistake', async () => {
  const bare = express();
  bare.use(express.json());
  bare.use('/clone', createCloneRouter({ jobs: { list: () => [], get: () => null, cancel: () => ({ status: 200, body: {} }), start: async () => { throw new Error('must not start'); } }, clientOrigin: CLIENT_ORIGIN }));
  bare.use('/remote', createRemoteRouter({ getRoot: () => { throw new Error('must not run'); }, clientOrigin: CLIENT_ORIGIN }));
  const s = bare.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const b = `http://127.0.0.1:${s.address().port}`;
  try {
    for (const [m, u] of [['POST', '/clone'], ['POST', '/clone/x/cancel'], ['POST', '/remote']]) {
      const res = await fetch(`${b}${u}`, { method: m, headers: { 'content-type': 'application/json' }, body: '{"url":"https://github.com/o/r"}' });
      assert.equal(res.status, 401, `${m} ${u}`);
    }
  } finally {
    s.close();
  }
});

test('connect a remote: needs a project; validates the URL; refuses non-repos and an existing origin; adds origin', async () => {
  assert.equal((await call('POST', '/api/git/remote', { url: 'https://github.com/o/r' })).status, 409);
  assert.equal((await call('GET', '/api/git/remote')).status, 409);

  const ws = workspaceRoot();
  const proj = path.join(ws, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'architecture.yml'), 'version: 1\n');
  assert.equal((await call('POST', '/api/settings', { projectDir: proj })).status, 200);

  const st = await (await call('GET', '/api/git/remote')).json();
  assert.equal(st.repo, false);
  const notRepo = await call('POST', '/api/git/remote', { url: 'https://github.com/o/r' });
  assert.equal(notRepo.status, 409);
  assert.equal((await notRepo.json()).code, 'NOT_A_REPO');

  const g = (...a) => spawnSync('git', a, { cwd: proj, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  assert.equal(g('init', '-q').status, 0);
  for (const url of ['https://user:pw@github.com/o/r', '--upload-pack=x', 'ext::sh -c id', 'file:///etc/passwd', 'https://evil.com/o/r', 'git@github.com:o/r.git', 5]) {
    assert.equal((await call('POST', '/api/git/remote', { url })).status >= 400, true, String(url));
  }
  assert.equal(g('remote').stdout.trim(), '', 'no refused URL added a remote');

  const ok = await call('POST', '/api/git/remote', { url: 'https://github.com/octocat/Hello-World' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, repo: true, connected: true, url: 'https://github.com/octocat/Hello-World.git' });
  assert.equal(g('remote', 'get-url', 'origin').stdout.trim(), 'https://github.com/octocat/Hello-World.git');

  const again = await call('POST', '/api/git/remote', { url: 'https://github.com/other/thing' });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, 'ALREADY_CONNECTED');
  assert.equal(g('remote', 'get-url', 'origin').stdout.trim(), 'https://github.com/octocat/Hello-World.git', 'the existing origin is never overwritten');
});

// ---- #330 slice B: the token and "Pull latest" through the real route table ---------------------------------------

test('a token in the body is validated, never echoed, and a malformed body is answered with a fixed message', async () => {
  const ws = workspaceRoot();
  const before = fs.readdirSync(ws).sort();
  const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  for (const token of [`${SECRET} x`, `${SECRET}\n`, 'a'.repeat(400), 7, {}]) {
    const res = await call('POST', '/api/clone', { url: 'https://github.com/o/r', token });
    const text = await res.text();
    assert.equal(res.status, 400, text);
    assert.ok(!text.includes(SECRET), 'the refusal repeats nothing');
  }
  // a token with an address that is not allowed is refused for the address, and the token is not echoed
  const evil = await call('POST', '/api/clone', { url: 'https://evil.example/o/r', token: SECRET });
  assert.equal(evil.status, 403);
  assert.ok(!(await evil.text()).includes(SECRET));
  // invalid JSON that contains the token: fixed answer, no parser message quoting the body
  const broken = await fetch(`${base}/api/clone`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: `{"url":"https://github.com/o/r","token":"${SECRET}` });
  const brokenText = await broken.text();
  assert.equal(broken.status, 400);
  assert.ok(!brokenText.includes(SECRET) && !/Unexpected|position|stack/i.test(brokenText), brokenText);
  assert.deepEqual(fs.readdirSync(ws).sort(), before);
});

test('branch inputs are a closed set over the API too', async () => {
  for (const branch of ['--upload-pack=x', 'a b', '../x', 5]) assert.equal((await call('POST', '/api/clone', { url: 'https://github.com/o/r', branch })).status, 400, JSON.stringify(branch));
});

test('Pull latest: below the gate, Origin-checked, and hostile or foreign folders are refused', async () => {
  const evil = { origin: 'https://evil.example' };
  assert.equal((await call('POST', '/api/clone/pull', { name: 'x' }, evil)).status, 403);
  for (const body of [{}, { name: 5 }, { name: '../x' }, { name: 'a/b' }, { name: '.hidden' }, { name: '--x' }]) assert.equal((await call('POST', '/api/clone/pull', body)).status, 400, JSON.stringify(body));
  assert.equal((await call('POST', '/api/clone/pull', { name: 'nope' })).status, 404);
  const ws = workspaceRoot();
  fs.mkdirSync(path.join(ws, 'not-ours'));
  const res = await call('POST', '/api/clone/pull', { name: 'not-ours' });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'NOT_A_COCKPIT_CLONE');
  // a bare `pull` id is never mistaken for a job
  assert.equal((await call('GET', '/api/clone/pull')).status, 404);
});

// #638: with the repository-connection app not configured (the default) the feature is invisible through the real route table.
test('GitHub connection unset: status says only enabled:false, its routes 404, and useLogin is "not connected" or refused', async () => {
  const before = fs.readdirSync(workspaceRoot());
  assert.deepEqual(await (await call('GET', '/api/github/status')).json(), { ok: true, enabled: false, connected: false });
  assert.equal((await call('GET', '/api/github/repos')).status, 404);
  assert.equal((await call('POST', '/api/github/disconnect', {})).status, 404);
  assert.equal((await call('GET', '/auth/repo/start')).status, 404);
  assert.equal((await call('GET', '/auth/repo/callback?code=a&state=b')).status, 404);
  assert.equal((await call('GET', '/api/github/status', undefined, { origin: 'https://evil.example' })).status, 403);
  const login = await call('POST', '/api/clone', { url: 'https://github.com/o/r', useLogin: true });
  assert.equal(login.status, 409);
  assert.equal((await login.json()).code, 'NOT_CONNECTED');
  const both = await call('POST', '/api/clone', { url: 'https://github.com/o/r', useLogin: true, token: 'ghp_abcdefghijklmnop' });
  assert.equal(both.status, 400);
  assert.equal((await both.json()).code, 'BAD_AUTH_CHOICE');
  assert.equal((await call('POST', '/api/clone/pull', { name: 'x', useLogin: true, token: 'ghp_abcdefghijklmnop' })).status, 400);
  assert.deepEqual(fs.readdirSync(workspaceRoot()), before);
});
