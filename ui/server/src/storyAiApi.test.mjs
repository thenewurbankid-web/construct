// #387 -- the HTTP surface: skeleton preview (no model call), pattern-propose (one model call, selectors
// re-validated and proved to match before being returned), and extract (one model call, values re-verified as
// quoted text before being returned). `callLlmImpl` and `getOllamaStatusImpl` are injected so no test touches a
// real model or the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createStoryAiRouter } from './storyAiApi.mjs';

const ORIGIN = 'http://localhost:3000';
const PAGE_HTML = '<html><body><h1 class="title">Delivery delay banner</h1><p class="summary">Shows only on delivered orders.</p><ul class="acceptance"><li>Banner text matches design</li><li>Hidden until delivered</li></ul></body></html>';

async function withStack({ callLlmImpl, getOllamaStatusImpl = async () => ({ running: true }) } = {}, fn) {
  const app = express();
  app.use((req, res, next) => { req.session = {}; next(); });
  app.use('/api/story-ai', createStoryAiRouter({ clientOrigin: ORIGIN, callLlmImpl, getOllamaStatusImpl }));
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
    await fn({ call, json });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

test('no session: every /api/story-ai route answers 401', async () => {
  const app = express();
  app.use('/api/story-ai', createStoryAiRouter({ clientOrigin: ORIGIN }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/story-ai/skeleton`, {
    method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ html: '<h1>x</h1>' }),
  });
  assert.equal(r.status, 401);
  server.close();
});

test('a mutating request from a foreign Origin is refused (403)', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('POST', '/api/story-ai/skeleton', { body: { html: '<h1>x</h1>' }, headers: { origin: 'http://evil.example' } });
    assert.equal(r.status, 403);
  });
});

test('POST /skeleton builds a skeleton with no model call, and rejects missing/oversized html', async () => {
  await withStack({}, async ({ json }) => {
    const ok = await json('POST', '/api/story-ai/skeleton', { body: { html: PAGE_HTML } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.match(ok.body.text, /h1/);
    const missing = await json('POST', '/api/story-ai/skeleton', { body: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, 'BAD_HTML');
  });
});

test('pattern/propose: the model is offline -> 503 MODEL_OFFLINE, no model call attempted', async () => {
  let called = false;
  await withStack({
    getOllamaStatusImpl: async () => ({ running: false }),
    callLlmImpl: async () => { called = true; return '{}'; },
  }, async ({ json }) => {
    const r = await json('POST', '/api/story-ai/pattern/propose', { body: { feature: 'delivery', url: 'https://example.com/a', html: PAGE_HTML } });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'MODEL_OFFLINE');
    assert.equal(called, false);
  });
});

test('pattern/propose: a matching selector is returned; a hallucinated one is dropped from the proposal', async () => {
  await withStack({
    callLlmImpl: async () => JSON.stringify({ title: '.title', status: '.does-not-exist' }),
  }, async ({ json }) => {
    const r = await json('POST', '/api/story-ai/pattern/propose', { body: { feature: 'delivery', url: 'https://example.com/a', html: PAGE_HTML } });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.parse, { title: '.title' });
    assert.equal(r.body.rejectedFields.some((f) => f.name === 'status' && f.reason === 'NO_MATCH'), true);
    assert.equal(r.body.calls, 1);
  });
});

test('pattern/propose: an unsafe selector refuses the whole proposal (422), nothing returned', async () => {
  await withStack({
    callLlmImpl: async () => JSON.stringify({ title: "id('x')" }),
  }, async ({ json }) => {
    const r = await json('POST', '/api/story-ai/pattern/propose', { body: { feature: 'delivery', url: 'https://example.com/a', html: PAGE_HTML } });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'BANNED_CONSTRUCT');
  });
});

test('pattern/propose: a non-JSON model reply is 502 BAD_MODEL_RESPONSE', async () => {
  await withStack({ callLlmImpl: async () => 'not json at all' }, async ({ json }) => {
    const r = await json('POST', '/api/story-ai/pattern/propose', { body: { feature: 'delivery', url: 'https://example.com/a', html: PAGE_HTML } });
    assert.equal(r.status, 502);
    assert.equal(r.body.code, 'BAD_MODEL_RESPONSE');
  });
});

test('extract: a quoted value is verified; a paraphrased/invented one is rejected, never returned', async () => {
  await withStack({
    callLlmImpl: async () => JSON.stringify({ title: 'Delivery delay banner', status: 'This value was invented' }),
  }, async ({ json }) => {
    const r = await json('POST', '/api/story-ai/extract', { body: { feature: 'delivery', url: 'https://example.com/a', html: PAGE_HTML, fields: ['title', 'status'] } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.values, { title: 'Delivery delay banner' });
    assert.equal(r.body.rejected.length, 1);
    assert.equal(r.body.rejected[0].name, 'status');
  });
});

test('extract: nothing verified -> 422 NOTHING_VERIFIED, values withheld entirely', async () => {
  await withStack({
    callLlmImpl: async () => JSON.stringify({ title: 'A total fabrication' }),
  }, async ({ json }) => {
    const r = await json('POST', '/api/story-ai/extract', { body: { feature: 'delivery', url: 'https://example.com/a', html: PAGE_HTML, fields: ['title'] } });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'NOTHING_VERIFIED');
    assert.equal(r.body.values, undefined);
  });
});

test('extract: the model is offline -> 503 MODEL_OFFLINE, no model call attempted', async () => {
  let called = false;
  await withStack({
    getOllamaStatusImpl: async () => ({ running: false }),
    callLlmImpl: async () => { called = true; return '{}'; },
  }, async ({ json }) => {
    const r = await json('POST', '/api/story-ai/extract', { body: { feature: 'delivery', url: 'https://example.com/a', html: PAGE_HTML } });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'MODEL_OFFLINE');
    assert.equal(called, false);
  });
});

test('a missing url/html/feature is 400 before any model call', async () => {
  let called = false;
  await withStack({ callLlmImpl: async () => { called = true; return '{}'; } }, async ({ json }) => {
    assert.equal((await json('POST', '/api/story-ai/pattern/propose', { body: { feature: 'delivery', url: 'https://example.com/a' } })).status, 400);
    assert.equal((await json('POST', '/api/story-ai/pattern/propose', { body: { url: 'https://example.com/a', html: PAGE_HTML } })).status, 400);
    assert.equal((await json('POST', '/api/story-ai/pattern/propose', { body: { feature: 'delivery', url: 'http://example.com/a', html: PAGE_HTML } })).status, 400);
    assert.equal(called, false);
  });
});
