// The Cockpit logo's "framework development" signal: file times only, one fixed directory, this repository's sessions only,
// off on a multi-user host. Every case runs against a throwaway transcripts folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { ACTIVE_WINDOW_MS, createDevActivity, projectSlug, readDevActivity } from './devActivity.mjs';

const REPO = '/home/dev/repos/construct';
const NOW = 1_800_000_000_000;

function transcripts() {
  const dir = makeTempDir('og-devact-');
  const write = (rel, ageMs, body = 'secret transcript text') => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    const t = new Date(NOW - ageMs);
    fs.utimesSync(file, t, t);
    return file;
  };
  return { dir, write };
}

test('projectSlug: the path with separators and dots turned into dashes, as Claude Code names its folders', () => {
  assert.equal(projectSlug('/home/dev/repos/construct'), '-home-dev-repos-construct');
  assert.equal(projectSlug('/home/dev/my.repo/x'), '-home-dev-my-repo-x');
});

test('a transcript written inside the window means active; one just outside it does not', () => {
  const { dir, write } = transcripts();
  write('-home-dev-repos-construct/aaa.jsonl', ACTIVE_WINDOW_MS + 5_000);
  let r = readDevActivity({ repoRoot: REPO, projectsDir: dir, now: NOW });
  assert.equal(r.available, true);
  assert.equal(r.active, false);
  assert.equal(r.sessions, 0);
  assert.ok(r.newestAgeMs >= ACTIVE_WINDOW_MS);
  write('-home-dev-repos-construct/bbb.jsonl', 5_000);
  r = readDevActivity({ repoRoot: REPO, projectsDir: dir, now: NOW });
  assert.equal(r.active, true);
  assert.equal(r.sessions, 1);
  assert.equal(r.newestAgeMs, 5_000);
});

test('sub-agent transcripts and worktree sessions of this repository count; other repositories do not', () => {
  const { dir, write } = transcripts();
  write('-home-dev-repos-construct/sess/subagents/agent-1.jsonl', 2_000);
  write('-home-dev-repos-construct--claude-worktrees-agent-x-ui/ccc.jsonl', 3_000);
  write('-home-dev-repos-other/ddd.jsonl', 1_000);
  const r = readDevActivity({ repoRoot: REPO, projectsDir: dir, now: NOW });
  assert.equal(r.sessions, 2);
  const onlyOther = transcripts();
  onlyOther.write('-home-dev-repos-other/x.jsonl', 1_000);
  assert.equal(readDevActivity({ repoRoot: REPO, projectsDir: onlyOther.dir, now: NOW }).active, false);
});

test('only file times are read: a transcript is never opened, symbolic links are skipped, and a missing folder is "not available"', () => {
  const { dir, write } = transcripts();
  const real = write('-home-dev-repos-construct/aaa.jsonl', 90_000);
  fs.symlinkSync(real, path.join(dir, '-home-dev-repos-construct', 'link.jsonl'));
  fs.symlinkSync(makeTempDir('og-devact-out-'), path.join(dir, '-home-dev-repos-construct', 'linkdir'));
  const opened = [];
  const original = fs.readFileSync;
  fs.readFileSync = (...a) => { opened.push(String(a[0])); return original(...a); };
  try {
    readDevActivity({ repoRoot: REPO, projectsDir: dir, now: NOW });
  } finally {
    fs.readFileSync = original;
  }
  assert.deepEqual(opened.filter((p) => p.endsWith('.jsonl')), [], 'no transcript was read');
  assert.equal(readDevActivity({ repoRoot: REPO, projectsDir: path.join(dir, 'missing'), now: NOW }).available, false);
});

test('the handler is off where the server is a hosted, multi-user Cockpit, and answers from a short cache otherwise', () => {
  const { dir, write } = transcripts();
  write('-home-dev-repos-construct/a.jsonl', 1_000);
  let on = false;
  let clock = NOW;
  const handler = createDevActivity({ repoRoot: REPO, projectsDir: dir, enabled: () => on, now: () => clock });
  assert.deepEqual(handler(), { ok: true, available: false, active: false });
  on = true;
  assert.equal(handler().active, true);
  // Inside the cache window a second call does not rescan: an added transcript is not seen until it lapses.
  write('-home-dev-repos-construct/b.jsonl', 500);
  assert.equal(handler().sessions, 1);
  clock += 2_500;
  assert.equal(handler().sessions, 2);
});

// --- the public status API ----------------------------------------------------------------------------------------------

import http from 'node:http';
import express from 'express';
import { createDevStatusRouter } from './devActivity.mjs';

async function withStatus(read, fn) {
  const app = express();
  app.use('/api/dev-status', createDevStatusRouter({ read }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/dev-status`;
  try {
    await fn(base);
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

test('GET /api/dev-status answers booleans only, to any origin, uncached; nothing else leaks', async () => {
  await withStatus(() => ({ ok: true, available: true, active: true, sessions: 3, newestAgeMs: 1200, secret: 'x' }), async (base) => {
    const r = await fetch(base, { headers: { origin: 'https://docs.example' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, available: true, active: true });
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('access-control-allow-credentials'), null, 'no credentials are ever allowed');
  });
});

test('the preflight is answered (including the private-network header) and only GET is routed', async () => {
  await withStatus(() => ({ available: true, active: false }), async (base) => {
    const pre = await fetch(base, { method: 'OPTIONS', headers: { origin: 'https://docs.example', 'access-control-request-method': 'GET', 'access-control-request-private-network': 'true' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const r = await fetch(base, { method, body: '{}', headers: { 'content-type': 'application/json' } });
      assert.equal(r.status, 405, method);
    }
  });
});

test('where the server is not the machine the framework is built on it says so: available false, active false', async () => {
  const handler = createDevActivity({ repoRoot: REPO, enabled: () => false });
  await withStatus(handler, async (base) => {
    assert.deepEqual(await (await fetch(base)).json(), { ok: true, available: false, active: false });
  });
});

test('the real server mounts it above the session gate, so a visitor without a session can read it', async () => {
  const { app, auth } = await import('./index.mjs');
  const stack = app._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === auth.requireSession);
  const route = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/dev-status'));
  assert.ok(gate >= 0 && route >= 0);
  assert.ok(route < gate, 'the status route is public: it must come before the gate');
});
