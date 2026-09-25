// #650 -- every CONSTRUCT_E2E_* test seam is refused under NODE_ENV=production (any case) and beyond loopback, with the same
// error type CONSTRUCT_AUTH_TEST_USER uses (AuthConfigError), one test per seam, plus the real server entry point refusing to
// start, plus an inventory test that fails when a seam is read under ui/server/src without going through the guard.
// The spawned servers must refuse before they listen; they are given ports 49610-49612 only so a missing guard would show
// up as a server that started (the assertion then fails on the exit status), never as a clash.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AuthConfigError } from './auth.mjs';
import { resolveRepoConnectionConfig } from './repoConnection.mjs';
import { TEST_SEAMS, TEST_SEAM_VARS, refuseTestSeam, resolveHarnessSeams } from './testSeams.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = makeTempDir('seams-');
const PRODUCTION_SPELLINGS = ['production', 'Production', ' PRODUCTION '];

/** One entry per seam: how to trip it through the function index.mjs / repoConnection.mjs really call. */
const SEAMS = [
  {
    name: 'CONSTRUCT_E2E_PROJECT_DIR',
    env: { CONSTRUCT_E2E_PROJECT_DIR: dir },
    resolve: (env, host) => resolveHarnessSeams(env, { host }),
    allowed: (r) => assert.equal(r.projectDir, dir),
    port: 49610,
  },
  {
    name: 'CONSTRUCT_E2E_CLONE_LOCAL_ROOT',
    env: { CONSTRUCT_E2E_CLONE_LOCAL_ROOT: dir },
    resolve: (env, host) => resolveHarnessSeams(env, { host }),
    allowed: (r) => assert.equal(r.cloneLocalRoot, path.resolve(dir)),
    port: 49611,
  },
  {
    name: 'CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE',
    env: { CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE: 'http://127.0.0.1:49199' },
    resolve: (env, host) => resolveRepoConnectionConfig(env, { host }),
    allowed: (r) => assert.equal(r.tokenUrl, 'http://127.0.0.1:49199/login/oauth/access_token'),
    port: 49612,
  },
  {
    name: 'CONSTRUCT_E2E_GITHUB_REPO_API_BASE',
    env: { CONSTRUCT_E2E_GITHUB_REPO_API_BASE: 'http://127.0.0.1:49199' },
    resolve: (env, host) => resolveRepoConnectionConfig(env, { host }),
    allowed: (r) => assert.equal(r.apiBase, 'http://127.0.0.1:49199'),
    port: null, // the same guard as the OAUTH_BASE seam; the process-level check runs once for the pair
  },
];

for (const seam of SEAMS) {
  test(`${seam.name}: refused under NODE_ENV=production in any case, refused beyond loopback, allowed on loopback outside production`, () => {
    for (const NODE_ENV of PRODUCTION_SPELLINGS) {
      assert.throws(
        () => seam.resolve({ ...seam.env, NODE_ENV }, '127.0.0.1'),
        (e) => e instanceof AuthConfigError && /NODE_ENV=production/.test(e.message) && e.message.includes(seam.name),
        `NODE_ENV=${JSON.stringify(NODE_ENV)}`,
      );
    }
    assert.throws(() => seam.resolve({ ...seam.env, NODE_ENV: 'production' }, '0.0.0.0'), AuthConfigError, 'production and exposed');
    assert.throws(
      () => seam.resolve({ ...seam.env, NODE_ENV: 'development' }, '0.0.0.0'),
      (e) => e instanceof AuthConfigError && /beyond loopback/.test(e.message) && e.message.includes(seam.name),
    );
    for (const NODE_ENV of ['test', 'development', undefined]) seam.allowed(seam.resolve({ ...seam.env, ...(NODE_ENV ? { NODE_ENV } : {}) }, '127.0.0.1'));
    // Production without the seam set is fine (an empty value counts as unset).
    assert.doesNotThrow(() => seam.resolve({ NODE_ENV: 'production', [seam.name]: '  ' }, '127.0.0.1'));
    assert.doesNotThrow(() => seam.resolve({ NODE_ENV: 'production' }, '127.0.0.1'));
  });
}

test('any other CONSTRUCT_E2E_* variable in a production environment is refused too, so a new seam without a registry entry is still stopped', () => {
  assert.throws(
    () => resolveHarnessSeams({ NODE_ENV: 'production', CONSTRUCT_E2E_SOMETHING_NEW: '1' }),
    (e) => e instanceof AuthConfigError && e.message.includes('CONSTRUCT_E2E_SOMETHING_NEW'),
  );
  assert.doesNotThrow(() => resolveHarnessSeams({ NODE_ENV: 'test', CONSTRUCT_E2E_SOMETHING_NEW: '1' }));
  assert.throws(() => refuseTestSeam({}, '127.0.0.1', 'nope'), /unknown test seam/);
});

test('inventory: every CONSTRUCT_E2E_ name under ui/server/src is a registered seam, and a module that reads one goes through the guard', () => {
  const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.mjs') && !/\.(test|cases)\.mjs$/.test(f) && f !== 'testSeams.mjs');
  const seen = new Map();
  for (const f of files) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const [name] of src.matchAll(/CONSTRUCT_E2E_[A-Z0-9_]+/g)) seen.set(name, [...(seen.get(name) ?? []), f]);
    if (/env\??\.CONSTRUCT_E2E_/.test(src)) {
      assert.match(src, /refuseTestSeam|resolveHarnessSeams/, `${f} reads a CONSTRUCT_E2E_ variable without the shared guard (testSeams.mjs)`);
    }
  }
  assert.ok(seen.size >= 3, `expected to find the seams, found ${[...seen.keys()].join(', ')}`);
  for (const [name, where] of seen) assert.ok(TEST_SEAM_VARS.includes(name), `${name} (in ${[...new Set(where)].join(', ')}) is not in the TEST_SEAMS registry`);
  for (const v of TEST_SEAM_VARS) assert.ok(seen.has(v), `${v} is registered but nothing under ui/server/src reads it any more`);
  assert.deepEqual(Object.keys(TEST_SEAMS).sort(), ['cloneLocalRoot', 'githubRepoBases', 'projectDir']);
});

for (const seam of SEAMS.filter((s) => s.port)) {
  test(`the server process refuses to start with ${seam.name} under NODE_ENV=production: exit 1 and a message, no listener`, () => {
    const r = spawnSync(process.execPath, [path.join(HERE, 'index.mjs')], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', PORT: String(seam.port), ...seam.env },
    });
    assert.equal(r.status, 1, `expected a refusal (exit 1), got status=${r.status} signal=${r.signal}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /refused to start/);
    assert.match(r.stderr, /NODE_ENV=production/);
    assert.ok(r.stderr.includes(seam.name), r.stderr);
    assert.doesNotMatch(r.stdout, /listening/);
  });
}
