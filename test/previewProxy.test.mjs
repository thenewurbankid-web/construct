import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { createPreviewProxy, injectIntoHtml } from '../packages/engine/previewProxy.mjs';

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** The `Sec-WebSocket-Accept` value a real WS server would compute for `key` — RFC 6455 §1.3. */
function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
}

const NONCE = 'test-nonce-123';
const PARENT_ORIGIN = 'http://127.0.0.1:4000';

/** Starts `server` on 127.0.0.1:0 and resolves its assigned port. */
function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function get(port, urlPath, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

test('injectIntoHtml: inserts as the first child of <head>', () => {
  const html = '<!doctype html><html><head><title>t</title></head><body></body></html>';
  const out = injectIntoHtml(html, '<script>X</script>');
  assert.ok(out.startsWith('<!doctype html><html><head><script>X</script><title>t</title>'));
});

test('injectIntoHtml: falls back to just inside <html> when there is no <head>', () => {
  const html = '<html><body>hi</body></html>';
  const out = injectIntoHtml(html, '<script>X</script>');
  assert.equal(out, '<html><script>X</script><body>hi</body></html>');
});

test('injectIntoHtml: prepends when there is neither <head> nor <html>', () => {
  assert.equal(injectIntoHtml('hi', '<script>X</script>'), '<script>X</script>hi');
});

test('createPreviewProxy: requires targetPort, nonce and parentOrigin', () => {
  assert.throws(() => createPreviewProxy({ nonce: NONCE, parentOrigin: PARENT_ORIGIN }), /targetPort/);
  assert.throws(() => createPreviewProxy({ targetPort: 1234, parentOrigin: PARENT_ORIGIN }), /nonce/);
  assert.throws(() => createPreviewProxy({ targetPort: 1234, nonce: NONCE }), /parentOrigin/);
});

test('createPreviewProxy: injects the bridge script into an HTML response, forwards the rest of the page unchanged', async (t) => {
  const target = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body>hi</body></html>');
  });
  const targetPort = await listen(target);
  const proxy = createPreviewProxy({ targetPort, nonce: NONCE, parentOrigin: PARENT_ORIGIN });
  const proxyPort = await listen(proxy);
  t.after(async () => { await close(proxy); await close(target); });

  const res = await get(proxyPort, '/');
  assert.equal(res.status, 200);
  assert.match(res.body, /<head><script>/);
  assert.ok(res.body.includes(JSON.stringify(NONCE).slice(1, -1)) || res.body.includes(NONCE), 'the nonce is embedded in the injected script');
  assert.ok(res.body.indexOf('<script>') < res.body.indexOf('<meta'), 'the bridge is the FIRST child of <head>, before the rest of the page');
  assert.match(res.body, /<title>App<\/title>/);
  assert.equal(Number(res.headers['content-length']), Buffer.byteLength(res.body));
});

test('createPreviewProxy: forwards a non-HTML response (and its headers) unmodified', async (t) => {
  const target = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/javascript', 'x-custom': 'abc' });
    res.end('console.log(1);');
  });
  const targetPort = await listen(target);
  const proxy = createPreviewProxy({ targetPort, nonce: NONCE, parentOrigin: PARENT_ORIGIN });
  const proxyPort = await listen(proxy);
  t.after(async () => { await close(proxy); await close(target); });

  const res = await get(proxyPort, '/main.js');
  assert.equal(res.status, 200);
  assert.equal(res.body, 'console.log(1);');
  assert.equal(res.headers['x-custom'], 'abc');
});

test('createPreviewProxy: strips content-security-policy and x-frame-options only on what it proxies', async (t) => {
  const target = http.createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html',
      'content-security-policy': "frame-ancestors 'none'",
      'x-frame-options': 'DENY',
    });
    res.end('<html><head></head><body></body></html>');
  });
  const targetPort = await listen(target);
  const proxy = createPreviewProxy({ targetPort, nonce: NONCE, parentOrigin: PARENT_ORIGIN });
  const proxyPort = await listen(proxy);
  t.after(async () => { await close(proxy); await close(target); });

  const res = await get(proxyPort, '/');
  assert.equal(res.headers['content-security-policy'], undefined);
  assert.equal(res.headers['x-frame-options'], undefined);
});

test('createPreviewProxy: an HTML response over the injectable-size cap is proxied unmodified rather than buffered/blocked', async (t) => {
  // Over MAX_INJECTABLE_HTML_BYTES (5 MiB): the bridge is skipped rather than holding an
  // unbounded response in memory. Real dev HTML is orders of magnitude smaller than this.
  const big = `<html><head></head><body>${'x'.repeat(6 * 1024 * 1024)}</body></html>`;
  const target = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(big);
  });
  const targetPort = await listen(target);
  const proxy = createPreviewProxy({ targetPort, nonce: NONCE, parentOrigin: PARENT_ORIGIN });
  const proxyPort = await listen(proxy);
  t.after(async () => { await close(proxy); await close(target); });

  const res = await get(proxyPort, '/');
  assert.ok(!res.body.includes('<script>'), 'not injected once over the cap');
  assert.equal(res.body, big, 'forwarded unmodified, byte-for-byte');
});

test('createPreviewProxy: forwards a WebSocket upgrade (the app\'s own HMR) verbatim', async (t) => {
  // A hand-rolled WS handshake (RFC 6455), so this stays dependency-free like previewFiber.mjs:
  // the target answers 101 with the accept key computed from the key it actually received, which
  // only round-trips correctly if the proxy forwarded the upgrade request byte-for-byte.
  // A real WS connection stays open for the session, so nothing here ever calls `.end()` on the
  // TCP sockets `http.Server.close()` waits for; the test destroys both hops itself in `t.after`
  // rather than hanging forever on a graceful close of a connection nobody closes.
  let targetSideSocket;
  let clientSideSocket;
  const target = http.createServer();
  target.on('upgrade', (req, socket) => {
    targetSideSocket = socket;
    const accept = wsAccept(req.headers['sec-websocket-key']);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-From-Target: yes\r\n\r\n`);
    socket.write('post-upgrade-payload');
  });
  const targetPort = await listen(target);
  const proxy = createPreviewProxy({ targetPort, nonce: NONCE, parentOrigin: PARENT_ORIGIN });
  const proxyPort = await listen(proxy);
  t.after(async () => {
    targetSideSocket?.destroy();
    clientSideSocket?.destroy();
    await close(proxy);
    await close(target);
  });

  const key = crypto.randomBytes(16).toString('base64');
  const response = await new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, '127.0.0.1', () => {
      clientSideSocket = socket;
      socket.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${proxyPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let data = '';
    socket.on('data', (c) => { data += c.toString(); if (data.includes('post-upgrade-payload')) { resolve(data); } });
    socket.on('error', reject);
  });

  assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/);
  // Header names are forwarded through Node's http client, which normalizes them to lowercase;
  // HTTP header names are case-insensitive, so the assertions are too.
  assert.match(response, /x-from-target: yes/i);
  assert.match(response, new RegExp(`sec-websocket-accept: ${wsAccept(key)}`, 'i'));
  assert.ok(response.includes('post-upgrade-payload'), 'data the target sent right after the handshake reaches the client through the proxy');
});

test('createPreviewProxy: an unreachable dev server answers 502 instead of hanging', async (t) => {
  // Bind then close to get a port that is (very likely) free but never claims anything real is listening.
  const probe = http.createServer();
  const deadPort = await listen(probe);
  await close(probe);

  const proxy = createPreviewProxy({ targetPort: deadPort, nonce: NONCE, parentOrigin: PARENT_ORIGIN });
  const proxyPort = await listen(proxy);
  t.after(async () => { await close(proxy); });

  const res = await get(proxyPort, '/');
  assert.equal(res.status, 502);
});
