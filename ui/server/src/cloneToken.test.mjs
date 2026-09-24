// #330 slice B -- a clone with a one-time access token, at the job level: what git is handed (never the token), the
// per-job helper's lifetime, redaction of everything that reaches the client, what is left on disk, and "Pull latest".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { spawn as realSpawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { AUTH_MESSAGE, AUTH_MESSAGE_WITH_TOKEN } from './cloneAuth.mjs';
import { UNSAFE_PULL_CONFIG, createCloneJobs, stampPath, unsafeConfigKeys } from './cloneJobs.mjs';

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const PUBLIC = async () => [{ address: '140.82.112.3' }];
const dest = (args) => args[args.length - 1];

function sandbox() {
  const dir = fs.realpathSync(makeTempDir('clonetoken-'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws);
  return { dir, ws };
}

/** A fake git whose descriptor 3 records what the server writes to it. */
function fakeSpawn(onStart) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
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

const askpassDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`construct-askpass-${process.pid}-`));

/** Every file under `root` (following nothing) that contains `needle`. */
function grepTree(root, needle) {
  const hits = [];
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && fs.readFileSync(p).includes(needle)) hits.push(p);
    }
  }
  return hits;
}

test('with a token: git gets no secret in argv or environment, only the per-job helper and a pipe', async () => {
  const { ws } = sandbox();
  const before = askpassDirs().length;
  let seenHelper = null;
  let markerText = null;
  const f = fakeSpawn((child, args, opts) => {
    fs.mkdirSync(dest(args));
    const helper = opts.env.GIT_ASKPASS;
    seenHelper = { path: helper, dirMode: fs.statSync(path.dirname(helper)).mode & 0o777, mode: fs.statSync(helper).mode & 0o777, text: fs.readFileSync(helper, 'utf8') };
    markerText = fs.readdirSync(ws).filter((n) => n.startsWith('.construct-clone-')).map((n) => fs.readFileSync(path.join(ws, n), 'utf8')).join('');
  });
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  const r = await jobs.start({ url: 'https://github.com/o/secret-repo', token: SECRET });
  assert.equal(r.ok, true, JSON.stringify(r));
  const { args, opts, child } = f.calls[0];
  assert.ok(!args.some((a) => a.includes(SECRET)), 'argv');
  assert.ok(!Object.values(opts.env).some((v) => String(v).includes(SECRET)), 'env values');
  assert.ok(!Object.keys(opts.env).some((k) => /token|secret|password/i.test(k)), 'env names');
  assert.ok(args.includes('credential.helper='), 'credential.helper stays cleared');
  assert.ok(!args.join(' ').includes('extraHeader'), 'http.extraHeader is never used');
  assert.ok(!args.join(' ').includes('@'), 'no userinfo in any argument');
  assert.equal(opts.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(opts.shell, undefined);
  assert.equal(opts.stdio.length, 4, 'descriptor 3 is the token pipe');
  assert.equal(args[args.length - 2], 'https://github.com/o/secret-repo.git', 'the plain https URL');
  // The helper: a server-owned 0700 directory, a 0700 script, and no secret inside it.
  assert.equal(seenHelper.dirMode, 0o700);
  assert.equal(seenHelper.mode, 0o700);
  assert.ok(!seenHelper.text.includes(SECRET));
  assert.ok(path.basename(path.dirname(seenHelper.path)).startsWith(`construct-askpass-${process.pid}-`));
  // The token went down the pipe, once, and only there.
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(child.wrote, [`${SECRET}\n`]);
  // The marker written to disk names no secret.
  assert.ok(markerText && !markerText.includes(SECRET));
  // Output that echoes the token (or a URL with credentials) is redacted before it can reach any client.
  child.stderr.emit('data', Buffer.from(`fatal: Authentication failed for 'https://x-access-token:${SECRET}@github.com/o/secret-repo.git/'\nremote: bad ${SECRET}\n`));
  assert.ok(!JSON.stringify(jobs.list()).includes(SECRET), 'live job JSON');
  child.finish(128);
  await r.done;
  const j = jobs.get(r.job.id);
  assert.equal(j.state, 'failed');
  assert.equal(j.code, 'AUTH');
  assert.equal(j.error, AUTH_MESSAGE_WITH_TOKEN);
  assert.equal(j.private, true);
  assert.ok(!JSON.stringify(j).includes(SECRET), 'finished job JSON');
  assert.ok(!JSON.stringify(jobs.list()).includes(SECRET));
  // The helper and its directory are gone with the job, and the partial clone with them.
  assert.equal(fs.existsSync(seenHelper.path), false);
  assert.equal(fs.existsSync(path.dirname(seenHelper.path)), false);
  assert.equal(askpassDirs().length, before);
  assert.equal(fs.existsSync(path.join(ws, 'secret-repo')), false);
  assert.deepEqual(grepTree(ws, SECRET), []);
});

test('without a token nothing is created for one: a plain pipe set, the refusing helper, no directory', async () => {
  const { ws } = sandbox();
  const before = askpassDirs().length;
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  const r = await jobs.start({ url: 'https://github.com/o/public-repo' });
  assert.equal(f.calls[0].opts.stdio.length, 3);
  assert.equal(f.calls[0].opts.env.GIT_ASKPASS, '/bin/false');
  assert.equal(askpassDirs().length, before);
  assert.equal(jobs.get(r.job.id).private, false);
  f.calls[0].child.stderr.emit('data', Buffer.from("fatal: could not read Username for 'https://github.com': terminal prompts disabled\n"));
  f.calls[0].child.finish(128);
  await r.done;
  assert.equal(jobs.get(r.job.id).error, AUTH_MESSAGE);
});

test('a hostile token is refused before anything runs, and the refusal never repeats it', async () => {
  const { ws } = sandbox();
  const before = askpassDirs().length;
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  for (const token of [`${SECRET} x`, `${SECRET}\n`, `${SECRET}\0`, `\t${SECRET}`, 'a'.repeat(300), 42, {}, [SECRET], `${SECRET}ü`]) {
    const r = await jobs.start({ url: 'https://github.com/o/r', token });
    assert.equal(r.ok, false, JSON.stringify(token));
    assert.equal(r.status, 400);
    assert.equal(r.code, 'BAD_TOKEN');
    assert.ok(!JSON.stringify(r).includes(SECRET));
  }
  assert.equal(f.calls.length, 0);
  assert.equal(askpassDirs().length, before);
  assert.deepEqual(fs.readdirSync(ws), []);
});

test('a token is only ever used for an allowlisted https address', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  for (const url of ['https://evil.example/o/r', 'http://github.com/o/r', 'https://github.com@evil.example/o/r', 'https://user:pw@github.com/o/r', 'file:///etc', 'ssh://git@github.com/o/r', 'git@github.com:o/r.git']) {
    const r = await jobs.start({ url, token: SECRET });
    assert.equal(r.ok, false, url);
    assert.ok(!JSON.stringify(r).includes(SECRET));
  }
  const private_ = createCloneJobs({ getRoot: () => ws, lookup: async () => [{ address: '10.0.0.5' }], spawn: f.spawn });
  assert.equal((await private_.start({ url: 'https://github.com/o/r', token: SECRET })).code, 'HOST_NOT_PUBLIC');
  assert.equal(f.calls.length, 0);
});

test('a branch is a closed set and reaches git only as its own argument after --branch', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn();
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  for (const branch of ['--upload-pack=x', '-b', 'a b', 'a..b', 'x;id', '$(id)', '../x', 'a//b', 'trail/', 'x.lock', '.hidden', 'a\nb', 5]) {
    assert.equal((await jobs.start({ url: 'https://github.com/o/r', branch })).code, 'BAD_BRANCH', JSON.stringify(branch));
  }
  assert.equal(f.calls.length, 0);
  const r = await jobs.start({ url: 'https://github.com/o/r', branch: 'release/1.2' });
  assert.equal(r.ok, true);
  const a = f.calls[0].args;
  assert.equal(a[a.indexOf('--branch') + 1], 'release/1.2');
  assert.ok(a.indexOf('--branch') < a.indexOf('--'));
  f.calls[0].child.finish(0);
  await r.done;
});

test('a finished clone that recorded credentials is rewritten to the plain URL; one that would keep the token is removed', async () => {
  const { ws } = sandbox();
  const cred = `[remote "origin"]\n\turl = https://x-access-token:${SECRET}@github.com/o/leaky.git\n`;
  const f = fakeSpawn((child, args) => {
    const d = dest(args);
    fs.mkdirSync(path.join(d, '.git'), { recursive: true });
    fs.writeFileSync(path.join(d, '.git', 'config'), d.endsWith('keeps') ? `[core]\n\tnote = ${SECRET}\n${cred}` : cred);
  });
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  const ok = await jobs.start({ url: 'https://github.com/o/leaky', token: SECRET });
  f.calls[0].child.finish(0);
  await ok.done;
  assert.equal(jobs.get(ok.job.id).state, 'done');
  const cfg = fs.readFileSync(path.join(ws, 'leaky', '.git', 'config'), 'utf8');
  assert.ok(!cfg.includes(SECRET) && !cfg.includes('x-access-token'));
  assert.match(cfg, /url = https:\/\/github\.com\/o\/leaky\.git\n/);
  assert.equal(JSON.parse(fs.readFileSync(stampPath(path.join(ws, 'leaky')), 'utf8')).url, 'https://github.com/o/leaky.git');
  assert.deepEqual(grepTree(ws, SECRET), []);
  const bad = await jobs.start({ url: 'https://github.com/o/leaky', name: 'keeps', token: SECRET });
  f.calls[1].child.finish(0);
  await bad.done;
  const j = jobs.get(bad.job.id);
  assert.equal(j.state, 'failed');
  assert.match(j.error, /must never be stored/);
  assert.equal(fs.existsSync(path.join(ws, 'keeps')), false);
  assert.ok(!JSON.stringify(j).includes(SECRET));
});

// ---- real git, local bare repository (harness-only file:// path) ---------------------------------------------------

const ident = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' };
function g(cwd, ...a) {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, ...ident } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function fixture() {
  const { dir, ws } = sandbox();
  const fixtures = path.join(dir, 'fixtures');
  fs.mkdirSync(fixtures);
  const seed = path.join(dir, 'seed');
  fs.mkdirSync(seed);
  g(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), '# one\n');
  g(seed, 'add', '.');
  g(seed, 'commit', '-q', '-m', 'one');
  g(dir, 'clone', '-q', '--bare', seed, path.join(fixtures, 'demo.git'));
  g(seed, 'remote', 'add', 'bare', path.join(fixtures, 'demo.git'));
  return { dir, ws, fixtures, seed, url: `file://${path.join(fixtures, 'demo.git')}`, publish: (file, text) => { fs.writeFileSync(path.join(seed, file), text); g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', file); g(seed, 'push', '-q', 'bare', 'main'); } };
}

test('REAL clone with a token: origin is the plain URL, and the token is on no disk, in no job, in no environment', async () => {
  const fx = fixture();
  const spy = [];
  const jobs = createCloneJobs({ getRoot: () => fx.ws, localRoot: fx.fixtures, spawn: (cmd, args, opts) => { spy.push({ args, env: opts.env }); return realSpawn(cmd, args, opts); } });
  const r = await jobs.start({ url: fx.url, token: SECRET, branch: 'main' });
  assert.equal(r.ok, true, JSON.stringify(r));
  await r.done;
  const j = jobs.get(r.job.id);
  assert.equal(j.state, 'done', JSON.stringify(j));
  const d = path.join(fx.ws, 'demo');
  assert.equal(g(d, 'remote', 'get-url', 'origin'), fx.url);
  assert.equal(g(d, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.deepEqual(grepTree(fx.dir, SECRET), [], 'no file anywhere in the sandbox holds the token');
  assert.ok(!JSON.stringify(j).includes(SECRET));
  assert.ok(!JSON.stringify(spy).includes(SECRET));
  assert.ok(!JSON.stringify(process.env).includes(SECRET));
  assert.equal(fs.existsSync(stampPath(d)), true);
  assert.deepEqual(fs.readdirSync(fx.ws), ['demo'], 'no marker left behind');
  assert.ok(!askpassDirs().some((n) => fs.existsSync(path.join(os.tmpdir(), n, 'askpass.sh'))), 'the helper was removed');
});

test('Pull latest: fast-forwards a clone we made, says "already up to date", and refuses everything else', async () => {
  const fx = fixture();
  const spy = [];
  const jobs = createCloneJobs({ getRoot: () => fx.ws, localRoot: fx.fixtures, spawn: (cmd, args, opts) => { spy.push({ args, env: opts.env }); return realSpawn(cmd, args, opts); } });
  const r = await jobs.start({ url: fx.url });
  await r.done;
  assert.equal(jobs.get(r.job.id).state, 'done');
  spy.length = 0;
  fx.publish('two.txt', 'new\n');
  const p = await jobs.pull({ name: 'demo', token: SECRET });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.upToDate, false);
  assert.equal(fs.readFileSync(path.join(fx.ws, 'demo', 'two.txt'), 'utf8'), 'new\n');
  assert.ok(spy[0].args.includes('--ff-only') && spy[0].args.includes('pull'));
  assert.ok(!JSON.stringify(spy).includes(SECRET) && !JSON.stringify(p).includes(SECRET));
  assert.equal((await jobs.pull({ name: 'demo' })).upToDate, true);
  assert.deepEqual(grepTree(fx.dir, SECRET), []);
  // Refusals: bad names, missing, not ours, symlinked, re-pointed origin, diverged history, hostile token.
  for (const name of ['..', '../ws', 'a/b', '', '.hidden', '--upload-pack=x']) assert.equal((await jobs.pull({ name })).ok, false, name);
  assert.equal((await jobs.pull({ name: 'ghost' })).status, 404);
  fs.mkdirSync(path.join(fx.ws, 'foreign'));
  g(path.join(fx.ws, 'foreign'), 'init', '-q');
  assert.equal((await jobs.pull({ name: 'foreign' })).code, 'NOT_A_COCKPIT_CLONE');
  fs.symlinkSync(path.join(fx.ws, 'demo'), path.join(fx.ws, 'link'));
  assert.equal((await jobs.pull({ name: 'link' })).ok, false);
  assert.equal((await jobs.pull({ name: 'demo', token: 'has space' })).code, 'BAD_TOKEN');
  // diverged: a local commit the remote does not have, plus a remote commit the clone does not have
  fs.writeFileSync(path.join(fx.ws, 'demo', 'mine.txt'), 'mine\n');
  g(path.join(fx.ws, 'demo'), 'add', '.');
  g(path.join(fx.ws, 'demo'), 'commit', '-q', '-m', 'mine');
  fx.publish('three.txt', 'x\n');
  const div = await jobs.pull({ name: 'demo' });
  assert.equal(div.code, 'DIVERGED');
  assert.equal(fs.existsSync(path.join(fx.ws, 'demo', 'three.txt')), false, 'nothing was changed');
  // a re-pointed origin is no longer one we vouch for
  g(path.join(fx.ws, 'demo'), 'remote', 'set-url', 'origin', 'file:///elsewhere');
  assert.equal((await jobs.pull({ name: 'demo' })).code, 'ORIGIN_CHANGED');
});

test('unsafeConfigKeys: section.name, case-insensitive, any subsection (dots and all); a fresh clone\'s own keys pass', () => {
  assert.deepEqual(unsafeConfigKeys(['core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'remote.origin.url', 'remote.origin.fetch', 'branch.main.remote', 'branch.main.merge', 'user.email', 'pull.rebase']), []);
  assert.deepEqual(unsafeConfigKeys(['url.https://evil.example/.insteadof']), ['url.*.insteadof']);
  assert.deepEqual(unsafeConfigKeys(['URL.x.InsteadOf', 'Include.Path']), ['url.*.insteadof', 'include.*']);
  assert.deepEqual(unsafeConfigKeys(['http.https://github.com/.extraheader', 'http.proxy']), ['http.*']);
  assert.deepEqual(unsafeConfigKeys(['includeif.gitdir:/x/.path']), ['includeif.*']);
  assert.deepEqual(unsafeConfigKeys(['remote.origin.proxy', 'remote.origin.vcs', 'remote.origin.url']), ['remote.*.proxy', 'remote.*.vcs']);
  assert.deepEqual(unsafeConfigKeys(['merge.x.driver', 'diff.x.command', 'filter.lfs.clean', 'protocol.allow', 'credential.helper', 'core.sshcommand', 'core.hookspath', 'core.fsmonitor', 'core.gitproxy', 'url.x.pushinsteadof']).sort(), ['core.fsmonitor', 'core.gitproxy', 'core.hookspath', 'core.sshcommand', 'credential.*', 'diff.*.command', 'filter.*', 'merge.*.driver', 'protocol.*', 'url.*.pushinsteadof']);
  assert.deepEqual(unsafeConfigKeys(['merge.renames', 'diff.renames', 'nodot', '']), [], 'only the named keys of merge/diff, not the sections');
  assert.ok(UNSAFE_PULL_CONFIG.includes('url.*.insteadof'));
});

test('Pull latest refuses a clone whose .git/config could re-route the update or its credential (insteadOf, http.*, include, ...): nothing fetched, no token fetched or passed', async () => {
  const fx = fixture();
  const spy = [];
  const asked = [];
  const jobs = createCloneJobs({
    getRoot: () => fx.ws, localRoot: fx.fixtures,
    spawn: (cmd, args, opts) => { spy.push({ args, env: opts.env }); return realSpawn(cmd, args, opts); },
    loginToken: async (k) => { asked.push(k); return Buffer.from(SECRET, 'latin1'); },
  });
  const r = await jobs.start({ url: fx.url });
  await r.done;
  assert.equal(jobs.get(r.job.id).state, 'done');
  const d = path.join(fx.ws, 'demo');
  fx.publish('two.txt', 'new\n');
  // The attack: something that ran inside the clone re-routes every file:// (or https://github.com/) address.
  g(d, 'config', 'url.file:///elsewhere/.insteadOf', 'file://');
  assert.equal(g(d, 'config', '--get', 'remote.origin.url'), fx.url, 'the origin line itself is untouched, which is why the old check passed');
  spy.length = 0;
  for (const opts of [{ name: 'demo', useLogin: true, sessionKey: 'alice' }, { name: 'demo', token: SECRET }, { name: 'demo' }]) {
    const p = await jobs.pull(opts);
    assert.equal(p.ok, false, JSON.stringify(p));
    assert.equal(p.status, 409);
    assert.equal(p.code, 'UNSAFE_CONFIG');
    assert.match(p.error, /url\.\*\.insteadof/);
    assert.ok(!p.error.includes('elsewhere'), 'the value is not echoed');
    assert.ok(!JSON.stringify(p).includes(SECRET));
  }
  assert.deepEqual(asked, [], 'the login token was never fetched');
  assert.deepEqual(spy, [], 'git pull was never started');
  assert.equal(fs.existsSync(path.join(d, 'two.txt')), false, 'nothing was fetched');
  assert.deepEqual(grepTree(fx.dir, SECRET), []);
  assert.ok(!askpassDirs().some((n) => fs.existsSync(path.join(os.tmpdir(), n, 'askpass.sh'))), 'no helper was made');
  g(d, 'config', '--unset', 'url.file:///elsewhere/.insteadOf');
  // Every other listed setting, one at a time.
  for (const [k, v] of [
    ['url.file:///x/.pushInsteadOf', 'file://'], ['include.path', '/dev/null'], ['includeIf.gitdir:/x/.path', '/dev/null'],
    ['http.proxy', 'http://127.0.0.1:1'], ['http.https://github.com/.extraHeader', 'x: y'], ['credential.helper', 'store'],
    ['core.sshCommand', 'true'], ['core.gitProxy', 'true'], ['core.fsmonitor', 'false'], ['core.hooksPath', '.'],
    ['filter.x.clean', 'cat'], ['merge.x.driver', 'true'], ['diff.x.command', 'cat'], ['protocol.allow', 'always'],
    ['remote.origin.proxy', 'http://127.0.0.1:1'], ['remote.origin.vcs', 'x'],
  ]) {
    g(d, 'config', k, v);
    const p = await jobs.pull({ name: 'demo', useLogin: true, sessionKey: 'alice' });
    assert.equal(p.code, 'UNSAFE_CONFIG', `${k}: ${JSON.stringify(p)}`);
    g(d, 'config', '--unset', k);
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(spy, []);
  // Clean again: the update goes through, with the login, and fetches what was published.
  const ok = await jobs.pull({ name: 'demo', useLogin: true, sessionKey: 'alice' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(fs.readFileSync(path.join(d, 'two.txt'), 'utf8'), 'new\n');
  assert.deepEqual(asked, ['alice']);
  assert.equal(spy.length, 1);
  // A configuration git cannot read at all is refused too (never "assumed fine").
  fs.writeFileSync(path.join(d, '.git', 'config'), `${fs.readFileSync(path.join(d, '.git', 'config'), 'utf8')}[broken\n`);
  assert.equal((await jobs.pull({ name: 'demo' })).code, 'CONFIG_UNREADABLE');
});

test('Pull latest is refused while that folder is still being cloned', async () => {
  const { ws } = sandbox();
  const f = fakeSpawn((child, args) => fs.mkdirSync(dest(args)));
  const jobs = createCloneJobs({ getRoot: () => ws, lookup: PUBLIC, spawn: f.spawn });
  const r = await jobs.start({ url: 'https://github.com/o/busy' });
  assert.equal((await jobs.pull({ name: 'busy' })).code, 'BUSY');
  f.calls[0].child.finish(1);
  await r.done;
});
