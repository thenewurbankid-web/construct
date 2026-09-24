// #638 -- "Connect GitHub for private repositories": a second, opt-in consent that lets the Cockpit clone a private
// repository with the signed-in person's own GitHub access, with no token pasted.
//
// Sign-in (auth.mjs) stays identity-only (`read:user`) and is not touched. This is a SEPARATE authorization-code
// flow against a dedicated app (a GitHub App preferred, an OAuth app works: the code is a standard code exchange and
// the app's own permissions define what the token can read), configured by CONSTRUCT_GITHUB_REPO_CLIENT_ID and
// CONSTRUCT_GITHUB_REPO_CLIENT_SECRET. Unset means the feature does not exist: no route answers, no status says more
// than `{enabled:false}`.
//
// Where the token lives, and the rule that everything below serves: ONLY here, in this process's memory, per
// session key (the signed-in login; '' when the Cockpit runs without login on loopback).
//   * never on disk, in a cookie, a job record, a log line, an error message or any API response;
//   * held as a Buffer (the caller of acquire() gets a COPY it must zero), zeroed on removal;
//   * never outlives its own expiry (`expires_in`, or the refresh token's), never outlives the Cockpit session's
//     lifetime (`maxTtlMs`), wiped on sign-out, on Disconnect, on a provider refusal and on server stop;
//   * an expiring token is refreshed here, server-side, shortly before it runs out.
// The token leaves this module in exactly two ways: as a Bearer header on a call to the configured provider API
// (the repository list, refresh and revoke), and as a Buffer copy handed to a clone/pull job, which pipes it into
// git's GIT_ASKPASS (cloneAuth.mjs) and only for github.com URLs (cloneJobs.mjs).
import crypto from 'node:crypto';
import { AuthConfigError, isLoopbackHost } from './auth.mjs';

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

export const DEFAULT_OAUTH_BASE = 'https://github.com';
export const DEFAULT_API_BASE = 'https://api.github.com';
export const PENDING_TTL_MS = 10 * 60 * 1000;
/** Refresh an expiring access token this long before it runs out. */
export const REFRESH_MARGIN_MS = 60 * 1000;
export const REQUEST_TIMEOUT_MS = 8000;
const SWEEP_MS = 30 * 1000;
const MAX_PENDING = 500;
/** #638 review: pending states ONE session may hold; the oldest of that session goes first, so a session that keeps
 * starting connections evicts its own, never another session's in-flight one. The global cap stays as the backstop. */
export const MAX_PENDING_PER_KEY = 3;
/** #638 review: how long a session's repository listing is kept, so a picker that refreshes, filters or pages does not
 * fan out to GitHub (up to 1 + installations x pages calls) on every request. Forgotten with the connection. */
export const REPOS_CACHE_MS = 60 * 1000;
const MAX_INSTALLATIONS = 20;
const MAX_PAGES = 3; // pages of 100 per listing
const MAX_REPOS = 1000;
const FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/;

/** The key a session's connection is stored under: the signed-in login (lower case), '' with no login (local run). */
export const sessionKeyOf = (session) => String(session?.login ?? '').toLowerCase();

/**
 * Resolve the feature's configuration from the environment.
 *   CONSTRUCT_GITHUB_REPO_CLIENT_ID / _SECRET   both set -> enabled; neither -> off; one only -> off, with a warning.
 *   CONSTRUCT_GITHUB_REPO_CALLBACK_URL          default: the sign-in callback URL with /auth/callback -> /auth/repo/callback,
 *                                               else http://localhost:<port>/auth/repo/callback
 *   CONSTRUCT_GITHUB_REPO_SCOPE                 optional; only an OAuth app needs it (e.g. `repo`); a GitHub App ignores it.
 *   CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE / _API_BASE   TEST HARNESS ONLY: a mock standing in for github.com and
 *                                               api.github.com. Refused off loopback, like CONSTRUCT_E2E_CLONE_LOCAL_ROOT.
 */
export function resolveRepoConnectionConfig(env = process.env, { host = '127.0.0.1', port = 4000 } = {}) {
  const clientId = trimmed(env.CONSTRUCT_GITHUB_REPO_CLIENT_ID);
  const clientSecret = trimmed(env.CONSTRUCT_GITHUB_REPO_CLIENT_SECRET);
  const enabled = Boolean(clientId && clientSecret);
  const halfConfigured = Boolean(clientId) !== Boolean(clientSecret);
  let oauthBase = DEFAULT_OAUTH_BASE;
  let apiBase = DEFAULT_API_BASE;
  const oBase = trimmed(env.CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE);
  const aBase = trimmed(env.CONSTRUCT_E2E_GITHUB_REPO_API_BASE);
  if (oBase || aBase) {
    // Same two refusals as CONSTRUCT_AUTH_TEST_USER (auth.mjs): never in production (case-insensitively, as there),
    // never off loopback. These seams point the person's GitHub login at another server.
    if (trimmed(env.NODE_ENV).toLowerCase() === 'production') {
      throw new AuthConfigError('CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE / _API_BASE are set while NODE_ENV=production. They point the GitHub connection at a stand-in for github.com and exist only for the e2e suite — refusing to start rather than send a login somewhere that is not GitHub. Unset them.');
    }
    if (!isLoopbackHost(host)) {
      throw new AuthConfigError('CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE / _API_BASE are test-harness settings and are refused when the server is exposed beyond loopback.');
    }
    for (const [name, v] of [['OAUTH_BASE', oBase], ['API_BASE', aBase]]) {
      if (v && !/^https?:\/\/[^/\s]+$/.test(v)) throw new AuthConfigError(`CONSTRUCT_E2E_GITHUB_REPO_${name} must be an http(s) origin with no path.`);
    }
    oauthBase = oBase || oauthBase;
    apiBase = aBase || apiBase;
  }
  const signInCallback = trimmed(env.CONSTRUCT_OAUTH_CALLBACK_URL);
  const callbackUrl = trimmed(env.CONSTRUCT_GITHUB_REPO_CALLBACK_URL)
    || (signInCallback.endsWith('/auth/callback') ? `${signInCallback.slice(0, -'/auth/callback'.length)}/auth/repo/callback` : `http://localhost:${port}/auth/repo/callback`);
  return {
    enabled, halfConfigured, clientId, clientSecret, callbackUrl,
    scope: trimmed(env.CONSTRUCT_GITHUB_REPO_SCOPE),
    authorizeUrl: `${oauthBase}/login/oauth/authorize`,
    tokenUrl: `${oauthBase}/login/oauth/access_token`,
    apiBase,
  };
}

const wipe = (buf) => { if (Buffer.isBuffer(buf)) buf.fill(0); };
const bufOf = (s) => Buffer.from(s, 'latin1');
const strOf = (buf) => buf.toString('latin1');

/**
 * @param {ReturnType<typeof resolveRepoConnectionConfig>} config
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, randomToken?: () => string, maxTtlMs?: number,
 *           timeoutMs?: number, sweepMs?: number, registerExit?: boolean }} [deps]
 *   `maxTtlMs`: the longest a connection may live (the Cockpit session's own lifetime).
 */
export function createRepoConnections(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const now = deps.now || (() => Date.now());
  const randomToken = deps.randomToken || (() => crypto.randomBytes(24).toString('base64url'));
  const maxTtlMs = deps.maxTtlMs > 0 ? deps.maxTtlMs : 8 * 60 * 60 * 1000;
  const timeoutMs = deps.timeoutMs > 0 ? deps.timeoutMs : REQUEST_TIMEOUT_MS;
  const enabled = Boolean(config.enabled);

  /** state -> { key, exp }: an authorization this server started and has not seen come back yet. */
  const pending = new Map();
  /** key -> { access: Buffer, accessExp: number|null, refresh: Buffer|null, hardExp: number, login: string, refreshing: Promise|null,
   *            repos: {at, all, source, truncated, installations}|null (the last listing, REPOS_CACHE_MS), listing: Promise|null (a fan-out in flight) } */
  const conns = new Map();
  let timer = null;

  function wipeEntry(e) {
    wipe(e.access);
    wipe(e.refresh);
  }

  function wipeKey(key) {
    const e = conns.get(key);
    if (!e) return false;
    conns.delete(key);
    wipeEntry(e);
    return true;
  }

  function wipeAll() {
    for (const e of conns.values()) wipeEntry(e);
    conns.clear();
    pending.clear();
  }

  function sweep() {
    const t = now();
    for (const [k, e] of conns) if (t >= e.hardExp) wipeKey(k);
    for (const [s, p] of pending) if (t >= p.exp) pending.delete(s);
  }

  function ensureSweeper() {
    if (timer) return;
    timer = setInterval(sweep, deps.sweepMs > 0 ? deps.sweepMs : SWEEP_MS);
    timer.unref?.();
  }

  /** Stop the sweeper and wipe everything (tests; also what "server stop" does). */
  function close() {
    if (timer) clearInterval(timer);
    timer = null;
    wipeAll();
    if (deps.registerExit !== false) process.removeListener('exit', wipeAll);
  }
  if (enabled && deps.registerExit !== false) process.once('exit', wipeAll); // server stop

  /** One call to the configured provider. Never follows a redirect (a 3xx is a failure), always bounded in time. Never
   * throws. -> { status, json } | null (network error, timeout, unreadable answer). */
  async function call(url, { method = 'GET', headers = {}, body } = {}) {
    try {
      const res = await fetchImpl(url, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'User-Agent': 'construct-cockpit', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* an empty or non-JSON answer */ }
      return { status: res.status, json };
    } catch {
      return null;
    }
  }

  const bearer = (buf) => ({ Authorization: `Bearer ${strOf(buf)}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

  /** A token answer -> a fresh entry (buffers made, times worked out), or null when it holds no usable token. */
  function readTokenAnswer(res) {
    const b = res?.json;
    if (!res || res.status !== 200 || !b || typeof b !== 'object' || b.error || typeof b.access_token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(b.access_token)) return null;
    const t = now();
    const secs = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) * 1000 : null);
    const accessExp = secs(b.expires_in) === null ? null : t + secs(b.expires_in);
    const refresh = typeof b.refresh_token === 'string' && /^[\x21-\x7e]{1,4096}$/.test(b.refresh_token) ? b.refresh_token : null;
    const refreshExp = refresh && secs(b.refresh_token_expires_in) !== null ? t + secs(b.refresh_token_expires_in) : null;
    // The connection ends with whichever is last-usable: the refresh token when there is one, else the access token;
    // and never later than the Cockpit session's own lifetime.
    const own = refresh ? (refreshExp ?? Infinity) : (accessExp ?? Infinity);
    return { access: bufOf(b.access_token), accessExp, refresh: refresh ? bufOf(refresh) : null, hardExp: Math.min(t + maxTtlMs, own) };
  }

  // ---- authorization ----------------------------------------------------------------------------------------------

  /** Start an authorization for this session: -> { state, url } (the provider page to send the browser to). */
  function begin(key) {
    if (!enabled) return null;
    sweep();
    const mine = [...pending].filter(([, p]) => p.key === key).map(([s]) => s); // insertion order: oldest first
    if (mine.length >= MAX_PENDING_PER_KEY) pending.delete(mine[0]);
    if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
    const state = randomToken();
    pending.set(state, { key, exp: now() + PENDING_TTL_MS });
    ensureSweeper();
    const url = new URL(config.authorizeUrl);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.callbackUrl);
    url.searchParams.set('state', state);
    if (config.scope) url.searchParams.set('scope', config.scope);
    url.searchParams.set('allow_signup', 'false');
    return { state, url: url.toString() };
  }

  /** The state is consumed FIRST and unconditionally: a replayed callback finds nothing, and a state started by
   * another session is spent (not merely refused) the moment it is presented. -> true only for this session's own,
   * unexpired, never-used state. */
  function consumeState(key, state) {
    const p = typeof state === 'string' ? pending.get(state) : undefined;
    if (p) pending.delete(state);
    return Boolean(p) && p.exp > now() && p.key === key;
  }

  /** Finish an authorization: exchange the code, learn whose GitHub account it is, keep the token in memory.
   * -> { ok:true, login } | { ok:false, code, error } (fixed wording; nothing from the provider is echoed). */
  async function complete({ key, state, code }) {
    if (!enabled) return { ok: false, code: 'DISABLED', error: 'GitHub connection is not configured on this server.' };
    if (!consumeState(key, state)) {
      return { ok: false, code: 'BAD_STATE', error: 'The connection request did not match, or it expired or was already used. Start it again from the Cockpit.' };
    }
    if (typeof code !== 'string' || code === '' || code.length > 512) return { ok: false, code: 'NO_CODE', error: 'GitHub did not return an authorization code.' };
    const res = await call(config.tokenUrl, { method: 'POST', body: { client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.callbackUrl } });
    const entry = readTokenAnswer(res);
    if (!entry) return { ok: false, code: 'EXCHANGE_FAILED', error: 'GitHub refused the connection. The code may have expired or already been used. Start it again from the Cockpit.' };
    const me = await call(`${config.apiBase}/user`, { headers: bearer(entry.access) });
    const login = me?.status === 200 && typeof me.json?.login === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(me.json.login) ? me.json.login : null;
    if (!login) {
      wipeEntry(entry);
      return { ok: false, code: 'IDENTIFY_FAILED', error: 'The connected GitHub account could not be identified.' };
    }
    wipeKey(key); // a second connect replaces the first
    conns.set(key, { ...entry, login, refreshing: null, repos: null, listing: null });
    ensureSweeper();
    return { ok: true, login };
  }

  // ---- reading the connection --------------------------------------------------------------------------------------

  function status(key) {
    if (!enabled) return { enabled: false, connected: false };
    sweep();
    const e = conns.get(key);
    return e ? { enabled: true, connected: true, login: e.login } : { enabled: true, connected: false };
  }

  async function refreshEntry(key, e) {
    if (e.refreshing) return e.refreshing;
    const p = (async () => {
      const res = await call(config.tokenUrl, {
        method: 'POST',
        body: { client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: strOf(e.refresh) },
      });
      const next = readTokenAnswer(res);
      if (!next) {
        // A refusal means the connection is over (revoked, or the refresh token ran out); a timeout might not, so it
        // is kept until its own expiry and the caller falls back to the access token it still has.
        if (res && res.status >= 400 && res.status < 500 || (res && res.status === 200 && res.json?.error)) wipeKey(key);
        return false;
      }
      if (conns.get(key) !== e) { wipeEntry(next); return false; } // wiped (sign-out, Disconnect) while we asked
      wipe(e.access);
      wipe(e.refresh);
      e.access = next.access;
      e.accessExp = next.accessExp;
      e.refresh = next.refresh;
      e.hardExp = next.hardExp;
      return true;
    })();
    e.refreshing = p;
    try { return await p; } finally { e.refreshing = null; }
  }

  /** A Buffer COPY of the session's current access token (the caller zeroes it), refreshed first when it is about to
   * expire, or null when there is no live connection. */
  async function acquire(key) {
    if (!enabled) return null;
    const e = conns.get(key);
    if (!e) return null;
    if (now() >= e.hardExp) { wipeKey(key); return null; }
    if (e.accessExp !== null && now() >= e.accessExp - REFRESH_MARGIN_MS) {
      if (e.refresh) await refreshEntry(key, e);
      if (conns.get(key) !== e) return null;
      if (e.accessExp !== null && now() >= e.accessExp) { wipeKey(key); return null; }
    }
    return Buffer.from(e.access);
  }

  /** Disconnect: zero the token now, and ask the provider to revoke it (best effort, never blocks or fails this). */
  async function disconnect(key) {
    const e = conns.get(key);
    if (!e) return { ok: true, wasConnected: false };
    const copy = Buffer.from(e.access);
    wipeKey(key);
    try {
      await call(`${config.apiBase}/applications/${encodeURIComponent(config.clientId)}/token`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, Accept: 'application/vnd.github+json' },
        body: { access_token: strOf(copy) },
      });
    } finally {
      wipe(copy);
    }
    return { ok: true, wasConnected: true };
  }

  // ---- what the connection can read ------------------------------------------------------------------------------

  /** Every page of one listing (bounded); -> { ok:true, items } | { ok:false, status } (status 0 = unreachable). */
  async function pages(path, pick, tok, limit) {
    const items = [];
    for (let page = 1; page <= MAX_PAGES && items.length < limit; page += 1) {
      const r = await call(`${config.apiBase}${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, { headers: bearer(tok) });
      if (!r) return { ok: false, status: 0 };
      if (r.status !== 200) return { ok: false, status: r.status };
      const got = pick(r.json);
      items.push(...got);
      if (got.length < 100) break;
    }
    return { ok: true, items };
  }

  const repoOf = (x) => {
    if (!x || typeof x !== 'object' || typeof x.full_name !== 'string' || !FULL_NAME.test(x.full_name)) return null;
    const [owner, name] = x.full_name.split('/');
    return { fullName: x.full_name, owner, name, private: x.private === true };
  };

  /**
   * The repositories the connection can read: names and visibility only. For a GitHub App the installations the person
   * can use and the repositories of each; for an OAuth app (the installations endpoint refuses its tokens) the
   * person's own repositories. -> { ok:true, repos, page, perPage, total, hasMore, truncated, source } | { ok:false, status, code, error }
   */
  async function listRepos(key, { page = 1, perPage = 30, q = '' } = {}) {
    if (!enabled) return { ok: false, status: 404, code: 'DISABLED', error: 'Not found.' };
    const tok = await acquire(key);
    if (!tok) return { ok: false, status: 409, code: 'NOT_CONNECTED', error: 'GitHub is not connected. Connect it first.' };
    try {
      const e = conns.get(key);
      if (!e) return { ok: false, status: 409, code: 'NOT_CONNECTED', error: 'GitHub is not connected. Connect it first.' };
      let listing = e.repos && now() - e.repos.at < REPOS_CACHE_MS ? e.repos : null;
      if (!listing) {
        // One fan-out per session at a time: a request that arrives while one is in flight gets that one's answer.
        if (!e.listing) {
          e.listing = fetchListing(key, tok)
            .then((r) => { if (r.ok && conns.get(key) === e) e.repos = r; return r; })
            .finally(() => { e.listing = null; });
        }
        const r = await e.listing;
        if (!r.ok) return r; // a failure is answered, never kept
        listing = r;
      }
      const needle = String(q ?? '').trim().toLowerCase().slice(0, 100);
      const all = needle ? listing.all.filter((r) => r.fullName.toLowerCase().includes(needle)) : listing.all;
      const size = Math.min(100, Math.max(1, Number.isInteger(perPage) ? perPage : 30));
      const pg = Math.max(1, Number.isInteger(page) ? page : 1);
      const start = (pg - 1) * size;
      return { ok: true, repos: all.slice(start, start + size), page: pg, perPage: size, total: all.length, hasMore: start + size < all.length, truncated: listing.truncated, source: listing.source, installations: listing.installations };
    } finally {
      wipe(tok);
    }
  }

  /** The fan-out itself (`tok` stays the caller's to zero): -> { ok:true, at, all (sorted, de-duplicated), source, truncated, installations } | { ok:false, status, code, error } */
  async function fetchListing(key, tok) {
    let source = 'installations';
    let found = [];
    let truncated = false;
    const inst = await pages('/user/installations', (j) => (Array.isArray(j?.installations) ? j.installations : []), tok, MAX_INSTALLATIONS);
    if (!inst.ok && inst.status === 0) return { ok: false, status: 502, code: 'GITHUB_UNREACHABLE', error: 'GitHub did not answer in time.' };
    if (!inst.ok && inst.status === 401) {
      wipeKey(key);
      return { ok: false, status: 409, code: 'NOT_CONNECTED', error: 'GitHub no longer accepts this connection (it was revoked or expired). Connect again.' };
    }
    if (inst.ok) {
      const ids = inst.items.map((i) => i?.id).filter((id) => Number.isInteger(id) && id > 0).slice(0, MAX_INSTALLATIONS);
      for (const id of ids) {
        const r = await pages(`/user/installations/${id}/repositories`, (j) => (Array.isArray(j?.repositories) ? j.repositories : []), tok, MAX_REPOS - found.length);
        if (!r.ok) return { ok: false, status: 502, code: 'GITHUB_FAILED', error: 'GitHub could not list the repositories.' };
        found.push(...r.items);
        if (found.length >= MAX_REPOS) { truncated = true; break; }
      }
    } else {
      // Not a GitHub App token (403/404/422): an OAuth app's token lists the person's repositories directly.
      source = 'user';
      const r = await pages('/user/repos?sort=full_name&affiliation=owner,collaborator,organization_member', (j) => (Array.isArray(j) ? j : []), tok, MAX_REPOS);
      if (!r.ok) return r.status === 0
        ? { ok: false, status: 502, code: 'GITHUB_UNREACHABLE', error: 'GitHub did not answer in time.' }
        : { ok: false, status: 502, code: 'GITHUB_FAILED', error: 'GitHub could not list the repositories.' };
      found = r.items;
      truncated = found.length >= MAX_REPOS;
    }
    const byName = new Map();
    for (const x of found) { const r = repoOf(x); if (r) byName.set(r.fullName.toLowerCase(), r); }
    const all = [...byName.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
    return { ok: true, at: now(), all, source, truncated, installations: source === 'installations' ? inst.items.length : null };
  }

  return { enabled, config, begin, complete, consumeState, status, acquire, disconnect, wipeKey, wipeAll, listRepos, close, sweep };
}
