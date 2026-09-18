import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachWizardSocket } from './wizardSocket.mjs';

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
