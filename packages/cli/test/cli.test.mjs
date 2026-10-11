// LINE-MODULE: @line/construct's own tests: the real command answers --version from package.json and --help with the
// usage, and the mock (mock.mjs) answers the same invocations with the same exit codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getVersion } from '../version.mjs';
import { createConstructMock, getVersion as mockVersion } from '../mock.mjs';

const BIN = fileURLToPath(new URL('../construct.mjs', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const run = (...argv) => spawnSync(process.execPath, [BIN, ...argv], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_CLI_VERSION: '' } });

test('getVersion is package.json "version"', () => {
  assert.equal(getVersion(), pkg.version);
});

test('construct --version prints the version and exits 0; the mock does the same with its own version', async () => {
  const r = run('--version');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
  const m = await createConstructMock()({ argv: ['--version'], cwd: process.cwd() });
  assert.equal(m.exitCode, 0);
  assert.equal(m.stdout.trim(), mockVersion());
});

test('construct --help exits 0 and lists registered commands; no command exits 2 (usage error), as in the mock', async () => {
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Registered commands/);
  assert.match(help.stdout, /construct validate/);
  const none = run();
  assert.equal(none.status, 2);
  const mock = createConstructMock({ answers: { validate: { exitCode: 1, stdout: '1 error' } } });
  assert.equal((await mock({ argv: ['--help'], cwd: '.' })).exitCode, 0);
  assert.equal((await mock({ argv: [], cwd: '.' })).exitCode, 2);
  assert.deepEqual(await mock({ argv: ['validate'], cwd: '.' }), { exitCode: 1, stdout: '1 error', stderr: '' });
  assert.equal((await mock({ argv: ['nope'], cwd: '.' })).exitCode, 2);
  assert.equal(mock.calls.length, 4);
});
