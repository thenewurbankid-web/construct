// #638 -- the per-session GitHub connection store: config, state (single use, session-bound), TTL, refresh, wipe,
// what it asks GitHub (bounded, no redirects), and that a token is in no return value it should not be in.
// No network: `fetchImpl` is a scripted GitHub and `now` a clock the test moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthConfigError } from './auth.mjs';
import { PENDING_TTL_MS, REFRESH_MARGIN_MS, createRepoConnections, resolveRepoConnectionConfig, sessionKeyOf } from './repoConnection.mjs';

const ENV = { CONSTRUCT_GITHUB_REPO_CLIENT_ID: 'cid', CONSTRUCT_GITHUB_REPO_CLIENT_SECRET: 'csecret' };
const cfg = (extra = {}, opts = {}) => resolveRepoConnectionConfig({ ...ENV, ...extra }, opts);

/** A scripted GitHub. `expiresIn` seconds (null = a token that does not expire); every call is recorded. */
function fakeGithub({ expiresIn = 3600, refreshable = true, login = 'octo', kind = 'app', repos = [], userStatus = 200 } = {}) {
  const calls = [];
  let n = 0;
  const tokens = () => {
    n += 1;
    return { access_token: `ghu_access${n}`, ...(expiresIn ? { expires_in: expiresIn } : {}), ...(refreshable ? { refresh_token: `ghr_refresh${n}`, refresh_token_expires_in: 15_000_000 } : {}) };
  };
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null, redirect: opts.redirect, signal: opts.signal });
    if (u.pathname === '/login/oauth/access_token') {
      const body = JSON.parse(opts.body);
      if (body.grant_type === 'refresh_token') return body.refresh_token.startsWith('ghr_refresh') ? reply(200, tokens()) : reply(200, { error: 'bad_refresh_token' });
      return body.code === 'good' ? reply(200, tokens()) : reply(200, { error: 'bad_verification_code' });
    }
    if (u.pathname === '/user') return userStatus === 200 ? reply(200, { login }) : reply(userStatus, { message: 'nope' });
    if (u.pathname === '/user/installations') return kind === 'app' ? reply(200, { installations: [{ id: 7 }, { id: 8 }] }) : reply(403, {});
    const inst = /^\/user\/installations\/(\d+)\/repositories$/.exec(u.pathname);
    if (inst) return reply(200, { repositories: repos.filter((_r, i) => (i % 2) + 7 === Number(inst[1])) });
    if (u.pathname === '/user/repos') return reply(200, repos);
    if (u.pathname.startsWith('/applications/')) return reply(204, null);
    return reply(404, {});
  };
  return { fetchImpl, calls };
}

function make(gh, { now, maxTtlMs, config = cfg() } = {}) {
  const clock = { t: 1_000_000, ...(now ? { t: now } : {}) };
  let n = 0;
  const c = createRepoConnections({ ...config, tokenUrl: 'https://gh.test/login/oauth/access_token', authorizeUrl: 'https://gh.test/login/oauth/authorize', apiBase: 'https://api.test' }, {
    fetchImpl: (u, o) => gh.fetchImpl(u, o), now: () => clock.t, randomToken: () => `state${(n += 1)}`, maxTtlMs, registerExit: false,
  });
  return { c, clock };
}

const connect = async (c, key = 'alice') => {
  const { state } = c.begin(key);
  return c.complete({ key, state, code: 'good' });
};

test('config: off unless BOTH variables are set; half-configured is reported; callback defaults follow sign-in', () => {
  assert.equal(resolveRepoConnectionConfig({}).enabled, false);
  assert.equal(resolveRepoConnectionConfig({ CONSTRUCT_GITHUB_REPO_CLIENT_ID: 'x' }).enabled, false);
  assert.equal(resolveRepoConnectionConfig({ CONSTRUCT_GITHUB_REPO_CLIENT_ID: 'x' }).halfConfigured, true);
  assert.equal(resolveRepoConnectionConfig({ CONSTRUCT_GITHUB_REPO_CLIENT_SECRET: '  ' }).halfConfigured, false);
  assert.equal(cfg().enabled, true);
  assert.equal(cfg({}, { port: 4123 }).callbackUrl, 'http://localhost:4123/auth/repo/callback');
  assert.equal(cfg({ CONSTRUCT_OAUTH_CALLBACK_URL: 'https://cockpit.example/auth/callback' }).callbackUrl, 'https://cockpit.example/auth/repo/callback');
  assert.equal(cfg({ CONSTRUCT_GITHUB_REPO_CALLBACK_URL: 'https://x.example/auth/repo/callback' }).callbackUrl, 'https://x.example/auth/repo/callback');
  assert.equal(cfg().authorizeUrl, 'https://github.com/login/oauth/authorize');
  assert.equal(cfg().apiBase, 'https://api.github.com');
});

test('config: the mock GitHub base URLs are a harness setting, refused off loopback and when malformed', () => {
  const mock = { CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE: 'http://127.0.0.1:49100', CONSTRUCT_E2E_GITHUB_REPO_API_BASE: 'http://127.0.0.1:49100' };
  assert.equal(cfg(mock).tokenUrl, 'http://127.0.0.1:49100/login/oauth/access_token');
  assert.equal(cfg(mock).apiBase, 'http://127.0.0.1:49100');
  assert.throws(() => cfg(mock, { host: '0.0.0.0' }), AuthConfigError);
  assert.throws(() => cfg({ CONSTRUCT_E2E_GITHUB_REPO_API_BASE: 'http://127.0.0.1:1/path' }), AuthConfigError);
  assert.throws(() => cfg({ CONSTRUCT_E2E_GITHUB_REPO_API_BASE: 'ftp://x' }), AuthConfigError);
});

test('a disabled store does nothing: no state, no calls, status says only enabled:false', async () => {
  const gh = fakeGithub();
  const c = createRepoConnections(resolveRepoConnectionConfig({}), { fetchImpl: gh.fetchImpl, registerExit: false });
  assert.equal(c.enabled, false);
  assert.equal(c.begin('alice'), null);
  assert.deepEqual(c.status('alice'), { enabled: false, connected: false });
  assert.equal((await c.complete({ key: 'alice', state: 'x', code: 'good' })).ok, false);
  assert.equal(await c.acquire('alice'), null);
  assert.equal((await c.listRepos('alice')).status, 404);
  assert.equal(gh.calls.length, 0);
});

test('sessionKeyOf: the login lower-cased, empty without a session', () => {
  assert.equal(sessionKeyOf({ login: 'Alice' }), 'alice');
  assert.equal(sessionKeyOf(null), '');
  assert.equal(sessionKeyOf({ login: null }), '');
});

test('the authorization URL carries the client id, the callback and a state; scope only when configured', () => {
  const { c } = make(fakeGithub());
  const u = new URL(c.begin('alice').url);
  assert.equal(u.origin + u.pathname, 'https://gh.test/login/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('state'), 'state1');
  assert.ok(u.searchParams.get('redirect_uri').endsWith('/auth/repo/callback'));
  assert.equal(u.searchParams.has('scope'), false);
  assert.ok(!u.toString().includes('csecret'), 'the client secret never goes to the browser');
  const { c: c2 } = make(fakeGithub(), { config: cfg({ CONSTRUCT_GITHUB_REPO_SCOPE: 'repo' }) });
  assert.equal(new URL(c2.begin('alice').url).searchParams.get('scope'), 'repo');
});

test('state is single use: a replayed callback is refused and sends nothing to GitHub', async () => {
  const gh = fakeGithub();
  const { c } = make(gh);
  const { state } = c.begin('alice');
  assert.equal((await c.complete({ key: 'alice', state, code: 'good' })).ok, true);
  const before = gh.calls.length;
  const again = await c.complete({ key: 'alice', state, code: 'good' });
  assert.equal(again.ok, false);
  assert.equal(again.code, 'BAD_STATE');
  assert.equal(gh.calls.length, before, 'no call to GitHub for a spent state');
});

test('state is bound to the session that started it: another session cannot finish it, and it is spent by trying', async () => {
  const gh = fakeGithub();
  const { c } = make(gh);
  const { state } = c.begin('alice');
  const stolen = await c.complete({ key: 'mallory', state, code: 'good' });
  assert.equal(stolen.code, 'BAD_STATE');
  assert.equal(gh.calls.length, 0);
  assert.equal(c.status('mallory').connected, false);
  // Alice's own state is now spent too: presenting someone else's state burns it (no second guess for an attacker).
  assert.equal((await c.complete({ key: 'alice', state, code: 'good' })).code, 'BAD_STATE');
  // Made up, empty and non-string states are refused.
  for (const bad of ['nope', '', undefined, null, 5, {}]) assert.equal((await c.complete({ key: 'alice', state: bad, code: 'good' })).code, 'BAD_STATE');
});

test('state has a short TTL', async () => {
  const gh = fakeGithub();
  const { c, clock } = make(gh);
  const { state } = c.begin('alice');
  clock.t += PENDING_TTL_MS + 1;
  assert.equal((await c.complete({ key: 'alice', state, code: 'good' })).code, 'BAD_STATE');
  assert.equal(gh.calls.length, 0);
});

test('a bad code, an unidentifiable account and a provider outage leave nothing stored', async () => {
  const gh = fakeGithub();
  const { c } = make(gh);
  let r = await (async () => { const { state } = c.begin('alice'); return c.complete({ key: 'alice', state, code: 'wrong' }); })();
  assert.equal(r.code, 'EXCHANGE_FAILED');
  assert.equal(c.status('alice').connected, false);

  const noUser = make(fakeGithub({ userStatus: 401 }));
  r = await connect(noUser.c);
  assert.equal(r.code, 'IDENTIFY_FAILED');
  assert.equal(noUser.c.status('alice').connected, false);

  const down = make({ fetchImpl: async () => { throw new Error('ECONNRESET secret-in-error'); }, calls: [] });
  r = await connect(down.c);
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes('secret-in-error'), 'nothing from a failure is echoed');
});

test('connect: status shows the account and never a token; the store never returns the token in any result', async () => {
  const gh = fakeGithub({ login: 'octo-cat' });
  const { c } = make(gh);
  const r = await connect(c);
  assert.deepEqual(r, { ok: true, login: 'octo-cat' });
  assert.deepEqual(c.status('alice'), { enabled: true, connected: true, login: 'octo-cat' });
  assert.deepEqual(c.status('bob'), { enabled: true, connected: false });
  for (const v of [r, c.status('alice'), await c.disconnect('nobody')]) assert.ok(!/ghu_|ghr_/.test(JSON.stringify(v)));
  // The call that exchanged the code went to the token URL with the client secret in the body, never in a URL.
  const ex = gh.calls.find((x) => x.url.endsWith('/login/oauth/access_token'));
  assert.equal(ex.method, 'POST');
  assert.equal(ex.body.client_secret, 'csecret');
  assert.ok(gh.calls.every((x) => !x.url.includes('csecret') && !x.url.includes('ghu_')));
});

test('every call to GitHub is bounded in time and never follows a redirect', async () => {
  const gh = fakeGithub({ repos: [{ full_name: 'o/r', private: true }] });
  const { c } = make(gh);
  await connect(c);
  await c.listRepos('alice');
  await c.disconnect('alice');
  assert.ok(gh.calls.length >= 5);
  for (const call of gh.calls) {
    assert.equal(call.redirect, 'manual', call.url);
    assert.ok(call.signal instanceof AbortSignal, call.url);
  }
});

test('a redirect answer from the provider is a failure, not something to follow', async () => {
  const fetchImpl = async () => ({ status: 302, ok: false, headers: { get: () => 'https://evil.example/' }, json: async () => { throw new Error('no body'); } });
  const { c } = make({ fetchImpl, calls: [] });
  assert.equal((await connect(c)).code, 'EXCHANGE_FAILED');
});

test('acquire hands out a COPY: zeroing it does not touch the stored token, and the copy is the token', async () => {
  const { c } = make(fakeGithub());
  await connect(c);
  const a = await c.acquire('alice');
  assert.equal(a.toString('latin1'), 'ghu_access1');
  a.fill(0);
  const b = await c.acquire('alice');
  assert.equal(b.toString('latin1'), 'ghu_access1');
  assert.equal(await c.acquire('bob'), null, 'another session has none');
});

test('TTL: a token that expires is gone at its expiry (no refresh token), not after', async () => {
  const { c, clock } = make(fakeGithub({ expiresIn: 600, refreshable: false }));
  await connect(c);
  clock.t += 600 * 1000 - REFRESH_MARGIN_MS - 1;
  assert.ok(await c.acquire('alice'), 'still usable before its expiry');
  clock.t += REFRESH_MARGIN_MS + 1;
  assert.equal(await c.acquire('alice'), null);
  assert.equal(c.status('alice').connected, false);
});

test('TTL: never longer than the session lifetime, even for a token that does not expire', async () => {
  const { c, clock } = make(fakeGithub({ expiresIn: null, refreshable: false }), { maxTtlMs: 5000 });
  await connect(c);
  clock.t += 4999;
  assert.ok(await c.acquire('alice'));
  clock.t += 2;
  assert.equal(await c.acquire('alice'), null);
  assert.equal(c.status('alice').connected, false);
});

test('the sweeper wipes expired entries without anyone asking', async () => {
  const { c, clock } = make(fakeGithub({ expiresIn: null, refreshable: false }), { maxTtlMs: 1000 });
  await connect(c);
  clock.t += 1001;
  c.sweep();
  assert.equal(c.status('alice').connected, false);
  c.close();
});

test('refresh: shortly before expiry the token is renewed on the server, once, and the old one is replaced', async () => {
  const gh = fakeGithub({ expiresIn: 3600, refreshable: true });
  const { c, clock } = make(gh);
  await connect(c);
  assert.equal((await c.acquire('alice')).toString('latin1'), 'ghu_access1');
  clock.t += 3600 * 1000 - REFRESH_MARGIN_MS + 1;
  // Two concurrent asks share one refresh.
  const [x, y] = await Promise.all([c.acquire('alice'), c.acquire('alice')]);
  assert.equal(x.toString('latin1'), 'ghu_access2');
  assert.equal(y.toString('latin1'), 'ghu_access2');
  const refreshes = gh.calls.filter((k) => k.body?.grant_type === 'refresh_token');
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0].body.refresh_token, 'ghr_refresh1');
  assert.equal(refreshes[0].body.client_secret, 'csecret');
  assert.equal(c.status('alice').connected, true);
});

test('refresh refused by GitHub: the connection ends and the session must connect again', async () => {
  const gh = fakeGithub({ expiresIn: 3600, refreshable: true });
  const { c, clock } = make(gh);
  await connect(c);
  const wrap = gh.fetchImpl;
  gh.fetchImpl = async (url, opts) => (opts?.body?.includes('refresh_token') && JSON.parse(opts.body).grant_type === 'refresh_token' ? { status: 200, ok: true, json: async () => ({ error: 'bad_refresh_token' }) } : wrap(url, opts));
  clock.t += 3600 * 1000;
  assert.equal(await c.acquire('alice'), null);
  assert.equal(c.status('alice').connected, false);
});

test('refresh that finishes after a Disconnect does not resurrect the connection', async () => {
  const gh = fakeGithub({ expiresIn: 3600, refreshable: true });
  const { c, clock } = make(gh);
  await connect(c);
  const wrap = gh.fetchImpl;
  let release;
  const gate = new Promise((r) => { release = r; });
  gh.fetchImpl = async (url, opts) => { if (opts?.body && JSON.parse(opts.body).grant_type === 'refresh_token') await gate; return wrap(url, opts); };
  // createRepoConnections captured fetchImpl at creation, so rebuild with the gated one
  const again = createRepoConnections({ ...cfg(), tokenUrl: 'https://gh.test/login/oauth/access_token', authorizeUrl: 'https://gh.test/a', apiBase: 'https://api.test' }, { fetchImpl: (u, o) => gh.fetchImpl(u, o), now: () => clock.t, randomToken: () => 's', registerExit: false });
  const { state } = again.begin('alice');
  await again.complete({ key: 'alice', state, code: 'good' });
  clock.t += 3600 * 1000;
  const pending = again.acquire('alice');
  await again.disconnect('alice');
  release();
  assert.equal(await pending, null);
  assert.equal(again.status('alice').connected, false);
});

test('wipe: sign-out (wipeKey), Disconnect and server stop (wipeAll/close) zero the stored buffers and remove them', async () => {
  const { c } = make(fakeGithub());
  await connect(c, 'alice');
  await connect(c, 'bob');
  // reach the stored buffer through a copy is not enough: prove zeroing via the exit path with a spy on Buffer.fill
  const filled = [];
  const orig = Buffer.prototype.fill;
  Buffer.prototype.fill = function (...a) { if (a[0] === 0 && this.length > 3) filled.push(this.toString('latin1')); return orig.apply(this, a); };
  try {
    assert.equal(c.wipeKey('alice'), true);
    assert.equal(c.wipeKey('alice'), false);
    assert.equal(filled.length, 2, 'access and refresh buffers zeroed');
    filled.length = 0;
    c.close(); // server stop
    assert.equal(filled.length, 2);
  } finally {
    Buffer.prototype.fill = orig;
  }
  assert.equal(c.status('alice').connected, false);
  assert.equal(c.status('bob').connected, false);
  assert.equal(await c.acquire('bob'), null);
});

test('Disconnect asks GitHub to revoke (best effort), zeroes at once, and never fails if GitHub is down', async () => {
  const gh = fakeGithub();
  const { c } = make(gh);
  await connect(c);
  assert.deepEqual(await c.disconnect('alice'), { ok: true, wasConnected: true });
  assert.equal(c.status('alice').connected, false);
  const revoke = gh.calls.find((k) => k.method === 'DELETE');
  assert.match(revoke.url, /\/applications\/cid\/token$/);
  assert.match(revoke.headers.Authorization, /^Basic /);
  assert.deepEqual(await c.disconnect('alice'), { ok: true, wasConnected: false });

  const down = fakeGithub();
  const { c: c2 } = make(down);
  await connect(c2);
  down.fetchImpl = async () => { throw new Error('down'); };
  const c3 = createRepoConnections({ ...cfg(), tokenUrl: 'https://gh.test/t', authorizeUrl: 'https://gh.test/a', apiBase: 'https://api.test' }, { fetchImpl: async () => { throw new Error('down'); }, registerExit: false });
  assert.deepEqual(await c3.disconnect('alice'), { ok: true, wasConnected: false });
});

test('listRepos, GitHub App: the installations the token can use, names and visibility only, sorted, paged', async () => {
  const repos = [
    { full_name: 'zed/last', private: true, id: 1, owner: { login: 'zed', secretish: 'x' }, clone_url: 'https://github.com/zed/last.git' },
    { full_name: 'acme/api', private: true },
    { full_name: 'acme/site', private: false },
    { full_name: 'bad name/x', private: true },
    { full_name: '../evil/x', private: true },
  ];
  const { c } = make(fakeGithub({ repos }));
  await connect(c);
  const all = await c.listRepos('alice');
  assert.equal(all.ok, true);
  assert.equal(all.source, 'installations');
  assert.deepEqual(all.repos, [
    { fullName: 'acme/api', owner: 'acme', name: 'api', private: true },
    { fullName: 'acme/site', owner: 'acme', name: 'site', private: false },
    { fullName: 'zed/last', owner: 'zed', name: 'last', private: true },
  ]);
  assert.equal(all.total, 3);
  assert.equal(all.hasMore, false);
  assert.ok(!JSON.stringify(all).includes('clone_url') && !/ghu_|ghr_/.test(JSON.stringify(all)));
  const p1 = await c.listRepos('alice', { page: 1, perPage: 2 });
  assert.equal(p1.repos.length, 2);
  assert.equal(p1.hasMore, true);
  const p2 = await c.listRepos('alice', { page: 2, perPage: 2 });
  assert.deepEqual(p2.repos.map((r) => r.fullName), ['zed/last']);
  assert.equal(p2.hasMore, false);
  assert.deepEqual((await c.listRepos('alice', { q: 'SITE' })).repos.map((r) => r.fullName), ['acme/site']);
});

test('listRepos, OAuth app: the installations endpoint refuses the token, so the person\'s repositories are listed', async () => {
  const { c } = make(fakeGithub({ kind: 'oauth', repos: [{ full_name: 'me/mine', private: true }] }));
  await connect(c);
  const r = await c.listRepos('alice');
  assert.equal(r.source, 'user');
  assert.deepEqual(r.repos.map((x) => x.fullName), ['me/mine']);
});

test('listRepos: not connected is a distinct answer; a token GitHub no longer accepts ends the connection', async () => {
  const gh = fakeGithub({ repos: [] });
  const { c } = make(gh);
  assert.equal((await c.listRepos('alice')).code, 'NOT_CONNECTED');
  await connect(c);
  const wrap = gh.fetchImpl;
  const c2 = createRepoConnections({ ...cfg(), tokenUrl: 'https://gh.test/login/oauth/access_token', authorizeUrl: 'https://gh.test/a', apiBase: 'https://api.test' }, {
    fetchImpl: async (u, o) => (String(u).endsWith('/user/installations?per_page=100&page=1') ? { status: 401, ok: false, json: async () => ({}) } : wrap(u, o)),
    registerExit: false,
  });
  const { state } = c2.begin('alice');
  await c2.complete({ key: 'alice', state, code: 'good' });
  const r = await c2.listRepos('alice');
  assert.equal(r.code, 'NOT_CONNECTED');
  assert.equal(c2.status('alice').connected, false);
});

test('listRepos: a provider that does not answer in time is a 502 with fixed wording', async () => {
  const gh = fakeGithub();
  const { c } = make(gh);
  await connect(c);
  const c2 = createRepoConnections({ ...cfg(), tokenUrl: 'https://gh.test/login/oauth/access_token', authorizeUrl: 'https://gh.test/a', apiBase: 'https://api.test' }, {
    fetchImpl: async (u, o) => (String(u).includes('/login/') ? gh.fetchImpl(u, o) : String(u).endsWith('/user') ? gh.fetchImpl(u, o) : Promise.reject(new Error('timeout token=ghu_leak'))),
    registerExit: false,
  });
  const { state } = c2.begin('alice');
  await c2.complete({ key: 'alice', state, code: 'good' });
  const r = await c2.listRepos('alice');
  assert.equal(r.status, 502);
  assert.equal(r.code, 'GITHUB_UNREACHABLE');
  assert.ok(!JSON.stringify(r).includes('ghu_leak'));
});
