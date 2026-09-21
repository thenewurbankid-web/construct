// #365 through the REAL route table: no project at start, one consistent 409 NO_PROJECT, and every route that
// takes a path refuses one outside the workspace. (workspace.test.mjs covers the containment rules themselves.)

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

// A NARROW workspace inside a temp dir, with an `outside` sibling, so containment is really exercised.
const sandbox = makeTempDir('wsapi-');
process.env.CONSTRUCT_WORKSPACE_ROOT = path.join(sandbox, 'ws');
process.env.CONSTRUCT_STATE_DIR = path.join(sandbox, 'state');
fs.mkdirSync(process.env.CONSTRUCT_WORKSPACE_ROOT);
delete process.env.CONSTRUCT_GITHUB_CLIENT_ID;
delete process.env.CONSTRUCT_GITHUB_CLIENT_SECRET;
delete process.env.CONSTRUCT_E2E_PROJECT_DIR;

const { app } = await import('./index.mjs');
const { workspaceRoot } = await import('./workspace.mjs');

let base;
let server;
let outside;
let ws;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ws = workspaceRoot();
  outside = path.join(sandbox, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(ws, 'proj'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(ws, 'escape'));
});
import { after } from 'node:test';
after(() => server.close());

const json = (method, url, body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('fresh server: settings say no project, and the workspace is reported', async () => {
  const s = await (await json('GET', '/api/settings')).json();
  assert.equal(s.projectDir, null);
  assert.equal(s.noProject, true);
  assert.equal(s.valid, false);
  assert.equal(s.workspaceRoot, workspaceRoot());
});

test('every project route answers a consistent 409 NO_PROJECT with nothing open (never a crash, never cwd)', async () => {
  const gets = ['/api/pages/features', '/api/pages?feature=x', '/api/pages/tree?feature=x&file=y', '/api/pages/source?feature=x&file=y', '/api/workflows/features',
    '/api/units', '/api/features', '/api/flow/x', '/api/nav/file?feature=x&path=y', '/api/validate', '/api/git/session', '/api/processes', '/api/review/branches', '/api/tests/x'];
  for (const url of gets) {
    const r = await json('GET', url);
    assert.equal(r.status, 409, url);
    assert.equal((await r.json()).code, 'NO_PROJECT', url);
  }
  const posts = [['/api/init', {}], ['/api/create', { kind: 'feature', name: 'x' }], ['/api/refactor', {}], ['/api/research', { action: 'doctor' }],
    ['/api/import', { mode: 'plan', planPath: 'x' }], ['/api/pages/save', {}], ['/api/workflows/edit', {}], ['/api/git/commit', {}], ['/api/plan', {}], ['/api/review/jobs', {}]];
  for (const [url, body] of posts) {
    const r = await json('POST', url, body);
    assert.equal(r.status, 409, url);
    assert.equal((await r.json()).code, 'NO_PROJECT', url);
  }
});

test('routes that do not need a project still work with none open', async () => {
  assert.equal((await json('GET', '/api/health')).status, 200);
  assert.equal((await json('GET', '/api/help')).status, 200);
  assert.equal((await json('GET', '/api/fs/browse')).status, 200);
});

test('#423 /api/health: ok first, then git/node/workspace/state-dir states with thresholds, and no path leaves the server', async () => {
  const res = await json('GET', '/api/health');
  assert.equal(res.status, 200);
  const h = await res.json();
  assert.equal(Object.keys(h)[0], 'ok');
  assert.equal(h.ok, true);
  assert.equal(typeof h.degraded, 'boolean');
  assert.equal(h.node, process.version);
  assert.equal(h.git.ok, true);
  assert.match(h.git.version, /^\d+\.\d+\.\d+$/);
  assert.equal(h.git.minimum, '2.37.0');
  assert.equal(h.git.cloneEnabled, true);
  assert.equal(h.workspace.writable, true);
  assert.equal(typeof h.workspace.freeBytes, 'number');
  assert.equal(typeof h.workspace.low, 'boolean');
  assert.equal(h.stateDir.writable, true);
  assert.equal(typeof h.stateDir.freeBytes, 'number');
  assert.equal(typeof h.thresholds.minFreeBytes, 'number');
  assert.ok(Array.isArray(h.warnings));
  const text = JSON.stringify(h);
  assert.equal(text.includes(ws), false, 'the workspace path is not in the public document');
  assert.equal(text.includes(process.env.CONSTRUCT_STATE_DIR), false, 'the state dir path is not in the public document');
});

test('settings: a project outside the workspace is refused with 403/404 and a code, and nothing opens', async () => {
  for (const projectDir of ['/', '/etc', outside, path.join(ws, '..'), path.join(ws, 'escape'), 'escape', '../x', 'x\0y']) {
    const r = await json('POST', '/api/settings', { projectDir });
    assert.ok([400, 403, 404].includes(r.status), `${JSON.stringify(projectDir)} -> ${r.status}`);
    assert.ok((await r.json()).code, 'has a stable code');
  }
  const s = await (await json('GET', '/api/settings')).json();
  assert.equal(s.projectDir, null, 'no refused choice opened anything');
});

test('settings: browseRoots cannot be set', async () => {
  const r = await json('POST', '/api/settings', { browseRoots: ['/'] });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'BROWSE_ROOTS_FIXED');
});

test('fs/browse: `..`, absolute paths and symlinks out are 403; the listing never has a parent above the workspace', async () => {
  for (const p of ['..', '../..', '/', '/etc', outside, `${workspaceRoot()}/..`, path.join(ws, 'escape'), 'escape']) {
    const r = await json('GET', `/api/fs/browse?path=${encodeURIComponent(p)}`);
    assert.equal(r.status, 403, p);
  }
  const top = await (await json('GET', '/api/fs/browse')).json();
  assert.equal(top.path, workspaceRoot());
  assert.equal(top.parent, null);
  assert.deepEqual(top.roots, [workspaceRoot()]);
});

test('opening a project inside the workspace works, and the routes then run against it', async () => {
  const rel = path.relative(workspaceRoot(), path.join(ws, 'proj'));
  const opened = await (await json('POST', '/api/settings', { projectDir: rel })).json();
  assert.equal(opened.projectDir, path.join(ws, 'proj'), 'a workspace-relative path is accepted');
  assert.equal(opened.needsInit, true);
  assert.equal(opened.noProject, false);
  const units = await json('GET', '/api/units');
  assert.notEqual(units.status, 409, 'no longer NO_PROJECT');
});

test('import: `from` and `planPath` outside the workspace are refused before anything is read', async () => {
  for (const body of [
    { mode: 'unit', name: 'a', feature: 'f', layers: ['domain'], from: path.join(outside, 'secret.txt') },
    { mode: 'unit', name: 'a', feature: 'f', layers: ['domain'], from: '/etc/passwd' },
    { mode: 'unit', name: 'a', feature: 'f', layers: ['domain'], from: '../../../../etc/passwd' },
    { mode: 'unit', name: 'a', feature: 'f', layers: ['domain'], from: path.join(ws, 'escape', 'secret.txt') },
    { mode: 'plan', planPath: '/etc/passwd' },
    { mode: 'plan', planPath: path.join(ws, 'escape', 'secret.txt') },
  ]) {
    const r = await json('POST', '/api/import', body);
    assert.equal(r.status, 403, JSON.stringify(body));
    assert.equal((await r.json()).code, 'OUTSIDE_WORKSPACE');
  }
});

test('close: closeProject returns to the no-project state and the guard applies again', async () => {
  const closed = await (await json('POST', '/api/settings', { closeProject: true })).json();
  assert.equal(closed.projectDir, null);
  assert.equal(closed.lastProject, path.join(ws, 'proj'));
  assert.equal((await json('GET', '/api/units')).status, 409);
});

test('an architecture.yml found only ABOVE the workspace is not used: 409 PROJECT_ROOT_OUTSIDE_WORKSPACE, and init stays possible', async () => {
  fs.writeFileSync(path.join(sandbox, 'architecture.yml'), 'version: 1\n'); // the sandbox is the PARENT of the workspace
  fs.mkdirSync(path.join(ws, 'proj2'));
  const opened = await (await json('POST', '/api/settings', { projectDir: 'proj2' })).json();
  assert.equal(opened.valid, false, 'the outside root does not make it a valid project');
  assert.equal(opened.needsInit, true);
  assert.equal(opened.resolvedProjectRoot, null);
  const units = await json('GET', '/api/units');
  assert.equal(units.status, 409);
  assert.equal((await units.json()).code, 'PROJECT_ROOT_OUTSIDE_WORKSPACE');
  const create = await json('POST', '/api/create', { kind: 'feature', name: 'x' });
  assert.equal(create.status, 409, 'commands do not climb out to the outside project either');
  const init = await json('POST', '/api/init', {});
  assert.notEqual((await init.json()).code, 'PROJECT_ROOT_OUTSIDE_WORKSPACE', 'init is the way out');
  await json('POST', '/api/settings', { closeProject: true });
});
