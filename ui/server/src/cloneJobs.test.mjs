// #330 -- the clone job runtime: what git is handed, the SSRF and destination checks, caps, cancel cleanup, and one
// REAL clone of a local bare repository (test-harness file:// path only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { cloneArgs, cloneEnv, createCloneJobs, dirBytes } from './cloneJobs.mjs';

const PUBLIC = async () => [{ address: '140.82.112.3' }];

function sandbox() {
  const dir = fs.realpathSync(makeTempDir('clone-'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws);
  return { dir, ws };
}

/** A fake `git` process: the test decides when and how it ends. */
function fakeSpawn(onStart) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = [];
    child.kill = (sig) => { child.killed.push(sig); setImmediate(() => child.emit('close', null)); return true; };
    child.finish = (code) => child.emit('close', code);
    calls.push({ cmd, args, opts, child });
    onStart?.(child, args);
    return child;
  };
  return { spawn, calls };
}

const dest = (args) => args[args.length - 1];

test('git is handed a locked-down argv and a scrubbed environment (never a shell)', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  const r = await jobs.start({ url: 'https://github.com/octocat/Hello-World', depth: 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const { cmd, args, opts } = f.calls[0];
  assert.equal(cmd, 'git');
  const joined = args.join(' ');
  for (const must of ['protocol.allow=never', 'protocol.https.allow=always', 'credential.helper=', 'core.hooksPath=/dev/null', 'http.followRedirects=false', 'http.curloptResolve=github.com:443:140.82.112.3', '--no-recurse-submodules', '--depth 1']) assert.ok(joined.includes(must), `missing ${must}: ${joined}`);
  assert.equal(args[args.length - 3], '--', 'the URL and destination come after --');
  assert.equal(args[args.length - 2], 'https://github.com/octocat/Hello-World.git');
  assert.equal(dest(args), path.join(ws, 'Hello-World'));
  assert.ok(!args.some((a) => /upload-pack|protocol\.file|protocol\.ext|protocol\.ssh|--recurse/.test(a)));
  assert.equal(opts.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(opts.env.GIT_ALLOW_PROTOCOL, 'https');
  assert.equal(opts.env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(opts.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(opts.shell, undefined);
  assert.deepEqual(Object.keys(opts.env).filter((k) => /proxy|token|ssh|askpass/i.test(k)), ['GIT_ASKPASS']);
  assert.equal(opts.env.GIT_ASKPASS, '/bin/false');
  assert.equal(opts.cwd, ws);
  f.calls[0].child.finish(0);
  await r.done;
});

test('cloneArgs allows the file protocol only for a harness-approved local source', () => {
  const local = { kind: 'file', url: 'file:///x/r.git' };
  assert.ok(!cloneArgs({ parsed: local, dest: '/w/r' }).includes('protocol.file.allow=always'));
  assert.ok(cloneArgs({ parsed: local, dest: '/w/r', allowLocal: true }).includes('protocol.file.allow=always'));
  assert.ok(!cloneArgs({ parsed: { kind: 'https', url: 'https://github.com/o/r.git' }, dest: '/w/r', allowLocal: true }).includes('protocol.file.allow=always'));
  assert.equal(cloneEnv({ allowLocal: true }).GIT_ALLOW_PROTOCOL, 'https:file');
  assert.equal(cloneEnv({ base: { PATH: '/bin', HTTPS_PROXY: 'http://evil', GITHUB_TOKEN: 't', SSH_AUTH_SOCK: '/s' } }).HTTPS_PROXY, undefined);
});

test('SSRF: a host that resolves to any non-public address is refused, and git is never started', async () => {
  const { ws } = sandbox();
  for (const answer of [['127.0.0.1'], ['10.0.0.8'], ['169.254.169.254'], ['192.168.0.1'], ['::1'], ['140.82.112.3', '127.0.0.1'], []]) {
    const f = fakeSpawn();
    const jobs = createCloneJobs({ getRoot: () => ws, lookup: async () => answer.map((address) => ({ address })), spawn: f.spawn });
    const r = await jobs.start({ url: 'https://github.com/o/r' });
    assert.equal(r.ok, false, answer.join(','));
    assert.equal(r.status, 403);
    assert.equal(f.calls.length, 0);
  }
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: async () => { throw new Error('ENOTFOUND'); }, spawn: fakeSpawn().spawn });
  assert.equal((await jobs.start({ url: 'https://github.com/o/r' })).code, 'HOST_UNRESOLVED');
});

test('hostile input never reaches git', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  for (const url of ['https://user:pw@github.com/o/r', '--upload-pack=touch /tmp/pwned', 'ext::sh -c id', 'file:///etc/passwd', 'ssh://git@github.com/o/r', 'https://evil.com/o/r', 'https://github.com/o/..']) {
    assert.equal((await jobs.start({ url })).ok, false, url);
  }
  for (const name of ['..', '../escape', 'a/b', '/abs', '.hidden', 'x.', '', ' ', '--upload-pack=x', 'ü', 'a\0b']) {
    if (name === '') continue; // empty means "derive from the URL"
    assert.equal((await jobs.start({ url: 'https://github.com/o/r', name })).ok, false, JSON.stringify(name));
  }
  assert.equal((await jobs.start({ url: 'https://github.com/o/r', depth: 0 })).code, 'BAD_DEPTH');
  assert.equal((await jobs.start({ url: 'https://github.com/o/r', depth: '5; rm -rf /' })).code, 'BAD_DEPTH');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(fs.readdirSync(ws), []);
});

test('destination: an existing folder, file, or symlink at the name is refused; nothing is changed', async () => {
  const { dir, ws } = sandbox();
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(ws, 'taken'));
  fs.writeFileSync(path.join(ws, 'taken', 'keep.txt'), 'mine');
  fs.writeFileSync(path.join(ws, 'afile'), 'x');
  fs.symlinkSync(outside, path.join(ws, 'link'));
  fs.symlinkSync(path.join(dir, 'nowhere'), path.join(ws, 'dangling'));
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  for (const name of ['taken', 'afile', 'link', 'dangling']) {
    const r = await jobs.start({ url: 'https://github.com/o/r', name });
    assert.equal(r.ok, false, name);
    assert.ok([403, 409].includes(r.status), `${name}: ${r.status}`);
  }
  assert.equal(fs.readFileSync(path.join(ws, 'taken', 'keep.txt'), 'utf8'), 'mine');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(f.calls.length, 0);
});

test('only one clone at a time; a second is refused until the first ends', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  const a = await jobs.start({ url: 'https://github.com/o/one' });
  assert.equal(a.ok, true);
  const b = await jobs.start({ url: 'https://github.com/o/two' });
  assert.equal(b.code, 'BUSY');
  f.calls[0].child.finish(0);
  await a.done;
  const c = await jobs.start({ url: 'https://github.com/o/two' });
  assert.equal(c.ok, true);
  f.calls[1].child.finish(0);
  await c.done;
});

test('cancel stops the process group and removes the partial directory', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn((child, args) => {
    fs.mkdirSync(dest(args));
    fs.writeFileSync(path.join(dest(args), 'partial.pack'), 'x'.repeat(100));
  });
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  const r = await jobs.start({ url: 'https://github.com/o/r' });
  assert.ok(fs.existsSync(path.join(ws, 'r')));
  const c = jobs.cancel(r.job.id);
  assert.equal(c.status, 200);
  assert.equal(c.body.job.state, 'cancelling');
  await r.done;
  assert.equal(jobs.get(r.job.id).state, 'cancelled');
  assert.equal(fs.existsSync(path.join(ws, 'r')), false, 'the partial copy is gone');
  assert.equal(jobs.cancel(r.job.id).status, 409);
  assert.equal(jobs.cancel('nope').status, 404);
  assert.equal(jobs.live(), 0);
});

test('a failed clone (git exits non-zero) is reported and its partial directory removed', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn((child, args) => { fs.mkdirSync(dest(args)); });
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  const r = await jobs.start({ url: 'https://github.com/o/private' });
  f.calls[0].child.stderr.emit('data', Buffer.from("fatal: could not read Username for 'https://github.com'\n"));
  f.calls[0].child.finish(128);
  await r.done;
  const j = jobs.get(r.job.id);
  assert.equal(j.state, 'failed');
  assert.match(j.error, /public repository/);
  assert.equal(fs.existsSync(path.join(ws, 'private')), false);
});

test('the size cap kills the clone and removes what it wrote', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn((child, args) => {
    fs.mkdirSync(dest(args));
    fs.writeFileSync(path.join(dest(args), 'huge.pack'), Buffer.alloc(4096));
  });
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn, maxBytes: 1024, sizePollMs: 20 });
  const r = await jobs.start({ url: 'https://github.com/o/big' });
  await r.done;
  const j = jobs.get(r.job.id);
  assert.equal(j.state, 'failed');
  assert.match(j.error, /larger than the/);
  assert.equal(fs.existsSync(path.join(ws, 'big')), false);
});

test('the time cap kills the clone and removes what it wrote', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn((child, args) => { fs.mkdirSync(dest(args)); });
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn, timeoutMs: 30, sizePollMs: 1000 });
  const r = await jobs.start({ url: 'https://github.com/o/slow' });
  await r.done;
  const j = jobs.get(r.job.id);
  assert.equal(j.state, 'failed');
  assert.match(j.error, /took longer than/);
  assert.equal(fs.existsSync(path.join(ws, 'slow')), false);
});

test('progress lines from git are kept short and printable, and shown as the job progress', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  const r = await jobs.start({ url: 'https://github.com/o/r' });
  f.calls[0].child.stderr.emit('data', Buffer.from('Receiving objects:  10% (1/10)\rReceiving objects:  50% (5/10)\r\u001b[31mevil\u0007\n'));
  const j = jobs.get(r.job.id);
  assert.equal(j.progress, '[31mevil');
  assert.equal(j.log.filter((l) => l.startsWith('Receiving')).length, 1, 'percent noise is collapsed');
  f.calls[0].child.finish(0);
  await r.done;
});

test('a REAL clone of a local bare repository (harness-only file:// path) leaves a normal git repo with origin set', async () => {
  const { dir, ws } = sandbox();
  const fixtures = path.join(dir, 'fixtures');
  fs.mkdirSync(fixtures);
  const seed = path.join(dir, 'seed');
  const g = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  fs.mkdirSync(seed);
  g(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), '# hello\n');
  // a hook that would run on clone/checkout if hooks were honoured
  g(seed, 'add', '.');
  g(seed, 'commit', '-q', '-m', 'init');
  g(dir, 'clone', '-q', '--bare', seed, path.join(fixtures, 'demo.git'));
  const jobs = createCloneJobs({ getRoot: () => ws, localRoot: fixtures });
  const r = await jobs.start({ url: `file://${path.join(fixtures, 'demo.git')}` });
  assert.equal(r.ok, true, JSON.stringify(r));
  await r.done;
  const j = jobs.get(r.job.id);
  assert.equal(j.state, 'done', JSON.stringify(j));
  assert.equal(j.dir, path.join(ws, 'demo'));
  assert.equal(fs.readFileSync(path.join(ws, 'demo', 'README.md'), 'utf8'), '# hello\n');
  assert.equal(g(path.join(ws, 'demo'), 'remote', 'get-url', 'origin'), `file://${path.join(fixtures, 'demo.git')}`);
  assert.equal((await jobs.start({ url: `file://${path.join(fixtures, 'demo.git')}` })).code, 'EXISTS');
  // outside the fixtures directory is refused even in harness mode
  assert.equal((await jobs.start({ url: `file://${seed}` })).ok, false);
});

test('dirBytes counts files and never follows a symlink', () => {
  const { dir } = sandbox();
  const d = path.join(dir, 'd');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'a'), Buffer.alloc(1000));
  fs.symlinkSync(dir, path.join(d, 'loop'));
  assert.ok(dirBytes(d) >= 1000 && dirBytes(d) < 100000);
  assert.ok(dirBytes(d, 10) > 10, 'stops early once past the limit');
});
