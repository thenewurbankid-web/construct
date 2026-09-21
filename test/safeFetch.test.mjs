// #436 -- safeFetch attacked with hostile input. Network is never touched: DNS is a fake resolver and the transport is
// a local http server behind a seam that still exercises the REAL guarded `lookup` hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isPublicAddress, safeFetch } from '../src/engine/safeFetch.mjs';

const HOST = 'files.example.com';
const PUBLIC = '93.184.216.34';

/** Start a local server; `handler(req,res)`. Returns { requests, connectedTo, request(seam), close }. */
async function server(handler) {
  const requests = [];
  const srv = http.createServer((req, res) => { requests.push({ url: req.url, headers: req.headers }); handler(req, res); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = /** @type {any} */ (srv.address());
  const connectedTo = [];
  // Test-only transport: asks the guarded lookup for the address (as the socket would), records it, then talks to
  // the local server instead of the internet.
  const request = (opts, cb) => {
    const out = new http.ClientRequest({ host: '127.0.0.1', port, path: opts.path, method: 'GET', headers: opts.headers, agent: false }, cb);
    const realEnd = out.end.bind(out);
    out.end = (...a) => {
      opts.lookup(opts.hostname, { all: true }, (err, list) => {
        if (err) return out.destroy(err);
        connectedTo.push(list[0].address);
        return realEnd(...a);
      });
      return out;
    };
    return out;
  };
  return { requests, connectedTo, request, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}
const answers = (...a) => async () => a.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const opts = (s, extra = {}) => ({ allowHosts: [HOST], resolver: answers(PUBLIC), _request: s.request, timeoutMs: 3000, ...extra });

test('happy path: a public host is fetched, and the connection goes to the checked address', async () => {
  const s = await server((_q, res) => { res.setHeader('content-type', 'text/plain'); res.end('hello'); });
  try {
    const r = await safeFetch(`https://${HOST}/a?b=1`, opts(s, { allowContentTypes: ['text/plain'] }));
    assert.equal(r.ok, true); assert.equal(r.body.toString(), 'hello'); assert.deepEqual(s.connectedTo, [PUBLIC]);
    assert.equal(s.requests[0].url, '/a?b=1');
    assert.equal(s.requests[0].headers.cookie, undefined); assert.equal(s.requests[0].headers.authorization, undefined);
    assert.equal(s.requests[0].headers.connection, 'close'); assert.equal(s.requests[0].headers['accept-encoding'], 'identity');
  } finally { await s.close(); }
});

test('the guard cannot be switched off: no allow-list, http, port, userinfo, foreign host', async () => {
  const s = await server((_q, res) => res.end('x'));
  try {
    assert.equal((await safeFetch(`https://${HOST}/`, { resolver: answers(PUBLIC), _request: s.request })).code, 'NO_ALLOWLIST');
    assert.equal((await safeFetch(`https://${HOST}/`, { allowHosts: [], _request: s.request })).code, 'NO_ALLOWLIST');
    assert.equal((await safeFetch(`http://${HOST}/`, opts(s))).code, 'BAD_SCHEME');
    assert.equal((await safeFetch(`http://${HOST}/`, opts(s, { allowSchemes: ['http:', 'https:'] }))).code, 'BAD_SCHEME');
    assert.equal((await safeFetch(`https://${HOST}:8443/`, opts(s))).code, 'BAD_URL');
    assert.equal((await safeFetch(`https://u:p@${HOST}/`, opts(s))).code, 'BAD_URL');
    assert.equal((await safeFetch('https://evil.example.org/', opts(s))).code, 'HOST_NOT_ALLOWED');
    assert.equal((await safeFetch(`https://${HOST}@evil.example.org/`, opts(s))).code, 'BAD_URL');
    assert.equal((await safeFetch('file:///etc/passwd', opts(s))).code, 'BAD_SCHEME');
    assert.equal((await safeFetch(`https://${HOST}/ x`, opts(s))).code, 'BAD_URL');
    assert.equal(s.requests.length, 0);
  } finally { await s.close(); }
});

test('decimal, hex, octal and short IPv4 forms normalise to loopback and are refused even when allow-listed', async () => {
  const s = await server((_q, res) => res.end('x'));
  try {
    for (const bad of ['2130706433', '0x7f000001', '0177.0.0.1', '127.1', '0x7f.1', '017700000001', '0']) {
      const normalised = new URL(`https://${bad}/`).hostname;
      const r = await safeFetch(`https://${bad}/`, opts(s, { allowHosts: [normalised] }));
      assert.equal(r.code, 'NOT_PUBLIC', `${bad} -> ${normalised}`);
      assert.equal((await safeFetch(`https://${bad}/`, opts(s))).code, 'HOST_NOT_ALLOWED');
    }
    for (const bad of ['[::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[64:ff9b::7f00:1]', '[2002:7f00:1::]', '[fe80::1]', '[fd00::1]', '[::]']) {
      const host = new URL(`https://${bad}/`).hostname.replace(/[[\]]/g, '');
      assert.equal((await safeFetch(`https://${bad}/`, opts(s, { allowHosts: [host] }))).code, 'NOT_PUBLIC', bad);
    }
    assert.equal(s.requests.length, 0);
  } finally { await s.close(); }
});

test('isPublicAddress: IPv6 mapped, NAT64 and 6to4 are judged by the IPv4 they embed', () => {
  for (const bad of ['::ffff:10.0.0.1', '::ffff:a00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', '2002:c0a8:1::', '::10.0.0.1', '169.254.169.254', '::ffff:169.254.169.254', 'fd00:ec2::254', '100.64.0.1', '192.0.2.1', '2001:db8::1', 'not-an-ip', '', '[::1]']) assert.equal(isPublicAddress(bad), false, bad);
  for (const good of ['93.184.216.34', '8.8.8.8', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::', '2606:4700:4700::1111']) assert.equal(isPublicAddress(good), true, good);
});

test('DNS answering mixed public + private is refused whole (nothing is connected to)', async () => {
  const s = await server((_q, res) => res.end('x'));
  try {
    for (const mix of [[PUBLIC, '10.0.0.5'], ['10.0.0.5', PUBLIC], [PUBLIC, '::ffff:127.0.0.1'], [PUBLIC, '169.254.169.254']]) {
      const r = await safeFetch(`https://${HOST}/`, opts(s, { resolver: answers(...mix) }));
      assert.equal(r.code, 'NOT_PUBLIC', mix.join('+'));
    }
    assert.equal(s.requests.length, 0);
    assert.equal((await safeFetch(`https://${HOST}/`, opts(s, { resolver: answers() }))).code, 'DNS_FAILED');
    assert.equal((await safeFetch(`https://${HOST}/`, opts(s, { resolver: async () => { throw new Error('ENOTFOUND'); } }))).code, 'DNS_FAILED');
  } finally { await s.close(); }
});

test('DNS rebinding: a resolver that answers public first and private after is asked once per connection, and the checked answer is the one used', async () => {
  const s = await server((_q, res) => res.end('ok'));
  try {
    let calls = 0;
    const rebinding = async () => { calls += 1; return [{ address: calls === 1 ? PUBLIC : '127.0.0.1', family: 4 }]; };
    const first = await safeFetch(`https://${HOST}/`, opts(s, { resolver: rebinding }));
    assert.equal(first.ok, true);
    assert.deepEqual(s.connectedTo, [PUBLIC]); // connected to what was checked
    assert.equal(calls, 1); // one resolution per hop: no separate "check" resolve that could differ from the "connect" one
    const second = await safeFetch(`https://${HOST}/`, opts(s, { resolver: rebinding }));
    assert.equal(second.code, 'NOT_PUBLIC'); // the second connection re-resolves (no pooling) and is refused
    assert.equal(s.requests.length, 1);
  } finally { await s.close(); }
});

test('a redirect is re-validated per hop: to 127.0.0.1, to http, to a private-resolving host, to a foreign host', async () => {
  const s = await server((q, res) => { res.statusCode = 302; res.setHeader('location', decodeURIComponent(q.url.slice(1))); res.end(); });
  try {
    const to = (loc, extra = {}) => safeFetch(`https://${HOST}/${encodeURIComponent(loc)}`, opts(s, extra));
    assert.equal((await to('https://127.0.0.1/admin', { allowHosts: [HOST, '127.0.0.1'] })).code, 'NOT_PUBLIC');
    assert.equal((await to('https://127.0.0.1/admin')).code, 'HOST_NOT_ALLOWED');
    assert.equal((await to('http://files.example.com/x')).code, 'BAD_SCHEME');
    assert.equal((await to('https://evil.example.org/x')).code, 'HOST_NOT_ALLOWED');
    assert.equal((await to('https://[::ffff:7f00:1]/')).code, 'HOST_NOT_ALLOWED');
    // a hop whose host resolves to a private address the second time
    let n = 0;
    const flip = async () => [{ address: (n += 1) === 1 ? PUBLIC : '169.254.169.254', family: 4 }];
    assert.equal((await to('https://files.example.com/next', { resolver: flip })).code, 'NOT_PUBLIC');
  } finally { await s.close(); }
});

test('redirects: followed and counted when safe, capped when endless, an empty Location is refused', async () => {
  const s = await server((q, res) => {
    if (q.url === '/end') { res.end('done'); return; }
    if (q.url === '/bare') { res.statusCode = 302; res.end(); return; }
    res.statusCode = 301; res.setHeader('location', q.url === '/start' ? '/end' : '/loop'); res.end();
  });
  try {
    const ok = await safeFetch(`https://${HOST}/start`, opts(s));
    assert.equal(ok.ok, true); assert.equal(ok.body.toString(), 'done'); assert.equal(ok.redirects, 1);
    assert.equal((await safeFetch(`https://${HOST}/loop`, opts(s))).code, 'TOO_MANY_REDIRECTS');
    assert.equal((await safeFetch(`https://${HOST}/bare`, opts(s))).code, 'BAD_REDIRECT');
  } finally { await s.close(); }
});

test('an oversized body is cut off (declared and undeclared)', async () => {
  const s = await server((q, res) => {
    if (q.url === '/declared') { res.setHeader('content-length', '5000000'); res.end('x'.repeat(10)); return; }
    res.write('x'.repeat(4000)); res.write('x'.repeat(4000)); res.end('x'.repeat(4000));
  });
  try {
    assert.equal((await safeFetch(`https://${HOST}/declared`, opts(s, { maxBytes: 1000 }))).code, 'TOO_LARGE');
    assert.equal((await safeFetch(`https://${HOST}/chunked`, opts(s, { maxBytes: 5000 }))).code, 'TOO_LARGE');
    assert.equal((await safeFetch(`https://${HOST}/chunked`, opts(s, { maxBytes: 50000 }))).ok, true);
  } finally { await s.close(); }
});

test('a slow body (drip-feed) and a server that never answers hit the deadline', async () => {
  const timers = [];
  const s = await server((q, res) => {
    if (q.url === '/silent') return; // never answers
    res.write('x');
    timers.push(setInterval(() => res.write('x'), 50));
  });
  try {
    const t0 = Date.now();
    assert.equal((await safeFetch(`https://${HOST}/drip`, opts(s, { timeoutMs: 400 }))).code, 'TIMEOUT');
    assert.equal((await safeFetch(`https://${HOST}/silent`, opts(s, { timeoutMs: 300 }))).code, 'TIMEOUT');
    assert.ok(Date.now() - t0 < 3000);
  } finally { timers.forEach(clearInterval); await s.close(); }
});

test('a disallowed content type is refused; compressed bodies are never requested', async () => {
  const s = await server((_q, res) => { res.setHeader('content-type', 'application/x-msdownload'); res.end('MZ'); });
  try {
    const r = await safeFetch(`https://${HOST}/`, opts(s, { allowContentTypes: ['text/html', 'application/json'] }));
    assert.equal(r.code, 'BAD_CONTENT_TYPE');
    assert.equal(s.requests[0].headers['accept-encoding'], 'identity');
  } finally { await s.close(); }
});
