// #638 -- the HTTP surface of "Connect GitHub for private repositories" (repoConnection.mjs holds the token).
//
// Two mounts, both built here so the rules are read in one place:
//   * mountRepoAuthRoutes(app, ...)   /auth/repo/start and /auth/repo/callback. Outside `/api` because the browser
//     navigates to them (and GitHub navigates back), so they cannot sit behind the JSON gate; each therefore checks
//     the Cockpit session itself and answers as if it did not exist when the feature is off.
//   * createGithubRouter(...)         /api/github/status, /repos, /disconnect. Mount it AFTER
//     `app.use('/api', auth.requireSession)` (index.mjs does): every route refuses a foreign browser Origin and the
//     mutating one refuses to run when the session gate did not.
//
// Nothing here returns, logs or redirects with a token. The authorization `code` and `state` in the callback URL are
// single-use and are never written anywhere.
import express from 'express';
import crypto from 'node:crypto';
import { parseCookies, serializeCookie, signValue, verifyValue } from './auth.mjs';
import { guard } from './cloneApi.mjs';
import { sessionKeyOf } from './repoConnection.mjs';

export const REPO_STATE_COOKIE = 'construct_repo_oauth_state';
const STATE_COOKIE_TTL_MS = 10 * 60 * 1000;

const notFound = (res) => res.status(404).json({ ok: false, error: 'Not found.' });

/** `/auth/repo/*` on the app. `auth` is the createAuth() object (session check, secrets, error page). */
export function mountRepoAuthRoutes(app, { connections, auth, clientOrigin }) {
  const cookieOpts = { path: '/auth/repo', secure: auth.config.secureCookies };
  const clearState = (res) => res.append('Set-Cookie', serializeCookie(REPO_STATE_COOKIE, '', { ...cookieOpts, maxAge: 0 }));

  /** The session key of this browser request, or null when login is required and there is no valid session. */
  const keyOf = (req) => {
    if (!auth.required) return '';
    const s = auth.sessionFromHeaders(req.headers);
    return s ? sessionKeyOf(s) : null;
  };

  app.get('/auth/repo/start', (req, res) => {
    if (!connections.enabled) return notFound(res);
    const key = keyOf(req);
    if (key === null) return res.status(401).json({ ok: false, code: 'auth_required', error: 'Sign in to the Cockpit first.', loginPath: '/auth/login' });
    const begun = connections.begin(key);
    // The state also travels in a signed, httpOnly, short-lived cookie (as the sign-in flow does), on top of being
    // bound to this session on the server: both must match when GitHub sends the browser back.
    res.append('Set-Cookie', serializeCookie(REPO_STATE_COOKIE, signValue({ state: begun.state, exp: Date.now() + STATE_COOKIE_TTL_MS }, auth.config.sessionSecret), { ...cookieOpts, maxAge: STATE_COOKIE_TTL_MS / 1000 }));
    return res.redirect(302, begun.url);
  });

  app.get('/auth/repo/callback', async (req, res) => {
    if (!connections.enabled) return notFound(res);
    const fail = (status, title, detail) => auth.sendError(res, status, title, detail);
    // Spent first and unconditionally, whatever happens next.
    const cookieValue = parseCookies(req.headers?.cookie)[REPO_STATE_COOKIE];
    clearState(res);
    const state = typeof req.query?.state === 'string' ? req.query.state : '';
    const key = keyOf(req);
    if (key === null) {
      connections.consumeState('', state); // spend it; nobody can use it now
      return fail(401, 'Sign in first', 'Your Cockpit session is not signed in, so GitHub could not be connected. Sign in and start again.');
    }
    const fromCookie = verifyValue(cookieValue, auth.config.sessionSecret, Date.now());
    const a = Buffer.from(state, 'utf8');
    const b = Buffer.from(typeof fromCookie?.state === 'string' ? fromCookie.state : '', 'utf8');
    if (b.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      connections.consumeState(key, state);
      return fail(400, 'GitHub could not be connected', 'The connection request did not match, or it expired or was already used. Start it again from the Cockpit.');
    }
    if (typeof req.query?.error === 'string') {
      connections.consumeState(key, state);
      return fail(403, 'GitHub was not connected', 'Access was not granted on GitHub, so nothing was connected. You can try again from the Cockpit.');
    }
    const done = await connections.complete({ key, state, code: typeof req.query?.code === 'string' ? req.query.code : '' });
    if (!done.ok) return fail(done.code === 'BAD_STATE' ? 400 : 401, 'GitHub could not be connected', done.error);
    return res.redirect(302, clientOrigin);
  });
}

/** `/api/github/*` (below the session gate). */
export function createGithubRouter({ connections, clientOrigin }) {
  const router = express.Router();
  router.use((req, res, next) => guard(clientOrigin, req.method !== 'GET')(req, res, next));

  // The one route that answers when the feature is off, and then with nothing beyond `enabled:false`.
  router.get('/status', (req, res) => res.json({ ok: true, ...connections.status(sessionKeyOf(req.session)) }));

  router.get('/repos', async (req, res) => {
    if (!connections.enabled) return notFound(res);
    const int = (v, d) => (typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : d);
    const r = await connections.listRepos(sessionKeyOf(req.session), { page: int(req.query.page, 1), perPage: int(req.query.per_page, 30), q: typeof req.query.q === 'string' ? req.query.q : '' });
    if (!r.ok) return res.status(r.status).json({ ok: false, code: r.code, error: r.error });
    return res.json(r);
  });

  router.post('/disconnect', async (req, res) => {
    if (!connections.enabled) return notFound(res);
    await connections.disconnect(sessionKeyOf(req.session));
    return res.json({ ok: true, ...connections.status(sessionKeyOf(req.session)) });
  });

  router.use((req, res) => notFound(res));
  return router;
}
