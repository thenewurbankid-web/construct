// #638 test double: a local http server standing in for github.com/login/oauth AND api.github.com, so the
// "Connect GitHub for private repositories" flow runs end to end with no network and no real app. Used by the server
// tests (imported: `startMockGithub`) and by the Playwright spec (run as a process: `node mock-github.mjs <port>`).
//
// It is deliberately strict where the real one is: an authorization code works once, an access token is only good
// until it expires or is revoked, an API call needs the token as a Bearer header, a refresh token works once. It is
// also a witness: `GET /__seen` reports every token it ever issued (test-only, so a test can grep the Cockpit's
// responses, files and logs for them) and every request it got, so a test can prove which calls carried a token.
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const MOCK_CLIENT_ID = 'mock-client-id';
export const MOCK_CLIENT_SECRET = 'mock-client-secret';

/**
 * @param {{ port?: number, kind?: 'app'|'oauth', login?: string, expiresIn?: number|null, refreshable?: boolean,
 *           repos?: {full_name:string, private:boolean}[], installations?: number, now?: () => number }} [opts]
 */
export async function startMockGithub({ port = 0, kind = 'app', login = 'octo-mock', expiresIn = 8 * 3600, refreshable = true, repos = [], installations = 1 } = {}) {
  const codes = new Map(); // code -> true (unused)
  const access = new Map(); // token -> expiresAtMs|null
  const refresh = new Map(); // refresh token -> true
  const issued = [];
  const seen = [];
  const rand = (p) => `${p}_${crypto.randomBytes(18).toString('hex')}`;

  const issue = () => {
    const token = rand('ghu');
    access.set(token, expiresIn ? Date.now() + expiresIn * 1000 : null);
    issued.push(token);
    const body = { access_token: token, token_type: 'bearer', scope: '' };
    if (expiresIn) body.expires_in = expiresIn;
    if (refreshable) {
      const r = rand('ghr');
      refresh.set(r, true);
      issued.push(r);
      body.refresh_token = r;
      body.refresh_token_expires_in = 15811200;
    }
    return body;
  };

  const bearerOk = (req) => {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!m || !access.has(m[1])) return false;
    const exp = access.get(m[1]);
    return exp === null || exp > Date.now();
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    let raw = '';
    for await (const c of req) raw += c;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
    const entry = { method: req.method, path: url.pathname, bearer: /^Bearer /.test(req.headers.authorization || ''), query: Object.fromEntries(url.searchParams) };
    if (!url.pathname.startsWith('/__')) seen.push(entry);
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (url.pathname === '/__seen') return json(200, { issued, seen });
    if (url.pathname === '/__expire' && req.method === 'POST') { for (const k of access.keys()) access.set(k, Date.now() - 1000); return json(200, { ok: true }); }

    if (url.pathname === '/login/oauth/authorize') {
      if (url.searchParams.get('client_id') !== MOCK_CLIENT_ID) return json(404, { error: 'unknown client' });
      const back = url.searchParams.get('redirect_uri') || '';
      const code = rand('code');
      codes.set(code, true);
      const target = new URL(back);
      target.searchParams.set('code', code);
      if (url.searchParams.get('state')) target.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { location: target.toString() });
      return res.end();
    }
    if (url.pathname === '/login/oauth/access_token' && req.method === 'POST') {
      if (!body || body.client_id !== MOCK_CLIENT_ID || body.client_secret !== MOCK_CLIENT_SECRET) return json(200, { error: 'incorrect_client_credentials' });
      if (body.grant_type === 'refresh_token') {
        if (!refresh.has(body.refresh_token)) return json(200, { error: 'bad_refresh_token' });
        refresh.delete(body.refresh_token);
        return json(200, issue());
      }
      if (!codes.has(body.code)) return json(200, { error: 'bad_verification_code' });
      codes.delete(body.code);
      return json(200, issue());
    }
    if (url.pathname === '/user') return bearerOk(req) ? json(200, { login, name: 'Octo Mock' }) : json(401, { message: 'Bad credentials' });
    if (url.pathname === '/user/installations') {
      if (!bearerOk(req)) return json(401, { message: 'Bad credentials' });
      if (kind !== 'app') return json(403, { message: 'You must authenticate with an access token authorized to a GitHub App' });
      return json(200, { total_count: installations, installations: Array.from({ length: installations }, (_v, i) => ({ id: i + 1 })) });
    }
    const inst = /^\/user\/installations\/(\d+)\/repositories$/.exec(url.pathname);
    if (inst) {
      if (!bearerOk(req)) return json(401, { message: 'Bad credentials' });
      const mine = repos.filter((_r, i) => (i % installations) + 1 === Number(inst[1]));
      return json(200, { total_count: mine.length, repositories: mine });
    }
    if (url.pathname === '/user/repos') return bearerOk(req) ? json(200, repos) : json(401, { message: 'Bad credentials' });
    if (req.method === 'DELETE' && url.pathname === `/applications/${MOCK_CLIENT_ID}/token`) {
      if (body?.access_token) access.delete(body.access_token);
      res.writeHead(204);
      return res.end();
    }
    return json(404, { message: 'Not Found' });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    issued: () => [...issued],
    seen: () => [...seen],
    /** Every live token stops working. */
    expireAll: () => { for (const k of access.keys()) access.set(k, Date.now() - 1000); },
    isLive: (t) => access.has(t) && (access.get(t) === null || access.get(t) > Date.now()),
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

// `node mock-github.mjs <port> [app|oauth]`: the Playwright spec's mock, with a few repositories to pick from.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]);
  const kind = process.argv[3] === 'oauth' ? 'oauth' : 'app';
  const mock = await startMockGithub({
    port, kind,
    repos: [
      { full_name: 'octo-mock/private-notes', private: true },
      { full_name: 'octo-mock/fixture-app', private: true },
      { full_name: 'octo-org/public-site', private: false },
    ],
    installations: 2,
  });
  console.log(`mock github listening on ${mock.origin}`);
  const stop = () => mock.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
