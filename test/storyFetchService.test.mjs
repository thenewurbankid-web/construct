// #384 -- strategy selection (design 9.3) and the wiring from `fetchStory` onto the ONE shared SSRF-guarded fetch
// (`safeFetch.mjs`, #436). The guard's own refusals (bad scheme, a private/metadata address, too many redirects,
// too big, too slow...) are exhaustively covered by `test/safeFetch.test.mjs`; this file only checks that every
// one of `safeFetch`'s failure codes reaches the caller unchanged, and that selectors/consent are settled before
// any network call is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchStory, chooseStrategy, sanitizeText, DEFAULT_STORY_FETCH_HOSTS } from '../packages/engine/storyFetchService.mjs';

test('strategy: an allow-listed host goes to the server; anything else needs the bridge (design 9.3)', () => {
  assert.equal(chooseStrategy('github.com', ['github.com']), 'server');
  assert.equal(chooseStrategy('GitHub.com', ['github.com']), 'server'); // case-insensitive
  assert.equal(chooseStrategy('acme.atlassian.net', ['github.com']), 'bridge');
});

test('a host not on the allow-list is reported NEEDS_BRIDGE, and safeFetch is never called', async () => {
  let called = false;
  const r = await fetchStory({ url: 'https://acme.atlassian.net/browse/STORE-1', safeFetchImpl: async () => { called = true; return { ok: false, code: 'NEVER' }; } });
  assert.deepEqual(r, { ok: false, code: 'NEEDS_BRIDGE', via: 'bridge', host: 'acme.atlassian.net' });
  assert.equal(called, false);
});

test('a malformed url is rejected before any strategy or network decision', async () => {
  const r = await fetchStory({ url: 'not a url', safeFetchImpl: async () => { throw new Error('must not be called'); } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_URL');
});

test('an unsafe selector is rejected before any network call (selector validation happens first, design 9.6b)', async () => {
  let called = false;
  const r = await fetchStory({
    url: 'https://github.com/acme/app/issues/1',
    parse: { title: "//a[contains(@href,'javascript:')]" },
    safeFetchImpl: async () => { called = true; return { ok: true, status: 200, url: '', redirects: 0, body: Buffer.from('') }; },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BANNED_CONSTRUCT');
  assert.equal(called, false);
});

test('every safeFetch refusal code (http, host, private IP, metadata IP, redirect to private, too big, too slow) reaches the caller unchanged', async () => {
  const codes = ['BAD_SCHEME', 'HOST_NOT_ALLOWED', 'NOT_PUBLIC', 'TOO_LARGE', 'TIMEOUT', 'TOO_MANY_REDIRECTS', 'DNS_FAILED'];
  for (const code of codes) {
    const r = await fetchStory({ url: 'https://github.com/acme/app', safeFetchImpl: async () => ({ ok: false, code, message: `refused: ${code}` }) });
    assert.equal(r.ok, false, code);
    assert.equal(r.code, code);
    assert.equal(r.message, `refused: ${code}`);
  }
});

test('the allow-list, caps and content-type restriction the caller configured are the ones passed to safeFetch', async () => {
  let seenUrl;
  let seenOpts;
  await fetchStory({
    url: 'https://github.com/acme/app', allowHosts: ['github.com'], maxBytes: 5000, timeoutMs: 2000,
    safeFetchImpl: async (url, opts) => { seenUrl = url; seenOpts = opts; return { ok: true, status: 200, url, redirects: 0, body: Buffer.from('hi') }; },
  });
  assert.equal(seenUrl, 'https://github.com/acme/app');
  assert.deepEqual(seenOpts.allowHosts, ['github.com']);
  assert.equal(seenOpts.maxBytes, 5000);
  assert.equal(seenOpts.timeoutMs, 2000);
  assert.ok(seenOpts.allowContentTypes.includes('text/html'));
});

test('a successful fetch returns sanitised text, the via label and the validated selectors, un-extracted', async () => {
  const r = await fetchStory({
    url: 'https://github.com/acme/app/issues/1',
    parse: { title: 'h1', acceptance: 'ul.acceptance > li' },
    safeFetchImpl: async (url) => ({ ok: true, status: 200, url, redirects: 1, body: Buffer.from('<h1>Ticket</h1>') }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'server');
  assert.equal(r.status, 200);
  assert.equal(r.redirects, 1);
  assert.equal(r.text, '<h1>Ticket</h1>');
  assert.deepEqual(r.selectors, { title: { kind: 'css', value: 'h1' }, acceptance: { kind: 'css', value: 'ul.acceptance > li' } });
});

test('sanitizeText strips control characters but keeps tab and newline; never touches the escaping of HTML (that is the renderer\'s job, design 9.6)', () => {
  assert.equal(sanitizeText('a\x00b\x1fc\tD\nE\x7f'), 'abc\tD\nE');
  assert.equal(sanitizeText('<script>alert(1)</script>'), '<script>alert(1)</script>');
});

test('the default allow-list is github.com only (design 9.6)', () => {
  assert.deepEqual(DEFAULT_STORY_FETCH_HOSTS, ['github.com']);
});
