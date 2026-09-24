// #638 -- the HTTP surface of "Connect GitHub for private repositories", against a MOCK GitHub (a local http server
// standing in for github.com/login/oauth and api.github.com; ui/e2e/support/mock-github.mjs), never the real one.
//
// A real Express app with the real session gate, the real `/auth/repo/*` routes, the real `/api/github/*` router and
// the real clone router; ports 49110-49119 (the range this feature's server tests own). Every response and header this
// file ever sees is kept, and at the end none of them may contain a token the mock issued; the same for the console.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, startMockGithub } from '../../e2e/support/mock-github.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createCloneJobs } from './cloneJobs.mjs';
import { createCloneRouter } from './cloneApi.mjs';
import { REPO_STATE_COOKIE, createGithubRouter, mountRepoAuthRoutes } from './githubRepoApi.mjs';
import { createRepoConnections, resolveRepoConnectionConfig, sessionKeyOf } from './repoConnection.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 'e2e-session-secret-not-a-real-one-0123456789';
const REPOS = [
  { full_name: 'octo-mock/private-notes', private: true },
  { full_name: 'octo-mock/fixture-app', private: true },
  { full_name: 'octo-org/public-site', private: false },
];

const sandbox = fs.realpathSync(makeTempDir('githubrepo-'));
const transcript = []; // every response body + header block this file received
const consoleLines = [];
const origConsole = {};

/** A tiny cookie jar: name -> value. */
const jar = () => {
  const c = new Map();
  return {
    take(res) { for (const line of res.headers.getSetCookie?.() ?? []) { const [pair] = line.split(';'); const i = pair.indexOf('='); const v = decodeURIComponent(pair.slice(i + 1)); if (line.includes('Max-Age=0')) c.delete(pair.slice(0, i)); else c.set(pair.slice(0, i), v); } },
    header() { return [...c].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '); },
    set(k, v) { c.set(k, v); },
    get: (k) => c.get(k),
  };
};

async function boot({ port, mockPort, mockOpts = {}, enabled = true, workspace = null, localRoot = null }) {
  const mock = await startMockGithub({ port: mockPort, repos: REPOS, installations: 2, ...mockOpts });
  const env = {
    ...(enabled ? { CONSTRUCT_GITHUB_REPO_CLIENT_ID: MOCK_CLIENT_ID, CONSTRUCT_GITHUB_REPO_CLIENT_SECRET: MOCK_CLIENT_SECRET } : {}),
    CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE: mock.origin,
    CONSTRUCT_E2E_GITHUB_REPO_API_BASE: mock.origin,
  };
  const repoCfg = resolveRepoConnectionConfig(env, { host: '127.0.0.1', port });
  let connections = null;
  const auth = createAuth(
    resolveAuthConfig({ CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'alice', CONSTRUCT_SESSION_SECRET: SECRET, NODE_ENV: 'test' }, { host: '127.0.0.1', port, clientOrigin: ORIGIN }),
    { onLogout: (login) => connections?.wipeKey(sessionKeyOf({ login })) },
  );
  connections = createRepoConnections({ ...repoCfg, callbackUrl: `http://127.0.0.1:${port}/auth/repo/callback` }, { maxTtlMs: auth.config.sessionTtlMs, registerExit: false });
  const app = express();
  app.use(express.json());
  auth.mountRoutes(app);
  mountRepoAuthRoutes(app, { connections, auth, clientOrigin: ORIGIN });
  app.use('/api', auth.requireSession);
  app.use('/api/github', createGithubRouter({ connections, clientOrigin: ORIGIN }));
  let jobs = null;
  if (workspace) {
    jobs = createCloneJobs({ getRoot: () => workspace, localRoot, loginToken: (key) => connections.acquire(key) });
    app.use('/api/clone', createCloneRouter({ jobs, clientOrigin: ORIGIN }));
  }
  const server = app.listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, { cookies, headers = {}, body, redirect = 'manual' } = {}) => {
    const res = await fetch(`${base}${url}`, { method, redirect, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookies ? { cookie: cookies.header() } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    transcript.push(`${method} ${url} -> ${res.status}\n${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n${text}`);
    cookies?.take(res);
    let json = null;
    try { json = JSON.parse(text); } catch { /* html or empty */ }
    return { status: res.status, headers: res.headers, text, json };
  };
  /** Sign in as `login` (a signed session cookie, as the test login mints one). */
  const session = (login = 'alice') => { const c = jar(); c.set(SESSION_COOKIE, signValue({ login, name: login, avatarUrl: null, iat: Date.now(), exp: Date.now() + 3600_000 }, SECRET)); return c; };
  /** The whole browser dance: /auth/repo/start -> mock authorize -> /auth/repo/callback. */
  const connect = async (cookies) => {
    const start = await call('GET', '/auth/repo/start', { cookies });
    assert.equal(start.status, 302, start.text);
    const authorize = await fetch(start.headers.get('location'), { redirect: 'manual' });
    assert.equal(authorize.status, 302);
    const back = new URL(authorize.headers.get('location'));
    const cb = await call('GET', `${back.pathname}${back.search}`, { cookies });
    return { start, back, cb };
  };
  return { mock, connections, auth, app, jobs, base, call, session, connect, jar, close: async () => { connections.close(); server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await mock.close(); } };
}

before(() => {
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    origConsole[m] = console[m];
    console[m] = (...a) => { consoleLines.push(a.map(String).join(' ')); };
  }
});
after(() => {
  Object.assign(console, origConsole);
});

test('disabled (no CONSTRUCT_GITHUB_REPO_CLIENT_ID/SECRET): invisible. status says only enabled:false, every other route is a 404 and GitHub is never called', async () => {
  const t = await boot({ port: 49110, mockPort: 49111, enabled: false });
  try {
    const cookies = t.session();
    assert.deepEqual((await t.call('GET', '/api/github/status', { cookies })).json, { ok: true, enabled: false, connected: false });
    for (const [m, u] of [['GET', '/auth/repo/start'], ['GET', '/auth/repo/callback?code=x&state=y'], ['GET', '/api/github/repos'], ['POST', '/api/github/disconnect']]) {
      assert.equal((await t.call(m, u, { cookies, body: m === 'POST' ? {} : undefined })).status, 404, `${m} ${u}`);
    }
    assert.deepEqual(t.mock.seen(), []);
  } finally { await t.close(); }
});

test('the routes sit below the session gate: no session is a 401 (and /auth/repo/start does not start anything)', async () => {
  const t = await boot({ port: 49112, mockPort: 49113 });
  try {
    for (const [m, u] of [['GET', '/api/github/status'], ['GET', '/api/github/repos'], ['POST', '/api/github/disconnect']]) {
      assert.equal((await t.call(m, u, { body: m === 'POST' ? {} : undefined })).status, 401, `${m} ${u}`);
    }
    const start = await t.call('GET', '/auth/repo/start');
    assert.equal(start.status, 401);
    assert.equal(start.headers.get('location'), null);
    assert.equal(start.headers.getSetCookie().length, 0, 'no state cookie for a signed-out browser');
    assert.deepEqual(t.mock.seen(), []);
  } finally { await t.close(); }
});

test('the whole connect flow: start -> GitHub -> callback, then status shows the account, repos lists, disconnect ends it and revokes', async () => {
  const t = await boot({ port: 49114, mockPort: 49115 });
  try {
    const cookies = t.session('alice');
    assert.deepEqual((await t.call('GET', '/api/github/status', { cookies })).json, { ok: true, enabled: true, connected: false });
    assert.equal((await t.call('GET', '/api/github/repos', { cookies })).status, 409);

    const { start, back, cb } = await t.connect(cookies);
    const authorize = new URL(start.headers.get('location'));
    assert.equal(authorize.origin, t.mock.origin);
    assert.equal(authorize.searchParams.get('client_id'), MOCK_CLIENT_ID);
    assert.equal(authorize.searchParams.get('redirect_uri'), 'http://127.0.0.1:49114/auth/repo/callback');
    assert.ok(authorize.searchParams.get('state').length >= 20);
    assert.ok(!authorize.toString().includes(MOCK_CLIENT_SECRET));
    const stateCookie = start.headers.getSetCookie().find((c) => c.startsWith(`${REPO_STATE_COOKIE}=`));
    assert.match(stateCookie, /HttpOnly/);
    assert.match(stateCookie, /SameSite=Lax/);
    assert.match(stateCookie, /Path=\/auth\/repo/);
    assert.equal(back.pathname, '/auth/repo/callback');
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), ORIGIN);
    assert.ok(!cb.headers.get('location').includes('code='), 'no code, state or token is put in the redirect');

    const st = await t.call('GET', '/api/github/status', { cookies });
    assert.deepEqual(st.json, { ok: true, enabled: true, connected: true, login: 'octo-mock' });

    const repos = await t.call('GET', '/api/github/repos', { cookies });
    assert.equal(repos.status, 200);
    assert.deepEqual(repos.json.repos.map((r) => r.fullName), ['octo-mock/fixture-app', 'octo-mock/private-notes', 'octo-org/public-site']);
    assert.deepEqual(repos.json.repos[2], { fullName: 'octo-org/public-site', owner: 'octo-org', name: 'public-site', private: false });
    assert.equal(repos.json.source, 'installations');
    const paged = await t.call('GET', '/api/github/repos?page=2&per_page=2', { cookies });
    assert.deepEqual(paged.json.repos.map((r) => r.fullName), ['octo-org/public-site']);
    assert.equal(paged.json.hasMore, false);
    assert.deepEqual((await t.call('GET', '/api/github/repos?q=NOTES', { cookies })).json.repos.map((r) => r.fullName), ['octo-mock/private-notes']);
    // Only the server called GitHub's API, with a Bearer token; the browser never got one.
    assert.ok(t.mock.seen().some((r) => r.path === '/user/installations' && r.bearer));

    // Another signed-in login has no connection of its own.
    const bob = t.session('bob');
    assert.deepEqual((await t.call('GET', '/api/github/status', { cookies: bob })).json, { ok: true, enabled: true, connected: false });
    assert.equal((await t.call('GET', '/api/github/repos', { cookies: bob })).status, 409);

    const token = t.mock.issued().find((x) => x.startsWith('ghu_'));
    assert.equal(t.mock.isLive(token), true);
    const gone = await t.call('POST', '/api/github/disconnect', { cookies, body: {} });
    assert.deepEqual(gone.json, { ok: true, enabled: true, connected: false });
    assert.equal(t.mock.isLive(token), false, 'the token was revoked at the provider');
    assert.equal((await t.call('GET', '/api/github/status', { cookies })).json.connected, false);
    assert.equal((await t.call('GET', '/api/github/repos', { cookies })).status, 409);
    assert.ok(t.mock.seen().some((r) => r.method === 'DELETE'));
  } finally { await t.close(); }
});

test('CSRF state: single use, bound to the session and to the browser, short-lived; refusals say nothing about why', async () => {
  const t = await boot({ port: 49116, mockPort: 49117 });
  try {
    // 1. Replay: the same callback URL twice.
    const alice = t.session('alice');
    const first = await t.connect(alice);
    assert.equal(first.cb.status, 302);
    const replayCookies = t.jar();
    replayCookies.set(SESSION_COOKIE, alice.get(SESSION_COOKIE));
    const replay = await t.call('GET', `${first.back.pathname}${first.back.search}`, { cookies: replayCookies });
    assert.equal(replay.status, 400);
    await t.call('POST', '/api/github/disconnect', { cookies: alice, body: {} });

    // 2. A callback with a state this server never issued, or none at all.
    for (const q of ['code=abc&state=forged', 'code=abc', 'state=x', '']) {
      const r = await t.call('GET', `/auth/repo/callback?${q}`, { cookies: t.session('alice') });
      assert.equal(r.status, 400, q);
    }

    // 3. Session-bound: mallory (a different signed-in login) presents alice's state, even with alice's state cookie.
    const a = t.session('alice');
    const start = await t.call('GET', '/auth/repo/start', { cookies: a });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const mallory = t.session('mallory');
    mallory.set(REPO_STATE_COOKIE, a.get(REPO_STATE_COOKIE));
    const stolen = await t.call('GET', `/auth/repo/callback?code=abc&state=${state}`, { cookies: mallory });
    assert.equal(stolen.status, 400);
    assert.equal((await t.call('GET', '/api/github/status', { cookies: mallory })).json.connected, false);
    // ...and the state was spent by that attempt: alice cannot use it any more either.
    const late = await t.call('GET', `/auth/repo/callback?code=abc&state=${state}`, { cookies: a });
    assert.equal(late.status, 400);

    // 4. Browser-bound: the right session and state but no state cookie (a link opened elsewhere).
    const b = t.session('alice');
    const s2 = await t.call('GET', '/auth/repo/start', { cookies: b });
    const state2 = new URL(s2.headers.get('location')).searchParams.get('state');
    const noCookie = t.jar();
    noCookie.set(SESSION_COOKIE, b.get(SESSION_COOKIE));
    assert.equal((await t.call('GET', `/auth/repo/callback?code=abc&state=${state2}`, { cookies: noCookie })).status, 400);
    // A tampered (unsigned) state cookie is no better.
    const forged = t.session('alice');
    forged.set(REPO_STATE_COOKIE, `${Buffer.from(JSON.stringify({ state: state2, exp: Date.now() + 1e6 })).toString('base64url')}.AAAA`);
    assert.equal((await t.call('GET', `/auth/repo/callback?code=abc&state=${state2}`, { cookies: forged })).status, 400);

    // 5. A signed-out browser cannot finish one either.
    const s3 = await t.call('GET', '/auth/repo/start', { cookies: t.session('alice') });
    const state3 = new URL(s3.headers.get('location')).searchParams.get('state');
    assert.equal((await t.call('GET', `/auth/repo/callback?code=abc&state=${state3}`)).status, 401);

    // 6. GitHub answering "access denied" connects nothing.
    const d = t.session('alice');
    const s4 = await t.call('GET', '/auth/repo/start', { cookies: d });
    const state4 = new URL(s4.headers.get('location')).searchParams.get('state');
    const denied = await t.call('GET', `/auth/repo/callback?error=access_denied&state=${state4}`, { cookies: d });
    assert.equal(denied.status, 403);
    assert.equal((await t.call('GET', '/api/github/status', { cookies: d })).json.connected, false);

    // 7. A used or bad code (a second exchange of the same code fails at GitHub) connects nothing, with fixed wording.
    const e = t.session('alice');
    const s5 = await t.call('GET', '/auth/repo/start', { cookies: e });
    const state5 = new URL(s5.headers.get('location')).searchParams.get('state');
    const badCode = await t.call('GET', `/auth/repo/callback?code=not-a-real-code&state=${state5}`, { cookies: e });
    assert.equal(badCode.status, 401);
    assert.ok(!badCode.text.includes('not-a-real-code'), 'the code is never echoed');
    assert.equal((await t.call('GET', '/api/github/status', { cookies: e })).json.connected, false);
  } finally { await t.close(); }
});

test('a foreign browser Origin is refused on every /api/github route; the Cockpit origin and no Origin pass', async () => {
  const t = await boot({ port: 49118, mockPort: 49119 });
  try {
    const cookies = t.session();
    const evil = { origin: 'https://evil.example' };
    for (const [m, u] of [['GET', '/api/github/status'], ['GET', '/api/github/repos'], ['POST', '/api/github/disconnect']]) {
      assert.equal((await t.call(m, u, { cookies, headers: evil, body: m === 'POST' ? {} : undefined })).status, 403, `${m} ${u}`);
    }
    assert.equal((await t.call('GET', '/api/github/status', { cookies, headers: { origin: ORIGIN } })).status, 200);
    assert.equal((await t.call('POST', '/api/github/disconnect', { cookies, headers: { origin: ORIGIN }, body: {} })).status, 200);
  } finally { await t.close(); }
});

test('sign-out wipes the connection (and Disconnect twice is harmless)', async () => {
  const t = await boot({ port: 49120, mockPort: 49121 });
  try {
    const cookies = t.session('alice');
    await t.connect(cookies);
    assert.equal((await t.call('GET', '/api/github/status', { cookies })).json.connected, true);
    assert.equal((await t.call('POST', '/auth/logout', { cookies, body: {} })).status, 200);
    assert.equal(t.connections.status('alice').connected, false);
    assert.equal(await t.connections.acquire('alice'), null);
    assert.equal((await t.call('POST', '/api/github/disconnect', { cookies: t.session('alice'), body: {} })).status, 200);
  } finally { await t.close(); }
});

test('an expiring token is refreshed on the server: the mock issues a new one, repos keep working, and the browser sees nothing of it', async () => {
  const t = await boot({ port: 49122, mockPort: 49123, mockOpts: { expiresIn: 30 } }); // inside the 60 s refresh margin from the start
  try {
    const cookies = t.session('alice');
    await t.connect(cookies);
    const before = t.mock.issued().length;
    const r = await t.call('GET', '/api/github/repos', { cookies });
    assert.equal(r.status, 200, r.text);
    assert.ok(t.mock.issued().length > before, 'a refresh happened (new access + refresh token issued)');
    assert.equal(r.json.repos.length, 3);
  } finally { await t.close(); }
});

test('an OAuth app (no installations endpoint) lists the person\'s repositories instead', async () => {
  const t = await boot({ port: 49124, mockPort: 49125, mockOpts: { kind: 'oauth' } });
  try {
    const cookies = t.session('alice');
    await t.connect(cookies);
    const r = await t.call('GET', '/api/github/repos', { cookies });
    assert.equal(r.json.source, 'user');
    assert.equal(r.json.repos.length, 3);
  } finally { await t.close(); }
});

test('a token the provider revoked behind our back: repos answers "connect again" and the store lets go of it', async () => {
  const t = await boot({ port: 49126, mockPort: 49127 });
  try {
    const cookies = t.session('alice');
    await t.connect(cookies);
    t.mock.expireAll();
    const r = await t.call('GET', '/api/github/repos', { cookies });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'NOT_CONNECTED');
    assert.equal((await t.call('GET', '/api/github/status', { cookies })).json.connected, false);
  } finally { await t.close(); }
});

test('POST /api/clone: useLogin xor token, a foreign host refused, no connection is NOT_CONNECTED, and a real clone with the login', async () => {
  const workspace = path.join(sandbox, 'ws');
  const fixtures = path.join(sandbox, 'fixtures');
  fs.mkdirSync(workspace);
  fs.mkdirSync(fixtures);
  const seed = path.join(sandbox, 'seed');
  fs.mkdirSync(seed);
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' };
  const g = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8', env }); assert.equal(r.status, 0, r.stderr); };
  g(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), '# hi\n');
  g(seed, 'add', '.');
  g(seed, 'commit', '-q', '-m', 'one');
  g(sandbox, 'clone', '-q', '--bare', seed, path.join(fixtures, 'fixture-app.git'));
  const t = await boot({ port: 49128, mockPort: 49129, workspace, localRoot: fixtures });
  try {
    const cookies = t.session('alice');
    const url = `file://${path.join(fixtures, 'fixture-app.git')}`;
    // Not connected yet.
    let r = await t.call('POST', '/api/clone', { cookies, body: { url, useLogin: true } });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'NOT_CONNECTED');
    await t.connect(cookies);
    const token = t.mock.issued().find((x) => x.startsWith('ghu_'));
    // Both at once.
    r = await t.call('POST', '/api/clone', { cookies, body: { url, useLogin: true, token: 'ghp_abcdefghijklmnop' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'BAD_AUTH_CHOICE');
    assert.ok(!r.text.includes('ghp_abcdefghijklmnop'), 'a pasted token is never echoed');
    // Wrong type.
    assert.equal((await t.call('POST', '/api/clone', { cookies, body: { url, useLogin: 'yes' } })).json.code, 'BAD_AUTH_CHOICE');
    // Not github.com.
    r = await t.call('POST', '/api/clone', { cookies, body: { url: 'https://evil.example/o/r', useLogin: true } });
    assert.equal(r.status, 403);
    // Another login has no connection: its useLogin finds none (the key comes from the session, not the body).
    r = await t.call('POST', '/api/clone', { cookies: t.session('bob'), body: { url, useLogin: true, sessionKey: 'alice', login: 'alice' } });
    assert.equal(r.json.code, 'NOT_CONNECTED');
    // The real thing (harness file:// source).
    r = await t.call('POST', '/api/clone', { cookies, body: { url, useLogin: true } });
    assert.equal(r.status, 202, r.text);
    assert.equal(r.json.job.via, 'login');
    assert.ok(!r.text.includes(token));
    await new Promise((res) => { const iv = setInterval(() => { if (t.jobs.get(r.json.job.id).state !== 'running') { clearInterval(iv); res(); } }, 50); });
    const job = (await t.call('GET', `/api/clone/${r.json.job.id}`, { cookies })).json.job;
    assert.equal(job.state, 'done', JSON.stringify(job));
    assert.ok(fs.existsSync(path.join(workspace, 'fixture-app', 'README.md')));
    // Pull with the login too.
    const p = await t.call('POST', '/api/clone/pull', { cookies, body: { name: 'fixture-app', useLogin: true } });
    assert.equal(p.status, 200, p.text);
    assert.equal(p.json.upToDate, true);
    assert.equal((await t.call('POST', '/api/clone/pull', { cookies, body: { name: 'fixture-app', useLogin: true, token: 'ghp_abcdefghijklmnop' } })).status, 400);
  } finally { await t.close(); }
});

test('GET /auth/repo/start refuses a cross-site navigation (Sec-Fetch-Site: cross-site) without starting anything; same-origin, same-site, none and no header pass', async () => {
  const t = await boot({ port: 49130, mockPort: 49131 });
  try {
    const begun = [];
    const orig = t.connections.begin;
    t.connections.begin = (key) => { begun.push(key); return orig(key); };
    for (const site of ['cross-site', 'Cross-Site', ' cross-site ']) {
      const r = await t.call('GET', '/auth/repo/start', { cookies: t.session('alice'), headers: { 'sec-fetch-site': site, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
      assert.equal(r.status, 403, site);
      assert.equal(r.json.code, 'cross_site');
      assert.equal(r.headers.get('location'), null, 'no redirect to GitHub');
      assert.equal(r.headers.getSetCookie().length, 0, 'no state cookie');
    }
    assert.deepEqual(begun, [], 'no state was started for the session');
    assert.deepEqual(t.mock.seen(), []);
    for (const site of ['same-origin', 'same-site', 'none', null]) {
      const r = await t.call('GET', '/auth/repo/start', { cookies: t.session('alice'), headers: site ? { 'sec-fetch-site': site } : {} });
      assert.equal(r.status, 302, String(site));
      assert.ok(r.headers.get('location').startsWith(t.mock.origin));
      assert.ok(r.headers.getSetCookie().some((c) => c.startsWith(`${REPO_STATE_COOKIE}=`)));
    }
    assert.equal(begun.length, 4);
    // A signed-out cross-site attempt is refused as cross-site too, before the session is even looked at.
    assert.equal((await t.call('GET', '/auth/repo/start', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  } finally { await t.close(); }
});

test('GET /api/github/repos: a second request inside the window makes no call to GitHub; Disconnect forgets the listing', async () => {
  const t = await boot({ port: 49132, mockPort: 49133 });
  try {
    const cookies = t.session('alice');
    await t.connect(cookies);
    const upstream = () => t.mock.seen().filter((r) => /^\/user\/(installations|repos)/.test(r.path)).length;
    const before = upstream();
    assert.equal((await t.call('GET', '/api/github/repos', { cookies })).json.repos.length, 3);
    const after = upstream();
    assert.equal(after - before, 3, 'installations + 2 installation listings');
    assert.equal((await t.call('GET', '/api/github/repos?q=notes', { cookies })).json.repos.length, 1);
    assert.equal((await t.call('GET', '/api/github/repos?page=2&per_page=2', { cookies })).json.repos.length, 1);
    assert.equal(upstream(), after, 'served from the session\'s listing');
    await t.call('POST', '/api/github/disconnect', { cookies, body: {} });
    await t.connect(cookies);
    assert.equal((await t.call('GET', '/api/github/repos', { cookies })).status, 200);
    assert.equal(upstream(), after + 3, 'a new connection lists afresh');
  } finally { await t.close(); }
});

test('no token the mock ever issued appears in any response, header, redirect or console line this file saw', () => {
  // The mocks issue tokens shaped ghu_/ghr_ + 36 hex; any such string in what this file saw is a leak.
  const all = transcript.join('\n') + '\n' + consoleLines.join('\n');
  assert.ok(transcript.length > 30, `saw ${transcript.length} exchanges`);
  assert.equal(/\bgh[ur]_[0-9a-f]{36}\b/.test(all), false, 'a token-shaped string was in a response or the console');
  assert.equal(all.includes(MOCK_CLIENT_SECRET), false, 'the client secret leaked');
});
