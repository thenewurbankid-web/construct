// #596 -- the Notes API. Security first (session gate, foreign Origin, JSON only, size), then the contract the
// Cockpit relies on: If-Match rev, 409 with the current copy, read-only after Run, persistence across a
// "restart" (a second router over the same state directory), and no project / outside-workspace answers.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createNotesRouter, revFromHeader, summarize } from './notesApi.mjs';
import { openNotesStore, MAX_NOTE_BODY_BYTES } from './notesStore.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;

async function withStack({ project = makeTempDir('construct-notesapi-project-'), stateDir = makeTempDir('construct-notesapi-state-'), open = true } = {}, fn) {
  const auth = createAuth(resolveAuthConfig(ENV, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  // Same shape as index.mjs: the app-wide parser is NOT applied to /api/notes (the router brings its own).
  const jsonBody = express.json();
  app.use((req, res, next) => (req.path.startsWith('/api/notes') ? next() : jsonBody(req, res, next)));
  app.use('/api/notes', createNotesRouter({ clientOrigin: ORIGIN, stateDir, getRoot: () => (open ? { ok: true, root: project } : { ok: false, status: 409, body: { ok: false, code: 'NO_PROJECT' } }) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, p, { body, headers = {}, raw } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { origin: ORIGIN, cookie: cookie(), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (method, p, opts) => { const r = await call(method, p, opts); return { status: r.status, body: await r.json() }; };
  try {
    await fn({ project, stateDir, call, json });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

const create = async (json, note = { title: 'Add login', body: 'Sign in with GitHub.' }) => (await json('POST', '/api/notes', { body: note })).body.note;
const put = (json, id, rev, body, headers = {}) => json('PUT', `/api/notes/${id}`, { body, headers: { 'if-match': String(rev), ...headers } });

test('every /api/notes route is refused with 401 when there is no session', async () => {
  await withStack({}, async ({ call }) => {
    for (const [method, p, body] of [['GET', '/api/notes'], ['POST', '/api/notes', { title: 'x' }], ['GET', '/api/notes/a'], ['PUT', '/api/notes/a', { body: 'x' }], ['DELETE', '/api/notes/a'], ['POST', '/api/notes/a/duplicate', {}]]) {
      assert.equal((await call(method, p, { body, headers: { cookie: '' } })).status, 401, `${method} ${p}`);
    }
  });
});

test('a mutating request from a foreign Origin is refused (403), a non-JSON body is 415, and nothing is written', async () => {
  await withStack({}, async ({ call, json }) => {
    for (const [method, p] of [['POST', '/api/notes'], ['PUT', '/api/notes/a'], ['DELETE', '/api/notes/a'], ['POST', '/api/notes/a/duplicate']]) {
      assert.equal((await call(method, p, { body: { title: 'x' }, headers: { origin: 'http://evil.example' } })).status, 403, `${method} ${p}`);
    }
    assert.equal((await call('POST', '/api/notes', { raw: 'title=x', headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.deepEqual((await json('GET', '/api/notes')).body.notes, []);
  });
});

test('no project open: 409 NO_PROJECT from the router\'s getRoot (index.mjs mounts the same answer)', async () => {
  await withStack({ open: false }, async ({ json }) => {
    for (const [method, p] of [['GET', '/api/notes'], ['POST', '/api/notes'], ['GET', '/api/notes/a']]) {
      const r = await json(method, p, { body: method === 'POST' ? { title: 'x' } : undefined });
      assert.equal(r.status, 409, `${method} ${p}`);
      assert.equal(r.body.code, 'NO_PROJECT');
    }
  });
});

test('create, list (summaries only), get, and the note lives in the state dir keyed by project, not in the project', async () => {
  await withStack({}, async ({ json, project, stateDir }) => {
    const empty = await json('GET', '/api/notes');
    assert.deepEqual(empty.body, { ok: true, notes: [], unreadable: 0 });
    const c = await json('POST', '/api/notes', { body: { title: 'Add login', body: 'Sign in with GitHub.' } });
    assert.equal(c.status, 201);
    assert.equal(c.body.note.rev, 1);
    assert.equal(c.body.note.status, 'draft');
    const list = (await json('GET', '/api/notes')).body;
    assert.equal(list.notes.length, 1);
    assert.equal(list.notes[0].preview, 'Sign in with GitHub.');
    assert.equal('body' in list.notes[0], false, 'the list never carries the note text');
    assert.equal((await json('GET', `/api/notes/${c.body.note.id}`)).body.note.body, 'Sign in with GitHub.');
    assert.equal(openNotesStore(project, { stateDir }).list().notes.length, 1, 'same store the routes wrote to');
    assert.equal((await json('GET', '/api/notes/nope')).status, 404);
  });
});

test('PUT: If-Match rev saves and bumps; the same rev again is 409 STALE_REV carrying the current copy; a missing rev is 400', async () => {
  await withStack({}, async ({ json }) => {
    const n = await create(json);
    const saved = await put(json, n.id, n.rev, { body: 'from tab A' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.note.rev, 2);
    const stale = await put(json, n.id, n.rev, { body: 'from tab B' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'STALE_REV');
    assert.equal(stale.body.current.body, 'from tab A');
    assert.equal(stale.body.current.rev, 2);
    assert.equal((await json('GET', `/api/notes/${n.id}`)).body.note.body, 'from tab A', 'the stale write did not land');
    const none = await json('PUT', `/api/notes/${n.id}`, { body: { body: 'x' } });
    assert.equal(none.status, 400);
    assert.equal(none.body.code, 'REV_REQUIRED');
    // rev in the body is accepted too, and a quoted / weak ETag-style If-Match parses.
    assert.equal((await json('PUT', `/api/notes/${n.id}`, { body: { body: 'via body', rev: 2 } })).status, 200);
    assert.equal((await put(json, n.id, '"3"', { body: 'quoted' })).status, 200);
    assert.equal((await put(json, n.id, 'W/"4"', { body: 'weak' })).status, 200);
  });
});

test('a note survives a restart: a second router over the same state dir returns what the first wrote', async () => {
  const project = makeTempDir('construct-notesapi-project-');
  const stateDir = makeTempDir('construct-notesapi-state-');
  let id;
  await withStack({ project, stateDir }, async ({ json }) => {
    const n = await create(json, { title: 'Keep me', body: 'across restarts' });
    id = n.id;
    await put(json, n.id, n.rev, { body: 'edited before restart' });
  });
  await withStack({ project, stateDir }, async ({ json }) => {
    assert.equal((await json('GET', `/api/notes/${id}`)).body.note.body, 'edited before restart');
    assert.equal((await json('GET', '/api/notes')).body.notes[0].title, 'Keep me');
  });
  await withStack({ project: makeTempDir('construct-notesapi-project-'), stateDir }, async ({ json }) => {
    assert.deepEqual((await json('GET', '/api/notes')).body.notes, [], 'another project does not see them');
  });
});

test('size: a note over 256 KiB is 413 TOO_LARGE on create and PUT; one at the cap saves (bigger than the app-wide 100 KB parser)', async () => {
  await withStack({}, async ({ json }) => {
    const over = 'x'.repeat(MAX_NOTE_BODY_BYTES + 1);
    const r = await json('POST', '/api/notes', { body: { title: 'big', body: over } });
    assert.equal(r.status, 413);
    assert.equal(r.body.code, 'TOO_LARGE');
    const n = await create(json);
    assert.equal((await put(json, n.id, n.rev, { body: over })).status, 413);
    const atCap = await put(json, n.id, n.rev, { body: 'y'.repeat(MAX_NOTE_BODY_BYTES) });
    assert.equal(atCap.status, 200, 'the note cap, not the 100 KB JSON default, decides');
    const huge = await json('POST', '/api/notes', { raw: JSON.stringify({ body: 'z'.repeat(2 * 1024 * 1024) }) });
    assert.equal(huge.status, 413);
    assert.equal(huge.body.code, 'TOO_LARGE');
    assert.equal((await json('POST', '/api/notes', { raw: '{"body": ' })).status, 400);
  });
});

test('field validation: wrong types and unknown or client-forbidden statuses are refused; ran/processId are not client-settable', async () => {
  await withStack({}, async ({ json }) => {
    assert.equal((await json('POST', '/api/notes', { body: { title: 5 } })).status, 400);
    assert.equal((await json('POST', '/api/notes', { body: { status: 'ran' } })).status, 400);
    const n = await create(json);
    assert.equal((await put(json, n.id, n.rev, { body: ['x'] })).body.code, 'BAD_FIELD');
    assert.equal((await put(json, n.id, n.rev, { status: 'bogus' })).body.code, 'INVALID_STATUS');
    assert.equal((await put(json, n.id, n.rev, { status: 'ran' })).body.code, 'STATUS_NOT_SETTABLE');
    const r = await put(json, n.id, n.rev, { title: 'ok', processId: 'p1' });
    assert.equal(r.body.note.processId, null, 'processId in a PUT body is ignored');
    assert.equal((await put(json, n.id, r.body.note.rev, { plan: 'nope' })).body.code, 'BAD_FIELD');
  });
});

test('plan freshness through the API, and a note that ran is read-only history that can be duplicated', async () => {
  await withStack({}, async ({ json, project, stateDir }) => {
    const n = await create(json);
    const planned = (await put(json, n.id, n.rev, { plan: { steps: [{ id: 'a' }] }, status: 'plan-ready' })).body.note;
    assert.equal(planned.planStale, false);
    const edited = (await put(json, n.id, planned.rev, { body: 'changed my mind' })).body.note;
    assert.equal(edited.planStale, true);
    assert.equal((await json('GET', '/api/notes')).body.notes[0].planStale, true);

    // Run (a later slice) is what marks a note ran; simulate it through the store.
    const store = openNotesStore(project, { stateDir });
    const ran = store.update(n.id, { rev: edited.rev, status: 'ran', processId: 'p-1' });
    const ro = await put(json, n.id, ran.rev, { body: 'nope' });
    assert.equal(ro.status, 409);
    assert.equal(ro.body.code, 'NOTE_RAN');
    const dup = await json('POST', `/api/notes/${n.id}/duplicate`, { body: {} });
    assert.equal(dup.status, 201);
    assert.equal(dup.body.note.status, 'draft');
    assert.equal(dup.body.note.body, 'changed my mind');
    assert.equal(dup.body.note.plan, null);
    assert.equal((await json('POST', '/api/notes/nope/duplicate', { body: {} })).status, 404);
  });
});

test('delete removes the note; a second delete is 404', async () => {
  await withStack({}, async ({ json }) => {
    const n = await create(json);
    assert.equal((await json('DELETE', `/api/notes/${n.id}`)).status, 200);
    assert.equal((await json('GET', `/api/notes/${n.id}`)).status, 404);
    assert.equal((await json('DELETE', `/api/notes/${n.id}`)).status, 404);
  });
});

test('path-like ids never leave the notes folder (the store sanitises them)', async () => {
  await withStack({}, async ({ json }) => {
    for (const id of ['..%2F..%2Fetc%2Fpasswd', 'a%2Fb', 'a%00b']) {
      const r = await json('GET', `/api/notes/${id}`);
      assert.ok([404, 400].includes(r.status), `${id} -> ${r.status}`);
    }
  });
});

test('helpers: revFromHeader and summarize', () => {
  assert.equal(revFromHeader('3'), 3);
  assert.equal(revFromHeader('"3"'), 3);
  assert.equal(revFromHeader('W/"12"'), 12);
  assert.equal(revFromHeader('abc'), undefined);
  assert.equal(revFromHeader(undefined), undefined);
  const s = summarize({ id: 'a', title: 't', body: 'x'.repeat(300), status: 'draft', rev: 1, plan: null, createdAt: 'c', updatedAt: 'u' });
  assert.equal(s.preview.length, 143);
  assert.equal(s.hasPlan, false);
});
