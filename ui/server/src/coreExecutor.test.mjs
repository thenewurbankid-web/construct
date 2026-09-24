// #541 / #638 review -- what a `cli`-mode child is allowed to see of the Cockpit server's environment: the CLI's own
// CONSTRUCT_* settings and a shell's basics, never a secret (the session secret, either GitHub client secret, any
// *_TOKEN / *_PASSWORD / *_KEY) and never an e2e seam. The child runs inside a cloned project whose code is not ours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_ENV, childEnv, runCliVerb, runValidate } from './coreExecutor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A server environment as the hosted Cockpit has it: shell basics, CLI settings, and every kind of secret and seam. */
const SERVER_ENV = Object.freeze({
  PATH: '/usr/bin:/bin', HOME: '/home/cockpit', LANG: 'C.UTF-8', NODE_PATH: '/x',
  CONSTRUCT_TEMPLATES_DIR: '/srv/templates', CONSTRUCT_STATE_DIR: '/srv/state', CONSTRUCT_CLI_VERSION: '1.2.3',
  CONSTRUCT_OLLAMA_URL: 'http://127.0.0.1:11434', CONSTRUCT_LLM_TIMEOUT_SEC: '30',
  CONSTRUCT_SESSION_SECRET: 'session-secret-0123456789abcdef',
  CONSTRUCT_GITHUB_CLIENT_SECRET: 'signin-client-secret',
  CONSTRUCT_GITHUB_REPO_CLIENT_SECRET: 'repo-client-secret',
  CONSTRUCT_GITHUB_CLIENT_ID: 'signin-client-id',
  CONSTRUCT_GITHUB_REPO_CLIENT_ID: 'repo-client-id',
  CONSTRUCT_AUTH_TEST_USER: 'e2e-owner',
  CONSTRUCT_ALLOWED_LOGINS: 'alice,bob',
  CONSTRUCT_WORKSPACE_ROOT: '/srv/workspace',
  CONSTRUCT_E2E_CLONE_LOCAL_ROOT: '/tmp/fixtures',
  CONSTRUCT_E2E_GITHUB_REPO_OAUTH_BASE: 'http://127.0.0.1:49210',
  CONSTRUCT_E2E_GITHUB_REPO_API_BASE: 'http://127.0.0.1:49210',
  CONSTRUCT_E2E_PROJECT_DIR: '/tmp/project',
  CONSTRUCT_SOMETHING_TOKEN: 'tok', CONSTRUCT_SOMETHING_PASSWORD: 'pw', CONSTRUCT_SOMETHING_KEY: 'key', CONSTRUCT_something_secret: 'lower',
  GITHUB_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 'aws', OPENAI_API_KEY: 'sk-x', DATABASE_PASSWORD: 'pw',
});
const SECRETS = ['session-secret-0123456789abcdef', 'signin-client-secret', 'repo-client-secret', 'e2e-owner', 'ghp_x', 'aws', 'sk-x', 'tok', 'pw', 'key', 'lower', '49210', '/tmp/fixtures', '/tmp/project'];

test('childEnv forwards the CLI settings and a shell\'s basics, and nothing secret-shaped, nothing e2e, nothing else', () => {
  const env = childEnv(SERVER_ENV);
  assert.deepEqual(env, {
    FORCE_COLOR: '0', NO_COLOR: '1',
    PATH: '/usr/bin:/bin', HOME: '/home/cockpit', LANG: 'C.UTF-8', NODE_PATH: '/x',
    CONSTRUCT_TEMPLATES_DIR: '/srv/templates', CONSTRUCT_STATE_DIR: '/srv/state', CONSTRUCT_CLI_VERSION: '1.2.3',
    CONSTRUCT_OLLAMA_URL: 'http://127.0.0.1:11434', CONSTRUCT_LLM_TIMEOUT_SEC: '30',
  });
  const text = JSON.stringify(env);
  for (const s of SECRETS) assert.ok(!text.includes(s), `${s} reached the child`);
  assert.ok(!Object.keys(env).some((k) => /_SECRET$|_TOKEN$|_PASSWORD$|_KEY$/i.test(k) || k.startsWith('CONSTRUCT_E2E_')));
});

test('a secret-shaped name is refused even if it were put on the allow-list', () => {
  // The suffix rule is the backstop for a future edit of CLI_ENV, not a list to keep in sync.
  for (const k of ['CONSTRUCT_TEMPLATES_DIR_SECRET', 'CONSTRUCT_STATE_DIR_TOKEN', 'CONSTRUCT_ROOT_PASSWORD', 'CONSTRUCT_CLI_VERSION_KEY']) {
    assert.ok(!(k in childEnv({ [k]: 'x', ...Object.fromEntries(CLI_ENV.map((n) => [n, 'v'])) })), k);
  }
});

/** A fake `construct` that records how it was spawned and prints a validation report. */
function fakeSpawn(spawns, stdout = '{"status":"passed","violations":[]}') {
  return (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    spawns.push({ cmd, args, opts });
    setImmediate(() => { child.stdout.once('end', () => child.emit('close', 0, null)); child.stdout.end(stdout); child.stderr.end(); });
    return child;
  };
}

test('runCliVerb and runValidate (cli mode) hand the child exactly childEnv(env): no secret from the server\'s environment', async () => {
  const spawns = [];
  const bin = path.join(here, 'coreExecutor.mjs'); // any file that exists
  await runCliVerb('/tmp/project', ['summarize', '--format', 'json'], { env: SERVER_ENV, bin, spawnImpl: fakeSpawn(spawns) });
  await runValidate('/tmp/project', { mode: 'cli', env: SERVER_ENV, bin, spawnImpl: fakeSpawn(spawns) });
  assert.equal(spawns.length, 2);
  for (const s of spawns) {
    assert.deepEqual(s.opts.env, childEnv(SERVER_ENV));
    const text = JSON.stringify(s.opts.env);
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} reached the child`);
    assert.equal(s.opts.cwd, '/tmp/project');
    assert.equal(s.args[0], bin);
  }
});

test('CLI_ENV is exactly the CONSTRUCT_* variables the CLI packages read, so a new setting is added on purpose, never by a prefix', () => {
  const packages = path.resolve(here, '..', '..', '..', 'packages');
  const read = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(p); continue; }
      if (!/\.(mjs|js|ts)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      // `process.env.X` / `env.X` reads, and a quoted name in an env allow-list (botRunner's MODEL_ENV).
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/\benv\.(CONSTRUCT_[A-Z0-9_]+)|'(CONSTRUCT_[A-Z0-9_]+)'/g)) read.add(m[1] ?? m[2]);
    }
  };
  for (const pkg of ['cli', 'core', 'engine']) walk(path.join(packages, pkg));
  assert.deepEqual([...read].sort(), [...CLI_ENV].sort(), 'read by a package but not forwarded (add it to CLI_ENV; it must not be a secret), or forwarded but read by nothing (remove it)');
  assert.ok(CLI_ENV.every((n) => !/_SECRET$|_TOKEN$|_PASSWORD$|_KEY$/i.test(n) && !n.startsWith('CONSTRUCT_E2E_')));
});
