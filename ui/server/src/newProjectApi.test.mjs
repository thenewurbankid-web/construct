// #445 "New project" through the REAL route table (index.mjs): a name becomes an initialised, opened project in
// the workspace; every refusal (hostile name, collision, foreign Origin, no session) creates nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const sandbox = fs.realpathSync(makeTempDir('newproject-'));
process.env.CONSTRUCT_WORKSPACE_ROOT = path.join(sandbox, 'ws');
process.env.CONSTRUCT_STATE_DIR = path.join(sandbox, 'state');
fs.mkdirSync(process.env.CONSTRUCT_WORKSPACE_ROOT);
delete process.env.CONSTRUCT_GITHUB_CLIENT_ID;
delete process.env.CONSTRUCT_GITHUB_CLIENT_SECRET;
delete process.env.CONSTRUCT_E2E_PROJECT_DIR;
delete process.env.CONSTRUCT_E2E_CLONE_LOCAL_ROOT;

const { app, CLIENT_ORIGIN } = await import('./index.mjs');
const { createNewProjectRouter, planNewProject } = await import('./newProjectApi.mjs');
const { workspaceRoot } = await import('./workspace.mjs');
const { getProjectDir } = await import('./settings.mjs');

let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const post = (body, headers = {}, url = '/api/projects') => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const listing = () => fs.readdirSync(workspaceRoot()).sort();

test('a name creates an initialised project in the workspace and opens it', async () => {
  const res = await post({ name: 'my-shop' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.name, 'my-shop');
  assert.equal(body.framework, 'nextjs');
  assert.equal(body.valid, true, 'the new folder is a valid Construct project');
  assert.equal(body.projectRelative, 'my-shop');
  const dir = path.join(workspaceRoot(), 'my-shop');
  assert.equal(getProjectDir(), dir, 'it is the open project');
  for (const f of ['architecture.yml', 'AGENTS.md', 'package.json', 'app/page.tsx']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.match(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'), /framework: nextjs/);
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.projectRelative, 'my-shop');
});

test('react-spa is offered as the one alternative framework', async () => {
  const res = await post({ name: 'spa.app_2', framework: 'react-spa' });
  assert.equal(res.status, 201);
  const dir = path.join(workspaceRoot(), 'spa.app_2');
  assert.match(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8'), /framework: react-spa/);
  assert.ok(fs.existsSync(path.join(dir, 'src', 'App.tsx')));
});

test('a name that is not one plain segment is refused (400) and creates nothing', async () => {
  const before = listing();
  const bad = ['', ' ', '..', '.', '../x', 'a/b', 'a\\b', '/etc', '/tmp/x', '~', '~/x', '.hidden', 'x.', 'a..b', 'repo.git', '-rf', 'with space', 'nul\0byte', 'caf\u00e9', 'a'.repeat(200), '../../etc/passwd', 'C:\\x'];
  for (const name of bad) {
    const res = await post({ name });
    assert.equal(res.status, 400, JSON.stringify(name));
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'BAD_NAME', JSON.stringify(name));
  }
  for (const body of [{}, null, [], 'x', { name: 5 }, { name: ['a'] }, { name: null }, { name: { $ne: 1 } }]) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await post({ name: 'fine', framework: 'rails' })).status, 400);
  assert.equal((await post({ name: 'fine', framework: ['nextjs'] })).status, 400);
  assert.deepEqual(listing(), before);
  assert.ok(!fs.existsSync(path.join(sandbox, 'x')) && !fs.existsSync('/tmp/x/architecture.yml'));
});

test('the refusal says it in plain words (project name, not folder name)', async () => {
  const body = await (await post({ name: '../x' })).json();
  assert.match(body.error, /project name/i);
  assert.doesNotMatch(body.error, /folder name/i);
});

test('a name that is taken (folder, file, symlink, dangling symlink) is a plain 409 and nothing is changed', async () => {
  const ws = workspaceRoot();
  fs.mkdirSync(path.join(ws, 'taken-dir'));
  fs.writeFileSync(path.join(ws, 'taken-dir', 'keep.txt'), 'mine');
  fs.writeFileSync(path.join(ws, 'taken-file'), 'x');
  fs.symlinkSync(sandbox, path.join(ws, 'taken-link'));
  fs.symlinkSync(path.join(sandbox, 'nowhere'), path.join(ws, 'taken-dangling'));
  const before = listing();
  for (const name of ['taken-dir', 'taken-file', 'taken-link', 'taken-dangling', 'my-shop']) {
    const res = await post({ name });
    assert.equal(res.status, 409, name);
    const body = await res.json();
    assert.equal(body.code, 'EXISTS');
    assert.match(body.error, /already something called/);
  }
  assert.deepEqual(listing(), before);
  assert.deepEqual(fs.readdirSync(path.join(ws, 'taken-dir')), ['keep.txt'], 'an existing folder is never initialised into');
  assert.equal(fs.existsSync(path.join(sandbox, 'architecture.yml')), false, 'nothing was written through the symlink');
  assert.equal(fs.existsSync(path.join(sandbox, 'nowhere')), false);
});

test('two requests racing for one name: exactly one project is made', async () => {
  const [a, b] = await Promise.all([post({ name: 'race' }), post({ name: 'race' })]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
});

test('a failed init leaves nothing behind (the folder this request made is removed)', async () => {
  const bare = express();
  bare.use(express.json());
  bare.use((req, res, next) => { req.session = null; next(); });
  bare.use('/p', createNewProjectRouter({
    clientOrigin: CLIENT_ORIGIN,
    runInit: async () => ({ ok: false, error: 'disk on fire' }),
    openProject: () => { throw new Error('must not open'); },
  }));
  const s = bare.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  try {
    const before = listing();
    const res = await fetch(`http://127.0.0.1:${s.address().port}/p`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"doomed"}' });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, 'INIT_FAILED');
    assert.match(body.error, /nothing was kept/);
    assert.deepEqual(listing(), before);
  } finally {
    s.close();
  }
});

test('a foreign Origin is refused (403) and creates nothing', async () => {
  const before = listing();
  assert.equal((await post({ name: 'evil-origin' }, { origin: 'https://evil.example' })).status, 403);
  assert.deepEqual(listing(), before);
  assert.notEqual((await post({ name: 'good-origin' }, { origin: CLIENT_ORIGIN })).status, 403);
});

test('the route refuses to run when the session gate did not (401), so it cannot be mounted above it by mistake', async () => {
  const bare = express();
  bare.use(express.json());
  bare.use('/p', createNewProjectRouter({ clientOrigin: CLIENT_ORIGIN, runInit: async () => { throw new Error('must not run'); }, openProject: () => { throw new Error('must not open'); } }));
  const s = bare.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  try {
    const before = listing();
    const res = await fetch(`http://127.0.0.1:${s.address().port}/p`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"nosession"}' });
    assert.equal(res.status, 401);
    assert.deepEqual(listing(), before);
  } finally {
    s.close();
  }
});

test('planNewProject derives the path on the server and writes nothing', () => {
  const ws = workspaceRoot();
  const before = listing();
  const ok = planNewProject({ name: 'plan-only' });
  assert.deepEqual(ok, { ok: true, name: 'plan-only', framework: 'nextjs', dir: path.join(ws, 'plan-only') });
  assert.equal(planNewProject({ name: '../evil' }).ok, false);
  assert.deepEqual(listing(), before);
});

test('a workspace entry that is a symlink out is not a way out: the name cannot pass through it', async () => {
  const ws = workspaceRoot();
  fs.symlinkSync(sandbox, path.join(ws, 'escape'));
  const before = listing();
  assert.equal((await post({ name: 'escape/inner' })).status, 400);
  assert.equal((await post({ name: 'escape' })).status, 409);
  assert.deepEqual(listing(), before);
  assert.equal(fs.existsSync(path.join(sandbox, 'inner')), false);
});
