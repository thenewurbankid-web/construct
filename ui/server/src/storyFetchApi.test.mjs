// #384 -- the HTTP surface: consent gating, the seven SSRF refusals surfaced with sane statuses, foreign-Origin
// and no-project refusals, and the consent list/revoke routes. `safeFetchImpl` is injected so no test touches the
// network; `storyFetchService.test.mjs` covers the strategy/refusal wiring directly, `test/storySelectors.test.mjs`
// covers selector validation, `test/safeFetch.test.mjs` covers the guard itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createStoryFetchRouter } from './storyFetchApi.mjs';

const ORIGIN = 'http://localhost:3000';
const OK_PAGE = async (url) => ({ ok: true, status: 200, url, redirects: 0, body: Buffer.from('<h1>Ticket</h1>') });

async function withStack({ project = '/work/acme', stateDir = makeTempDir('story-fetch-api-'), open = true, safeFetchImpl = OK_PAGE } = {}, fn) {
  const app = express();
  app.use('/api/story', createStoryFetchRouter({
    clientOrigin: ORIGIN,
    stateDir,
    safeFetchImpl,
    getRoot: () => (open ? { ok: true, root: project } : { ok: false, status: 409, body: { ok: false, code: 'NO_PROJECT' } }),
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
    await fn({ call, json, stateDir });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

test('no project open: every /api/story route answers 409 NO_PROJECT', async () => {
  await withStack({ open: false }, async ({ json }) => {
    for (const [method, p, body] of [['POST', '/api/story/fetch', { url: 'https://github.com/a/b' }], ['GET', '/api/story/consent'], ['DELETE', '/api/story/consent/x']]) {
      const r = await json(method, p, { body });
      assert.equal(r.status, 409, `${method} ${p}`);
      assert.equal(r.body.code, 'NO_PROJECT');
    }
  });
});

test('a mutating request from a foreign Origin is refused (403); GET is unaffected', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/a/b' }, headers: { origin: 'http://evil.example' } });
    assert.equal(r.status, 403);
    const list = await json('GET', '/api/story/consent', { headers: { origin: 'http://evil.example' } });
    assert.equal(list.status, 200);
  });
});

test('a host not on the allow-list is reported NEEDS_BRIDGE (409) without asking for consent', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('POST', '/api/story/fetch', { body: { url: 'https://acme.atlassian.net/browse/STORE-1' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'NEEDS_BRIDGE');
    assert.equal(r.body.via, 'bridge');
  });
});

test('first use of a (host, url) asks for consent (428) before any fetch, with the foreign-origin warning carried through', async () => {
  let called = false;
  await withStack({ safeFetchImpl: async () => { called = true; return OK_PAGE(); } }, async ({ json }) => {
    const r = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/1', source: 'foreign' } });
    assert.equal(r.status, 428);
    assert.equal(r.body.code, 'CONSENT_REQUIRED');
    assert.equal(r.body.warning, true);
    assert.equal(called, false);
  });
});

test('"once" fetches without persisting a standing approval; the next call with no consent asks again', async () => {
  await withStack({}, async ({ json }) => {
    const first = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/1', consent: 'once' } });
    assert.equal(first.status, 200);
    assert.equal(first.body.text, '<h1>Ticket</h1>');
    const second = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/1' } });
    assert.equal(second.status, 428, 'a once-approval must not be remembered');
  });
});

test('"always" persists a host-level approval that covers every later url on that host', async () => {
  await withStack({}, async ({ json }) => {
    const first = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/1', consent: 'always' } });
    assert.equal(first.status, 200);
    const other = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/2' } });
    assert.equal(other.status, 200, 'a host-level approval covers every url on that host');
    const list = await json('GET', '/api/story/consent');
    assert.equal(list.body.approvals.length, 1);
    assert.equal(list.body.approvals[0].scope, 'host');
  });
});

test('"deny" is persisted and refuses every later call for that exact url (403), listed and revocable', async () => {
  await withStack({}, async ({ json }) => {
    const denied = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/1', consent: 'deny' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'CONSENT_DENIED');
    const again = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/1' } });
    assert.equal(again.status, 403);
    assert.equal(again.body.code, 'CONSENT_DENIED');
    const list = await json('GET', '/api/story/consent');
    assert.equal(list.body.approvals.length, 1);
    const revoked = await json('DELETE', `/api/story/consent/${list.body.approvals[0].id}`);
    assert.equal(revoked.status, 200);
    assert.equal((await json('GET', '/api/story/consent')).body.approvals.length, 0);
  });
});

test('revoking an unknown approval id is 404', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('DELETE', '/api/story/consent/does-not-exist');
    assert.equal(r.status, 404);
  });
});

test('a bad selector is refused (400) before the fetch runs, even with standing consent', async () => {
  let calledWithSelector = false;
  await withStack({
    safeFetchImpl: async (url, opts) => { if (opts.allowContentTypes) calledWithSelector = true; return OK_PAGE(url); },
  }, async ({ json }) => {
    await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/1', consent: 'always' } });
    calledWithSelector = false;
    const r = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/1', parse: { title: "id('x')" } } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'BANNED_CONSTRUCT');
    assert.equal(calledWithSelector, false, 'safeFetch must not run when the selector is rejected');
  });
});

test('a per-refusal test: each safeFetch code maps to a sane HTTP status once consent already exists', async () => {
  const cases = [
    ['BAD_SCHEME', 400], // http
    ['HOST_NOT_ALLOWED', 403], // host not on the allow-list (surfaced here even though the router pre-filters by host, in case the underlying guard's own list ever narrows further)
    ['NOT_PUBLIC', 403], // private IP / metadata IP / redirect to private all report this one code
    ['TOO_LARGE', 413], // too big
    ['TIMEOUT', 504], // too slow
    ['TOO_MANY_REDIRECTS', 502],
    ['DNS_FAILED', 502],
  ];
  for (const [code, status] of cases) {
    await withStack({ safeFetchImpl: async () => ({ ok: false, code, message: `refused: ${code}` }) }, async ({ json }) => {
      const r = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app/issues/1', consent: 'once' } });
      assert.equal(r.status, status, code);
      assert.equal(r.body.code, code);
    });
  }
});

test('a non-JSON POST body is 415; an over-limit body is refused by the router\'s own parser', async () => {
  await withStack({}, async ({ call, json }) => {
    const r = await call('POST', '/api/story/fetch', { headers: { 'content-type': 'text/plain' }, body: 'not json' });
    assert.equal(r.status, 415);
    const big = await json('POST', '/api/story/fetch', { body: { url: 'https://github.com/acme/app', junk: 'x'.repeat(70 * 1024) } });
    assert.equal(big.status, 413);
  });
});

test('a missing or malformed url is 400 BAD_URL, and never reaches consent or the fetch', async () => {
  await withStack({}, async ({ json }) => {
    assert.equal((await json('POST', '/api/story/fetch', { body: {} })).body.code, 'BAD_URL');
    assert.equal((await json('POST', '/api/story/fetch', { body: { url: 'not a url' } })).body.code, 'BAD_URL');
  });
});
