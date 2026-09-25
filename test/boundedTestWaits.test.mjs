// #652 -- the bounded-wait helpers (test-utils/bounded.mjs) that keep a network test from hanging a whole run, and the mock
// GitHub's behaviour on a taken port, which is what actually hung githubRepoApi.test.mjs for ~29 minutes: an EADDRINUSE
// that nobody listened for. Every server here binds port 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { bounded, closeServer, fetchBounded, listenOn, textBounded } from '../test-utils/bounded.mjs';
import { startMockGithub } from '../ui/e2e/support/mock-github.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = path.join(REPO, 'test-utils/bounded.mjs');

test('bounded: a wait that never ends rejects after the limit with a message naming the wait; a fast one passes through', async () => {
  const started = Date.now();
  await assert.rejects(bounded(new Promise(() => {}), 80, 'the refresh to finish'), /timed out after 80 ms waiting for: the refresh to finish/);
  assert.ok(Date.now() - started < 2000);
  assert.equal(await bounded(Promise.resolve(7), 1000, 'unused'), 7);
  await assert.rejects(bounded(Promise.reject(new Error('boom')), 1000, 'unused'), /boom/);
});

test('listenOn: a taken port rejects with EADDRINUSE (it used to be an uncaught exception and a hang); port 0 gets a free one', async () => {
  const blocker = http.createServer();
  const taken = await listenOn(blocker);
  assert.ok(taken > 0);
  const second = http.createServer();
  await assert.rejects(listenOn(second, { port: taken }), (e) => e.code === 'EADDRINUSE');
  await closeServer(blocker);
});

test('startMockGithub on a taken port rejects instead of throwing from nowhere and leaving the process waiting', async () => {
  const blocker = http.createServer();
  const taken = await listenOn(blocker);
  await assert.rejects(bounded(startMockGithub({ port: taken }), 3000, 'the mock to listen'), (e) => e.code === 'EADDRINUSE');
  await closeServer(blocker);
});

test('fetchBounded and textBounded: a server that never answers, and one that never finishes the body, fail fast and say which wait', async () => {
  const sockets = [];
  const silent = http.createServer(() => {}); // never responds
  const partial = http.createServer((req, res) => { res.writeHead(200, { 'content-length': '100' }); res.write('x'); }); // never ends
  for (const s of [silent, partial]) s.on('connection', (c) => sockets.push(c));
  const p1 = await listenOn(silent);
  const p2 = await listenOn(partial);
  try {
    const t0 = Date.now();
    await assert.rejects(fetchBounded(`http://127.0.0.1:${p1}/x`, {}, { ms: 150, what: 'GET /x on the silent server' }), /timed out after 150 ms waiting for: GET \/x on the silent server/);
    const res = await fetchBounded(`http://127.0.0.1:${p2}/y`, {}, { ms: 1000, what: 'GET /y' });
    await assert.rejects(textBounded(res, 'GET /y', 150), /timed out after 150 ms waiting for: GET \/y response body/);
    assert.ok(Date.now() - t0 < 4000);
  } finally {
    for (const c of sockets) c.destroy();
    await closeServer(silent);
    await closeServer(partial);
  }
});

test('watchdog: a file that leaves a server open ends non-zero within its limit instead of hanging; a clean one is not held up', () => {
  const dir = makeTempDir('bounded-watchdog-');
  const leak = path.join(dir, 'leak.mjs');
  fs.writeFileSync(leak, `import http from 'node:http';\nimport { watchdog } from ${JSON.stringify(HELPER)};\nhttp.createServer().listen(0, '127.0.0.1');\nwatchdog(300, 'leak.mjs');\n`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [leak], { encoding: 'utf8', timeout: 8000 });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /leak\.mjs: still running 300 ms after its last test/);
  assert.ok(Date.now() - t0 < 6000);
  const clean = path.join(dir, 'clean.mjs');
  fs.writeFileSync(clean, `import { watchdog } from ${JSON.stringify(HELPER)};\nwatchdog(5000, 'clean.mjs');\n`);
  const c0 = Date.now();
  assert.equal(spawnSync(process.execPath, [clean], { encoding: 'utf8', timeout: 8000 }).status, 0);
  assert.ok(Date.now() - c0 < 3000);
});
