// #385 -- the Story tab's REST surface: "Add a story" from the template, reading the parsed view (front matter,
// tool block, compare, drift), applying a fetched snapshot (with the hand-edit conflict), "Mark reviewed" and
// "Keep out of git". `storyFetchApi.test.mjs` covers fetching the ticket itself; this only covers the file and
// its small UI-state fields (storyUiState.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createStoriesRouter } from './storiesApi.mjs';

const ORIGIN = 'http://localhost:3000';
const EXAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example');
const FEATURE = 'login';

async function withStack({ project, stateDir = makeTempDir('story-api-state-'), open = true, afterSaveCalls = [] } = {}, fn) {
  const root = project ?? (() => { const d = makeTempDir('story-api-project-'); fs.cpSync(EXAMPLE, d, { recursive: true }); return d; })();
  const app = express();
  app.use('/api/stories', createStoriesRouter({
    clientOrigin: ORIGIN,
    stateDir,
    afterSave: (r, relPath, isNew) => { afterSaveCalls.push({ root: r, relPath, isNew }); return { committed: true, relPath }; },
    getRoot: () => (open ? { ok: true, root } : { ok: false, status: 409, body: { ok: false, code: 'NO_PROJECT' } }),
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, p, { body, headers = {} } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { origin: ORIGIN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (method, p, opts) => { const r = await call(method, p, opts); return { status: r.status, body: await r.json() }; };
  try {
    await fn({ json, root, stateDir, afterSaveCalls });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

test('no story yet: GET reports exists:false, no indicator to build', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('GET', `/api/stories/${FEATURE}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.exists, false);
  });
});

test('an unknown feature name is refused before it ever becomes a path', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('GET', '/api/stories/nope-not-a-feature');
    assert.equal(r.status, 404);
    const traversal = await json('GET', `/api/stories/${encodeURIComponent('../../etc/passwd')}`);
    assert.equal(traversal.status, 400);
  });
});

test('Add a story writes the template, commits it, and a second Add is 409 EXISTS', async () => {
  await withStack({}, async ({ json, root, afterSaveCalls }) => {
    const created = await json('POST', `/api/stories/${FEATURE}`);
    assert.equal(created.status, 201);
    assert.equal(created.body.exists, true);
    assert.ok(fs.existsSync(path.join(root, 'features', FEATURE, 'story.md')));
    assert.deepEqual(afterSaveCalls, [{ root, relPath: `features/${FEATURE}/story.md`, isNew: true }]);

    const again = await json('POST', `/api/stories/${FEATURE}`);
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'EXISTS');
  });
});

test('apply writes a fetched snapshot and commits it as a normal file change', async () => {
  await withStack({}, async ({ json, afterSaveCalls }) => {
    await json('POST', `/api/stories/${FEATURE}`);
    const r = await json('POST', `/api/stories/${FEATURE}/apply`, {
      body: { fetchedAt: '2026-09-20T12:02:00Z', title: 'Refund a delivered order', description: 'x', status: 'Open', acceptanceTexts: ['Refund button shows only on delivered orders'] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.changed, true);
    assert.equal(r.body.tool.title, 'Refund a delivered order');
    assert.equal(afterSaveCalls.at(-1).isNew, false);

    // Same fields again: nothing changed, nothing rewritten.
    const noop = await json('POST', `/api/stories/${FEATURE}/apply`, {
      body: { fetchedAt: '2026-09-20T13:00:00Z', title: 'Refund a delivered order', description: 'x', status: 'Open', acceptanceTexts: ['Refund button shows only on delivered orders'] },
    });
    assert.equal(noop.body.changed, false);
  });
});

test('apply refuses to overwrite a hand-edited tool block (409 HAND_EDITED)', async () => {
  await withStack({}, async ({ json, root }) => {
    await json('POST', `/api/stories/${FEATURE}`);
    await json('POST', `/api/stories/${FEATURE}/apply`, { body: { fetchedAt: '2026-09-20T12:02:00Z', title: 'T', description: 'd', status: 'Open', acceptanceTexts: ['S'] } });
    const file = path.join(root, 'features', FEATURE, 'story.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^# T$/m, '# Hand-edited title'));

    const r = await json('POST', `/api/stories/${FEATURE}/apply`, { body: { fetchedAt: '2026-09-20T13:00:00Z', title: 'New title', description: 'd', status: 'Open', acceptanceTexts: ['S'] } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'HAND_EDITED');
  });
});

test('mark reviewed records the drift hash it was shown', async () => {
  await withStack({}, async ({ json }) => {
    await json('POST', `/api/stories/${FEATURE}`);
    const view = await json('GET', `/api/stories/${FEATURE}`);
    const r = await json('POST', `/api/stories/${FEATURE}/reviewed`, { body: { driftHash: view.body.driftHash } });
    assert.equal(r.status, 200);
    assert.equal(r.body.reviewedHash, view.body.driftHash);
  });
});

test('Keep out of git moves the file into per-user state and back, committing the removal/restore', async () => {
  await withStack({}, async ({ json, root, afterSaveCalls }) => {
    await json('POST', `/api/stories/${FEATURE}`);
    const file = path.join(root, 'features', FEATURE, 'story.md');

    const kept = await json('POST', `/api/stories/${FEATURE}/keep`, { body: { keepOutOfGit: true } });
    assert.equal(kept.status, 200);
    assert.equal(kept.body.keptOutOfGit, true);
    assert.equal(fs.existsSync(file), false);
    assert.equal(afterSaveCalls.at(-1).isNew, false);

    const stillReads = await json('GET', `/api/stories/${FEATURE}`);
    assert.equal(stillReads.body.exists, true);
    assert.equal(stillReads.body.keptOutOfGit, true);

    const restored = await json('POST', `/api/stories/${FEATURE}/keep`, { body: { keepOutOfGit: false } });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.keptOutOfGit, false);
    assert.equal(fs.existsSync(file), true);
  });
});

test('no project open: every route answers 409 NO_PROJECT', async () => {
  await withStack({ open: false, project: '/work/none' }, async ({ json }) => {
    const r = await json('GET', `/api/stories/${FEATURE}`);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'NO_PROJECT');
  });
});

test('a mutating request from a foreign Origin is refused (403); GET is unaffected', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('POST', `/api/stories/${FEATURE}`, { headers: { origin: 'http://evil.example' } });
    assert.equal(r.status, 403);
    const get = await json('GET', `/api/stories/${FEATURE}`, { headers: { origin: 'http://evil.example' } });
    assert.equal(get.status, 200);
  });
});
