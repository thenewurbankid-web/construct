// cu7: POST /api/line/new-project through the REAL route table (index.mjs): a name, a first feature and a folder of
// the workspace become a Line project that validates clean and is opened; every refusal (bad name, taken name,
// folder outside the workspace, foreign Origin) is one sentence and creates nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const sandbox = fs.realpathSync(makeTempDir('line-newproject-'));
process.env.CONSTRUCT_WORKSPACE_ROOT = path.join(sandbox, 'ws');
process.env.CONSTRUCT_STATE_DIR = path.join(sandbox, 'state');
fs.mkdirSync(process.env.CONSTRUCT_WORKSPACE_ROOT);
fs.mkdirSync(path.join(sandbox, 'outside'));
delete process.env.CONSTRUCT_GITHUB_CLIENT_ID;
delete process.env.CONSTRUCT_GITHUB_CLIENT_SECRET;
delete process.env.CONSTRUCT_E2E_PROJECT_DIR;
delete process.env.CONSTRUCT_E2E_CLONE_LOCAL_ROOT;

const { app, CLIENT_ORIGIN } = await import('./index.mjs');
const { createLineNewProjectRouter } = await import('./lineNewProjectApi.mjs');
const { workspaceRoot } = await import('./workspace.mjs');
const { getProjectDir } = await import('./settings.mjs');
const { validateLine } = await import('../../../packages/core/profiles/line/index.mjs');
const { assertNewLineProjectResult } = await import('../../../packages/engine/line/contract.mjs');
const { createMockLineOps } = await import('../../../packages/engine/line/mock.mjs');

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

const post = (body, headers = {}, url = `${base}/api/line/new-project`) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const listing = (dir = workspaceRoot()) => fs.readdirSync(dir).sort();

test('new project: a name and a first feature become a clean Line project in the workspace, opened', async () => {
  const res = await post({ parentDir: '', name: 'shop', firstFeature: 'catalog' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assertNewLineProjectResult(body);
  assert.equal(body.ok, true, body.sentence);
  const dir = path.join(workspaceRoot(), 'shop');
  assert.equal(body.dir, dir);
  assert.equal(body.project.projectRelative, 'shop');
  assert.equal(getProjectDir(), dir, 'it is the open project');
  assert.deepEqual(validateLine(dir).violations, []);
  // The open project is now Line: the Features screen's route answers for the new feature.
  const feature = await (await fetch(`${base}/api/line/feature?name=catalog`)).json();
  assert.equal(feature.name, 'catalog');
  assert.deepEqual(feature.spec.stories[0].points.map((p) => p.covered), [false]);
});

test('new project: a parent folder inside the workspace is honoured, absolute or relative', async () => {
  fs.mkdirSync(path.join(workspaceRoot(), 'clients'));
  const rel = await (await post({ parentDir: 'clients', name: 'acme', firstFeature: 'orders' })).json();
  assert.equal(rel.dir, path.join(workspaceRoot(), 'clients', 'acme'));
  const abs = await (await post({ parentDir: path.join(workspaceRoot(), 'clients'), name: 'globex', firstFeature: 'orders' })).json();
  assert.equal(abs.dir, path.join(workspaceRoot(), 'clients', 'globex'));
});

test('new project: refusals are one sentence each and create nothing', async () => {
  const before = listing();
  for (const [req, status, code] of [
    [{ parentDir: '', name: '../evil', firstFeature: 'catalog' }, 400, 'BAD_NAME'],
    [{ parentDir: '', name: 'a/b', firstFeature: 'catalog' }, 400, 'BAD_NAME'],
    [{ parentDir: '', name: 'shop', firstFeature: 'catalog' }, 409, 'NAME_TAKEN'],
    [{ parentDir: '', name: 'fresh', firstFeature: '' }, 400, 'BAD_FEATURE'],
    [{ parentDir: '../outside', name: 'fresh', firstFeature: 'catalog' }, 400, 'BAD_PARENT'],
    [{ parentDir: path.join(sandbox, 'outside'), name: 'fresh', firstFeature: 'catalog' }, 400, 'BAD_PARENT'],
    [{ parentDir: 'missing', name: 'fresh', firstFeature: 'catalog' }, 400, 'BAD_PARENT'],
  ]) {
    const res = await post(req);
    const body = await res.json();
    assert.equal(res.status, status, JSON.stringify(req));
    assert.equal(body.code, code, JSON.stringify(req));
    assert.match(body.sentence, /^\S.*[.?!]$/, JSON.stringify(req));
  }
  assert.deepEqual(listing(), before);
  assert.deepEqual(listing(path.join(sandbox, 'outside')), []);
  assert.equal(fs.existsSync(path.join(sandbox, 'evil')), false);
  const foreign = await post({ parentDir: '', name: 'fresh', firstFeature: 'catalog' }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.deepEqual(listing(), before);
});

test('new project: the router runs over the contract mock too (and needs a session)', async () => {
  const ops = createMockLineOps();
  const mini = express();
  mini.use(express.json());
  mini.use((req, _res, next) => { if (req.get('x-session')) req.session = {}; next(); });
  mini.use('/new', createLineNewProjectRouter({ clientOrigin: CLIENT_ORIGIN, getWorkspaceRoot: () => workspaceRoot(), openProject: (dir) => ({ projectDir: dir }), ops }));
  const s = mini.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  try {
    const url = `http://127.0.0.1:${s.address().port}/new`;
    assert.equal((await post({ parentDir: '', name: 'm', firstFeature: 'f' }, {}, url)).status, 401);
    const body = await (await post({ parentDir: '', name: 'm', firstFeature: 'f' }, { 'x-session': '1' }, url)).json();
    assert.equal(body.ok, true);
    assert.equal(body.project.projectDir, path.join(workspaceRoot(), 'm'));
    assert.deepEqual(Object.keys(ops.projects()), [path.join(workspaceRoot(), 'm')]);
  } finally { s.close(); }
});
