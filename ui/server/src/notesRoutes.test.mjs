// #596 through the REAL route table (index.mjs): the notes routes sit below the session gate, answer NO_PROJECT
// until a project is open, and accept a note bigger than the app-wide 100 KB JSON limit (up to the 256 KiB cap).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const sandbox = makeTempDir('notesroutes-');
process.env.CONSTRUCT_WORKSPACE_ROOT = path.join(sandbox, 'ws');
process.env.CONSTRUCT_STATE_DIR = path.join(sandbox, 'state');
fs.mkdirSync(path.join(process.env.CONSTRUCT_WORKSPACE_ROOT, 'proj'), { recursive: true });
delete process.env.CONSTRUCT_GITHUB_CLIENT_ID;
delete process.env.CONSTRUCT_GITHUB_CLIENT_SECRET;
delete process.env.CONSTRUCT_E2E_PROJECT_DIR;

const { app } = await import('./index.mjs');

let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, url, body, headers = {}) => {
  const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test('no project open: /api/notes answers 409 NO_PROJECT for every verb', async () => {
  for (const [method, url, body] of [['GET', '/api/notes'], ['POST', '/api/notes', { title: 'x' }], ['GET', '/api/notes/a'], ['PUT', '/api/notes/a', { body: 'x' }], ['DELETE', '/api/notes/a']]) {
    const r = await call(method, url, body);
    assert.equal(r.status, 409, `${method} ${url}`);
    assert.equal(r.body.code, 'NO_PROJECT');
  }
});

test('with a project open: create, edit past the 100 KB app-wide limit, stale write, reload, delete', async () => {
  assert.equal((await call('POST', '/api/settings', { projectDir: 'proj' })).status, 200);
  const created = await call('POST', '/api/notes', { title: 'Big note', body: 'a'.repeat(150 * 1024) });
  assert.equal(created.status, 201, 'a 150 KB note is not stopped by the global 100 KB parser');
  const { id, rev } = created.body.note;
  const saved = await call('PUT', `/api/notes/${id}`, { body: 'b'.repeat(200 * 1024) }, { 'if-match': String(rev) });
  assert.equal(saved.status, 200);
  const stale = await call('PUT', `/api/notes/${id}`, { body: 'c' }, { 'if-match': String(rev) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STALE_REV');
  assert.equal(stale.body.current.body.length, 200 * 1024);
  const tooBig = await call('PUT', `/api/notes/${id}`, { body: 'd'.repeat(300 * 1024) }, { 'if-match': String(saved.body.note.rev) });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.body.code, 'TOO_LARGE');
  assert.equal((await call('GET', `/api/notes/${id}`)).body.note.body.length, 200 * 1024);
  // The rest of the API keeps the 100 KB parser.
  assert.equal((await call('POST', '/api/settings', { projectDir: 'proj', pad: 'x'.repeat(150 * 1024) })).status, 413);
  assert.equal((await call('DELETE', `/api/notes/${id}`)).status, 200);
  // Notes live outside the project.
  assert.deepEqual(fs.readdirSync(path.join(process.env.CONSTRUCT_WORKSPACE_ROOT, 'proj')), []);
});
