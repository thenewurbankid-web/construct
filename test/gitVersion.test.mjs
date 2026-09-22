// #423 -- gitVersion: parse what `git --version` prints, compare against the http.curloptResolve minimum (2.37.0,
// from git's own 2.37.0 release notes), report a missing or broken git as data, cache per process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_GIT_FOR_CURLOPT_RESOLVE, atLeast, formatVersion, gitVersion, parseGitVersion, resetGitVersionCache, supportsCurloptResolve,
} from '../packages/engine/gitVersion.mjs';

test('the minimum is the release that introduced http.curloptResolve: 2.37.0', () => {
  assert.deepEqual({ ...MIN_GIT_FOR_CURLOPT_RESOLVE }, { major: 2, minor: 37, patch: 0 });
  assert.equal(formatVersion(MIN_GIT_FOR_CURLOPT_RESOLVE), '2.37.0');
});

test('parseGitVersion reads every shape git prints', () => {
  assert.deepEqual(parseGitVersion('git version 2.53.0\n'), { major: 2, minor: 53, patch: 0, version: '2.53.0' });
  assert.deepEqual(parseGitVersion('git version 2.39.2 (Apple Git-143)'), { major: 2, minor: 39, patch: 2, version: '2.39.2' });
  assert.deepEqual(parseGitVersion('git version 2.45.1.windows.1'), { major: 2, minor: 45, patch: 1, version: '2.45.1' });
  assert.deepEqual(parseGitVersion('git version 2.37'), { major: 2, minor: 37, patch: 0, version: '2.37.0' });
  assert.equal(parseGitVersion('not git'), null);
  assert.equal(parseGitVersion(''), null);
  assert.equal(parseGitVersion(undefined), null);
});

test('atLeast / supportsCurloptResolve: 2.36.x is too old, 2.37.0 and anything newer is fine', () => {
  const v = (s) => parseGitVersion(`git version ${s}`);
  assert.equal(supportsCurloptResolve(v('2.36.6')), false);
  assert.equal(supportsCurloptResolve(v('2.37.0')), true);
  assert.equal(supportsCurloptResolve(v('2.37.1')), true);
  assert.equal(supportsCurloptResolve(v('2.53.0')), true);
  assert.equal(supportsCurloptResolve(v('3.0.0')), true);
  assert.equal(supportsCurloptResolve(v('1.9.5')), false);
  assert.equal(supportsCurloptResolve(null), false);
  assert.equal(supportsCurloptResolve({ ok: false, error: 'missing' }), false);
  assert.equal(atLeast({ major: 2, minor: 37 }, MIN_GIT_FOR_CURLOPT_RESOLVE), true, 'a missing patch counts as 0');
});

const fakeSpawn = (result) => {
  const calls = [];
  return { calls, spawn: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return result; } };
};

test('gitVersion: argv only, scrubbed environment, bounded, parsed', () => {
  resetGitVersionCache();
  const f = fakeSpawn({ status: 0, stdout: 'git version 2.53.0\n', stderr: '' });
  const r = gitVersion({ spawn: f.spawn, cache: false });
  assert.deepEqual(r, { ok: true, major: 2, minor: 53, patch: 0, version: '2.53.0', raw: 'git version 2.53.0' });
  assert.equal(f.calls[0].cmd, 'git');
  assert.deepEqual(f.calls[0].args, ['--version']);
  assert.ok(f.calls[0].opts.timeout > 0);
  assert.equal(f.calls[0].opts.killSignal, 'SIGKILL');
  assert.equal(f.calls[0].opts.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(f.calls[0].opts.env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(f.calls[0].opts.shell, undefined);
});

test('gitVersion: a missing git, a timeout, a non-zero exit and unreadable output are each data, never a throw', () => {
  const missing = gitVersion({ spawn: fakeSpawn({ error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) }).spawn, cache: false });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /git could not be started \(ENOENT\)/);
  const hung = gitVersion({ spawn: fakeSpawn({ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), signal: 'SIGKILL' }).spawn, cache: false });
  assert.match(hung.error, /did not answer within 30 seconds/);
  const broken = gitVersion({ spawn: fakeSpawn({ status: 127, stdout: '', stderr: 'libc mismatch' }).spawn, cache: false });
  assert.match(broken.error, /exited with status 127: libc mismatch/);
  const odd = gitVersion({ spawn: fakeSpawn({ status: 0, stdout: 'hello', stderr: '' }).spawn, cache: false });
  assert.match(odd.error, /Could not read a version from "hello"/);
});

test('gitVersion caches a success per process, re-asks after a failure', () => {
  resetGitVersionCache();
  const bad = fakeSpawn({ error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) });
  assert.equal(gitVersion({ spawn: bad.spawn }).ok, false);
  assert.equal(gitVersion({ spawn: bad.spawn }).ok, false);
  assert.equal(bad.calls.length, 2, 'a failure is not cached');
  const good = fakeSpawn({ status: 0, stdout: 'git version 2.40.0', stderr: '' });
  assert.equal(gitVersion({ spawn: good.spawn }).version, '2.40.0');
  assert.equal(gitVersion({ spawn: good.spawn }).version, '2.40.0');
  assert.equal(good.calls.length, 1, 'a success is cached');
  resetGitVersionCache();
});

test('gitVersion against the real git on this machine answers ok with a parsable version', () => {
  resetGitVersionCache();
  const r = gitVersion({ cache: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.version, /^\d+\.\d+\.\d+$/);
});
