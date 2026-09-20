import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachWizardSocket } from './wizardSocket.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';

// Regression coverage for the security fix restricting the wizard socket to
// a known origin (was: any page, any origin, could open a WebSocket here
// and drive an LLM-capable wizard with no consent step).

function withServer(allowedOrigin, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => res.end());
    attachWizardSocket(server, '/ws/wizard', allowedOrigin);
    server.listen(0, async () => {
      const { port } = server.address();
      try {
        await fn(port);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

test('wizard socket accepts a connection from the allowed origin', async () => {
  await withServer('http://localhost:3000', (port) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/wizard`, { origin: 'http://localhost:3000' });
    ws.on('open', () => { ws.close(); resolve(); });
    ws.on('error', reject);
  }));
});

test('wizard socket rejects a connection from a different origin', async () => {
  await withServer('http://localhost:3000', (port) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/wizard`, { origin: 'http://evil.example' });
    ws.on('open', () => reject(new Error('connection from a disallowed origin should not open')));
    ws.on('error', () => resolve()); // handshake rejection surfaces as a connection error, not a close event
    ws.on('unexpected-response', (req, res) => {
      assert.equal(res.statusCode, 401);
      resolve();
    });
  }));
});

test('wizard socket with no allowedOrigin configured imposes no restriction (explicit opt-out)', async () => {
  await withServer(undefined, (port) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/wizard`, { origin: 'http://anything.example' });
    ws.on('open', () => { ws.close(); resolve(); });
    ws.on('error', reject);
  }));
});

// ---------------------------------------------------------------------------
// #278: the upgrade requires a session, not just a known origin.
//
// The origin check above stops a drive-by page in a *browser*. It stops
// nothing at all from `curl`/`wscat`, which sets whatever Origin it likes.
// A session gate that stopped at REST would therefore leave the one route
// that actually drives an LLM wide open, so the socket runs the same
// `auth.allows()` the `/api` middleware runs, at the handshake, before a
// socket exists.
// ---------------------------------------------------------------------------

function withAuthServer({ allowedOrigin = 'http://localhost:3000', env, host = '127.0.0.1' }, fn) {
  const auth = createAuth(resolveAuthConfig(env, { host, clientOrigin: allowedOrigin }));
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => res.end());
    attachWizardSocket(server, '/ws/wizard', allowedOrigin, auth);
    server.listen(0, async () => {
      const { port } = server.address();
      try {
        await fn({ port, auth });
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

/** Resolve to the handshake's HTTP status when the upgrade is refused, or
 * reject if the socket actually opens. */
function expectRefused(url, options) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.on('open', () => {
      ws.close();
      reject(new Error('the upgrade should have been refused'));
    });
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve(null)); // some refusals surface only as a socket error
  });
}

function expectAccepted(url, options) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.on('open', () => { ws.close(); resolve(); });
    ws.on('unexpected-response', (req, res) => reject(new Error(`upgrade refused with ${res.statusCode}`)));
    ws.on('error', reject);
  });
}

const WS_SECRET = 'w'.repeat(48);
const WS_AUTH_ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: WS_SECRET };

test('#278: the wizard upgrade is refused with 401 when there is no session, even from the allowed origin', async () => {
  await withAuthServer({ env: WS_AUTH_ENV }, async ({ port }) => {
    const status = await expectRefused(`ws://localhost:${port}/ws/wizard`, { origin: 'http://localhost:3000' });
    assert.equal(status, 401);
  });
});

test('#278: a valid session cookie opens the wizard upgrade', async () => {
  await withAuthServer({ env: WS_AUTH_ENV }, async ({ port }) => {
    const token = signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, WS_SECRET);
    await expectAccepted(`ws://localhost:${port}/ws/wizard`, {
      origin: 'http://localhost:3000',
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    });
  });
});

test('#278: forged, expired and wrong-secret session cookies are all refused at the upgrade', async () => {
  await withAuthServer({ env: WS_AUTH_ENV }, async ({ port }) => {
    const cases = {
      'signed with another secret': signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, 'x'.repeat(48)),
      expired: signValue({ login: 'e2e-user', exp: Date.now() - 1 }, WS_SECRET),
      'with no login in the payload': signValue({ exp: Date.now() + 60_000 }, WS_SECRET),
      unsigned: Buffer.from(JSON.stringify({ login: 'e2e-user', exp: Date.now() + 60_000 })).toString('base64url'),
      'that is garbage': 'not-a-session',
    };
    for (const [why, token] of Object.entries(cases)) {
      const status = await expectRefused(`ws://localhost:${port}/ws/wizard`, {
        origin: 'http://localhost:3000',
        headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      });
      assert.equal(status, 401, `a cookie ${why} must be refused`);
    }
  });
});

test('#278: a valid session does not excuse a wrong origin — both checks apply', async () => {
  await withAuthServer({ env: WS_AUTH_ENV }, async ({ port }) => {
    const token = signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, WS_SECRET);
    const status = await expectRefused(`ws://localhost:${port}/ws/wizard`, {
      origin: 'http://evil.example',
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    });
    assert.equal(status, 401);
  });
});

test('#278: with authentication off the upgrade behaves exactly as before', async () => {
  await withAuthServer({ env: { CONSTRUCT_AUTH: 'off' } }, async ({ port, auth }) => {
    assert.equal(auth.required, false);
    await expectAccepted(`ws://localhost:${port}/ws/wizard`, { origin: 'http://localhost:3000' });
  });
});
