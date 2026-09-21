// #423 -- health.mjs: real writability probes, free space, thresholds, git status pass-through, cache, no paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { DEFAULT_MIN_FREE_MB, checkDir, createHealth, freeBytesOf, probeWritable, resolveMinFreeBytes } from './health.mjs';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

test('resolveMinFreeBytes: CONSTRUCT_HEALTH_MIN_FREE_MB in MB, default 500, nonsense ignored', () => {
  assert.equal(resolveMinFreeBytes({}), DEFAULT_MIN_FREE_MB * 1024 * 1024);
  assert.equal(resolveMinFreeBytes({ CONSTRUCT_HEALTH_MIN_FREE_MB: '10' }), 10 * 1024 * 1024);
  assert.equal(resolveMinFreeBytes({ CONSTRUCT_HEALTH_MIN_FREE_MB: '0' }), 0);
  assert.equal(resolveMinFreeBytes({ CONSTRUCT_HEALTH_MIN_FREE_MB: 'lots' }), DEFAULT_MIN_FREE_MB * 1024 * 1024);
});

test('probeWritable really writes and leaves nothing behind; creates a missing directory', () => {
  const dir = makeTempDir('health-');
  assert.deepEqual(probeWritable(dir), { writable: true });
  assert.deepEqual(fs.readdirSync(dir), [], 'the probe file is gone');
  const missing = path.join(dir, 'nested', 'state');
  assert.deepEqual(probeWritable(missing), { writable: true });
  assert.ok(fs.existsSync(missing), 'created, like the server would at first use');
});

test('probeWritable reports an unwritable directory with the error code', { skip: isRoot && 'root can write anywhere' }, () => {
  const dir = makeTempDir('health-ro-');
  const ro = path.join(dir, 'ro');
  fs.mkdirSync(ro, { mode: 0o555 });
  try {
    const r = probeWritable(ro);
    assert.equal(r.writable, false);
    assert.equal(r.error, 'EACCES');
    assert.equal(probeWritable(path.join(ro, 'child')).writable, false, 'a child that cannot be created');
  } finally {
    fs.chmodSync(ro, 0o755);
  }
});

test('freeBytesOf / checkDir: a number for a real directory, null for a missing one, and the threshold decides `low`', () => {
  const dir = makeTempDir('health-free-');
  const free = freeBytesOf(dir);
  assert.equal(typeof free, 'number');
  assert.ok(free > 0);
  assert.equal(freeBytesOf(path.join(dir, 'nope')), null);
  assert.equal(checkDir(dir, 0).low, false);
  assert.equal(checkDir(dir, Number.MAX_SAFE_INTEGER).low, true);
  const c = checkDir(dir, 0);
  assert.deepEqual(Object.keys(c).sort(), ['freeBytes', 'low', 'writable']);
});

test('createHealth: ok first, degraded with warnings when a check fails, no path in the document, cached', () => {
  const dir = makeTempDir('health-doc-');
  const ws = path.join(dir, 'ws');
  const state = path.join(dir, 'state');
  let gitCalls = 0;
  let clock = 1_000_000;
  const gitStatus = () => { gitCalls += 1; return { ok: true, version: '2.36.1', minimum: '2.37.0', cloneEnabled: false, reason: 'git 2.36.1 is older than 2.37.0' }; };
  const health = createHealth({ getWorkspaceRoot: () => ws, getStateDir: () => state, gitStatus, minFreeBytes: 0, cacheMs: 5000, now: () => clock, nodeVersion: 'v22.0.0-test' });

  const h = health.snapshot();
  assert.equal(Object.keys(h)[0], 'ok');
  assert.equal(h.ok, true);
  assert.equal(h.degraded, true);
  assert.deepEqual(h.warnings, ['git: git 2.36.1 is older than 2.37.0']);
  assert.equal(h.node, 'v22.0.0-test');
  assert.equal(h.git.cloneEnabled, false);
  assert.equal(h.workspace.writable, true);
  assert.equal(h.stateDir.writable, true);
  assert.equal(typeof h.workspace.freeBytes, 'number');
  assert.deepEqual(h.thresholds, { minFreeBytes: 0 });
  assert.equal(JSON.stringify(h).includes(dir), false, 'no filesystem path leaves the server');

  clock += 1000;
  assert.equal(health.snapshot(), h, 'served from cache within cacheMs');
  assert.equal(gitCalls, 1);
  clock += 5000;
  assert.notEqual(health.snapshot(), h, 'recomputed after cacheMs');
  assert.equal(gitCalls, 2);
  health.snapshot({ fresh: true });
  assert.equal(gitCalls, 3);
});

test('createHealth: a getter that throws, a low disk and a missing git all land in warnings, never in a throw', () => {
  const dir = makeTempDir('health-warn-');
  const health = createHealth({
    getWorkspaceRoot: () => { throw Object.assign(new Error('boom'), { code: 'EACCES' }); },
    getStateDir: () => dir,
    gitStatus: () => ({ ok: false, version: null, minimum: '2.37.0', cloneEnabled: false, reason: 'git could not be started (ENOENT)' }),
    minFreeBytes: Number.MAX_SAFE_INTEGER,
    cacheMs: 0,
  });
  const h = health.snapshot();
  assert.equal(h.degraded, true);
  assert.equal(h.workspace.writable, false);
  assert.equal(h.workspace.error, 'EACCES');
  assert.equal(h.stateDir.low, true);
  assert.match(h.warnings[0], /^git: git could not be started/);
  assert.match(h.warnings.find((w) => w.startsWith('workspace')), /not writable \(EACCES\)/);
  assert.match(h.warnings.find((w) => w.startsWith('state directory')), /only \d+ MB free \(threshold \d+ MB\)/);
  const lines = health.describeStartup();
  assert.match(lines[0].text, /^Preflight: node v.*git MISSING \(clone DISABLED: git could not be started/);
  assert.equal(lines[1].level, 'warn');
  assert.ok(lines.some((l) => l.text.includes('state directory') && l.level === 'warn'));
});
