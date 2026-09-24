// #638 -- clone and pull with `useLogin: true` (the session's GitHub connection) instead of a pasted token, at the job
// level: the token reaches git only through the askpass pipe, only for github.com, never in a job, a log line or an
// error, is mutually exclusive with a pasted token, and a repository the connection cannot see gets its own answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { spawn as realSpawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { NOT_VISIBLE_CODE, NOT_VISIBLE_MESSAGE } from './cloneAuth.mjs';
import { createCloneJobs, stampPath } from './cloneJobs.mjs';

const LOGIN_TOKEN = 'ghu_loginTOKENabcdefghijklmnopqrstuvwx1234';
const PUBLIC = async () => [{ address: '140.82.112.3' }];
const dest = (args) => args[args.length - 1];

const sandbox = () => {
  const dir = fs.realpathSync(makeTempDir('clonelogin-'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws);
  return { dir, ws };
};

function fakeSpawn(onStart) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    child.wrote = [];
    child.stdio = [null, null, child.stderr, new Writable({ write(chunk, _e, cb) { child.wrote.push(chunk.toString('latin1')); cb(); } })];
    child.kill = () => { setImmediate(() => child.emit('close', null)); return true; };
    child.finish = (code) => child.emit('close', code);
    calls.push({ cmd, args, opts, child });
    onStart?.(child, args, opts);
    return child;
  };
  return { spawn, calls };
}

/** A login-token supplier that records who asked, and keeps the Buffers it handed out so zeroing can be checked. */
function supplier(token = LOGIN_TOKEN) {
  const asked = [];
  const handed = [];
  const loginToken = async (key) => {
    asked.push(key);
    if (token === null) return null;
    const b = Buffer.from(token, 'latin1');
    handed.push(b);
    return b;
  };
  return { loginToken, asked, handed };
}

/** Everything written to the console while `fn` runs. */
async function captureConsole(fn) {
  const lines = [];
  const orig = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    orig[m] = console[m];
    console[m] = (...a) => lines.push(a.map(String).join(' '));
  }
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines.join('\n');
}

function stampedClone(ws, name, url) {
  fs.mkdirSync(path.join(ws, name, '.git'), { recursive: true });
  fs.writeFileSync(path.join(ws, name, '.git', 'config'), `[remote "origin"]\n\turl = ${url}\n`);
  fs.writeFileSync(stampPath(path.join(ws, name)), JSON.stringify({ slug: name, url, branch: null, at: new Date().toISOString() }));
}

test('useLogin: git gets the login token only through the askpass pipe, and the job says so without holding it', async () => {
  const { ws } = sandbox();
  const s = supplier();
  const f = fakeSpawn((child, args) => fs.mkdirSync(dest(args)));
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn, loginToken: s.loginToken });
  const out = await captureConsole(async () => {
    const r = await jobs.start({ url: 'https://github.com/o/secret-repo', useLogin: true, sessionKey: 'alice' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(s.asked, ['alice'], 'the SESSION key the server derived, not anything from the client');
    const { args, opts, child } = f.calls[0];
    assert.ok(!args.some((a) => a.includes(LOGIN_TOKEN)), 'argv');
    assert.ok(!Object.values(opts.env).some((v) => String(v).includes(LOGIN_TOKEN)), 'env');
    assert.ok(args.includes('http.followRedirects=false'), 'no redirect to another host');
    assert.ok(args.includes('credential.helper='));
    assert.ok(!args.join(' ').includes('@'), 'no userinfo');
    assert.equal(args[args.length - 2], 'https://github.com/o/secret-repo.git');
    assert.equal(opts.stdio.length, 4, 'descriptor 3 is the token pipe');
    await new Promise((res) => setTimeout(res, 20));
    assert.deepEqual(child.wrote, [`${LOGIN_TOKEN}\n`]);
    // Output that echoes it is redacted like a pasted token.
    child.stderr.emit('data', Buffer.from(`remote: hello ${LOGIN_TOKEN}\n`));
    assert.ok(!JSON.stringify(jobs.list()).includes(LOGIN_TOKEN));
    child.finish(0);
    await r.done;
    const j = jobs.get(r.job.id);
    assert.equal(j.state, 'done');
    assert.equal(j.via, 'login');
    assert.equal(j.private, true);
    assert.ok(!JSON.stringify(j).includes(LOGIN_TOKEN));
    assert.match(j.log.join('\n'), /your GitHub login/);
  });
  assert.ok(!out.includes(LOGIN_TOKEN), 'nothing on the console');
  assert.ok(s.handed.every((b) => b.every((x) => x === 0)), 'the job zeroed the copy it was given');
});

test('useLogin is used only for github.com: another allowed host is refused BEFORE the token is even fetched', async () => {
  const { ws } = sandbox();
  const s = supplier();
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, hosts: ['github.com', 'gitlab.com'], lookup: PUBLIC, spawn: f.spawn, loginToken: s.loginToken });
  const r = await jobs.start({ url: 'https://gitlab.com/o/r', useLogin: true, sessionKey: 'alice' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.code, 'LOGIN_HOST_NOT_ALLOWED');
  assert.deepEqual(s.asked, []);
  assert.equal(f.calls.length, 0);
  // The same address without the login is fine (the host allowlist is a separate decision).
  const plain = await jobs.start({ url: 'https://gitlab.com/o/r' });
  assert.equal(plain.ok, true);
  f.calls[0].child.finish(1);
  await plain.done;
  // Lookalike hosts never get past the parsed-URL allowlist, login or not.
  for (const url of ['https://github.com.evil.example/o/r', 'https://evil.example/github.com/o/r', 'https://github.com@evil.example/o/r', 'https://evil.example/o/r#github.com']) {
    const x = await jobs.start({ url, useLogin: true, sessionKey: 'alice' });
    assert.equal(x.ok, false, url);
    assert.deepEqual(s.asked, [], url);
  }
});

test('a file:// source is refused for a login outside the test harness, and needs no credential inside it', async () => {
  const { dir, ws } = sandbox();
  const s = supplier();
  const f = fakeSpawn();
  const prod = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn, loginToken: s.loginToken });
  assert.equal((await prod.start({ url: `file://${dir}/x.git`, useLogin: true, sessionKey: 'a' })).ok, false);
  assert.deepEqual(s.asked, []);
});

test('useLogin and a pasted token are mutually exclusive, on start and on pull, and nothing is fetched or spawned', async () => {
  const { ws } = sandbox();
  const s = supplier();
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn, loginToken: s.loginToken });
  for (const fn of [
    () => jobs.start({ url: 'https://github.com/o/r', useLogin: true, token: 'ghp_abcdefghijklmnop', sessionKey: 'a' }),
    () => jobs.pull({ name: 'r', useLogin: true, token: 'ghp_abcdefghijklmnop', sessionKey: 'a' }),
  ]) {
    const r = await fn();
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.equal(r.code, 'BAD_AUTH_CHOICE');
  }
  for (const useLogin of ['true', 1, {}, []]) assert.equal((await jobs.start({ url: 'https://github.com/o/r', useLogin, sessionKey: 'a' })).code, 'BAD_AUTH_CHOICE');
  // An empty token field is "no token", not a second answer.
  const ok = await jobs.start({ url: 'https://github.com/o/r', useLogin: true, token: '', sessionKey: 'a' });
  assert.equal(ok.ok, true);
  f.calls[0].child.finish(1);
  await ok.done;
  assert.deepEqual(s.asked, ['a']);
});

test('no live connection: a distinct NOT_CONNECTED, nothing spawned, no partial directory', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn();
  for (const deps of [{ loginToken: supplier(null).loginToken }, {}, { loginToken: async () => { throw new Error(`boom ${LOGIN_TOKEN}`); } }]) {
    const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn, ...deps });
    const r = await jobs.start({ url: 'https://github.com/o/r', useLogin: true, sessionKey: 'a' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.equal(r.code, 'NOT_CONNECTED');
    assert.ok(!JSON.stringify(r).includes(LOGIN_TOKEN));
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(fs.readdirSync(ws), []);
});

test('a token fetched for a request that is then refused is zeroed, not left around', async () => {
  const { ws } = sandbox();
  fs.mkdirSync(path.join(ws, 'r')); // EXISTS
  const s = supplier();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: fakeSpawn().spawn, loginToken: s.loginToken });
  const r = await jobs.start({ url: 'https://github.com/o/r', useLogin: true, sessionKey: 'a' });
  assert.equal(r.code, 'EXISTS');
  assert.equal(s.handed.length, 1);
  assert.ok(s.handed[0].every((x) => x === 0));
});

test('a repository the connection cannot see: NOT_VISIBLE_TO_CONNECTION with the install / approval hint, never the AUTH wording, no secret', async () => {
  const { ws } = sandbox();
  const s = supplier();
  const f = fakeSpawn((child, args) => fs.mkdirSync(dest(args)));
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn, loginToken: s.loginToken });
  const r = await jobs.start({ url: 'https://github.com/Beroe-Max-Project/hidden', useLogin: true, sessionKey: 'a' });
  f.calls[0].child.stderr.emit('data', Buffer.from(`remote: Repository not found.\nfatal: repository 'https://x-access-token:${LOGIN_TOKEN}@github.com/Beroe-Max-Project/hidden.git/' not found\n`));
  f.calls[0].child.finish(128);
  await r.done;
  const j = jobs.get(r.job.id);
  assert.equal(j.state, 'failed');
  assert.equal(j.code, NOT_VISIBLE_CODE);
  assert.equal(j.code, 'NOT_VISIBLE_TO_CONNECTION');
  assert.equal(j.error, NOT_VISIBLE_MESSAGE);
  assert.match(j.error, /organisation owner/);
  assert.match(j.error, /app is not installed/);
  assert.ok(!JSON.stringify(j).includes(LOGIN_TOKEN));
  assert.equal(fs.existsSync(path.join(ws, 'hidden')), false, 'the partial copy is gone');
  // A pasted-token clone that fails the same way keeps the old code.
  const r2 = await jobs.start({ url: 'https://github.com/o/other', token: 'ghp_abcdefghijklmnop' });
  f.calls[1].child.stderr.emit('data', Buffer.from('remote: Repository not found.\n'));
  f.calls[1].child.finish(128);
  await r2.done;
  assert.equal(jobs.get(r2.job.id).code, 'AUTH');
});

test('Pull latest with the login: same pipe, same host rule, and the not-visible answer', async () => {
  const { ws } = sandbox();
  stampedClone(ws, 'mine', 'https://github.com/o/mine.git');
  stampedClone(ws, 'lab', 'https://gitlab.com/o/lab.git');
  const s = supplier();
  const f = fakeSpawn((child) => setImmediate(() => { child.stdout.emit('data', Buffer.from('Already up to date.\n')); child.finish(0); }));
  const jobs = createCloneJobs({ getRoot: () => ws, hosts: ['github.com', 'gitlab.com'], lookup: PUBLIC, spawn: f.spawn, loginToken: s.loginToken });
  const out = await captureConsole(async () => {
    const p = await jobs.pull({ name: 'mine', useLogin: true, sessionKey: 'alice' });
    assert.equal(p.ok, true, JSON.stringify(p));
    assert.equal(p.upToDate, true);
    assert.deepEqual(f.calls[0].child.wrote, [`${LOGIN_TOKEN}\n`]);
    assert.ok(!JSON.stringify(f.calls[0].args).includes(LOGIN_TOKEN));
    assert.ok(!JSON.stringify(f.calls[0].opts.env).includes(LOGIN_TOKEN));
    assert.ok(!JSON.stringify(p).includes(LOGIN_TOKEN));
  });
  assert.ok(!out.includes(LOGIN_TOKEN));
  assert.ok(s.handed.every((b) => b.every((x) => x === 0)));
  const other = await jobs.pull({ name: 'lab', useLogin: true, sessionKey: 'alice' });
  assert.equal(other.code, 'LOGIN_HOST_NOT_ALLOWED');
  assert.equal(f.calls.length, 1);
  const f2 = fakeSpawn((child) => setImmediate(() => { child.stdout.emit('data', Buffer.from('')); child.stderr.emit('data', Buffer.from("fatal: repository 'https://github.com/o/mine.git/' not found\n")); child.finish(128); }));
  const jobs2 = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f2.spawn, loginToken: s.loginToken });
  const denied = await jobs2.pull({ name: 'mine', useLogin: true, sessionKey: 'alice' });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, NOT_VISIBLE_CODE);
  assert.equal(denied.status, 403);
});

// ---- real git, local bare repository (harness-only file:// path) ---------------------------------------------------

test('REAL clone with the login (harness file:// source): origin stays plain and the token is on no disk', async () => {
  const { dir, ws } = sandbox();
  const fixtures = path.join(dir, 'fixtures');
  fs.mkdirSync(fixtures);
  const seed = path.join(dir, 'seed');
  fs.mkdirSync(seed);
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' };
  const g = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8', env }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  g(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), '# one\n');
  g(seed, 'add', '.');
  g(seed, 'commit', '-q', '-m', 'one');
  g(dir, 'clone', '-q', '--bare', seed, path.join(fixtures, 'demo.git'));
  const s = supplier();
  const jobs = createCloneJobs({ getRoot: () => ws, localRoot: fixtures, spawn: (c, a, o) => realSpawn(c, a, o), loginToken: s.loginToken });
  const r = await jobs.start({ url: `file://${path.join(fixtures, 'demo.git')}`, useLogin: true, sessionKey: 'alice' });
  assert.equal(r.ok, true, JSON.stringify(r));
  await r.done;
  assert.equal(jobs.get(r.job.id).state, 'done', JSON.stringify(jobs.get(r.job.id)));
  assert.equal(g(path.join(ws, 'demo'), 'remote', 'get-url', 'origin'), `file://${path.join(fixtures, 'demo.git')}`);
  const hits = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && fs.readFileSync(p).includes(LOGIN_TOKEN)) hits.push(p);
    }
  }
  assert.deepEqual(hits, []);
  assert.ok(!fs.readdirSync(os.tmpdir()).some((n) => n.startsWith(`construct-askpass-${process.pid}-`) && fs.existsSync(path.join(os.tmpdir(), n, 'askpass.sh'))));
});
