// #414 -- packages/tools/dev/heavy.sh, run for real against a sandbox: prune by owner liveness (never by age alone),
// a bounded lock wait that names the holder, a bounded RAM wait that releases the lock, exit-code passthrough.
//
//   node --test packages/tools/dev/test/            (also picked up by the root `npm test`)
//
// Everything points at a sandbox: CONSTRUCT_HEAVY_TMP (the directory pruned), CONSTRUCT_HEAVY_LOCK (a private
// lock file), CONSTRUCT_MIN_FREE_MB=0 (no real RAM wait). The machine-wide lock is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../../../test-utils/tmpdir.mjs';

const HEAVY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'heavy.sh');

function sandbox(extraEnv = {}) {
  const dir = makeTempDir('heavy-');
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  const env = {
    ...process.env,
    CONSTRUCT_HEAVY_TMP: tmp,
    CONSTRUCT_HEAVY_LOCK: path.join(dir, 'heavy.lock'),
    CONSTRUCT_MIN_FREE_MB: '0',
    CONSTRUCT_HEAVY_POLL_SEC: '0.2',
    ...extraEnv,
  };
  delete env.NODE_OPTIONS;
  return { dir, tmp, env };
}

// The flock path only exists where `flock` does (Linux). macOS has none: heavy.sh takes the mkdir lock
// there (the #686 tests below), and reads free RAM from vm_stat instead of /proc/meminfo (the #854 tests).
const HAVE_FLOCK = spawnSync('flock', ['-h']).error?.code !== 'ENOENT';
const onlyWithFlock = { skip: HAVE_FLOCK ? false : 'flock is not installed here (macOS has none); the mkdir-lock tests below cover this machine' };
const onlyWithMeminfo = {
  skip: HAVE_FLOCK && fs.existsSync('/proc/meminfo') ? false : 'no /proc/meminfo or flock here (macOS), so heavy.sh runs without the free-RAM wait and there is nothing to time out',
};

const run = (args, env) => spawnSync('bash', [HEAVY, ...args], { env, encoding: 'utf8', timeout: 30_000 });

/** A pid that certainly refers to no live process: a child that has already exited. */
function deadPid() {
  const r = spawnSync('true');
  assert.ok(r.pid > 1);
  return r.pid;
}

/**
 * A PATH with every real command available except `flock` (#686: macOS has no flock binary at
 * all). Built by symlinking every executable found in the real PATH, skipping the name "flock",
 * into one fresh directory -- so a script run with this PATH sees a normal-looking machine that
 * merely lacks flock, not a machine missing everything else too.
 */
function pathWithoutFlock() {
  const fakeBin = makeTempDir('heavy-noflock-bin-');
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'flock') continue; // the one thing this PATH must not have
      const target = path.join(fakeBin, entry.name);
      if (fs.existsSync(target)) continue; // earlier PATH dir already claimed this name
      try {
        fs.symlinkSync(path.join(dir, entry.name), target);
      } catch {
        // unreadable/odd entry: skip it, it wasn't going to be flock anyway
      }
    }
  }
  return fakeBin;
}

const mk = (tmp, name, files = {}) => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), body);
  }
  return d;
};

test('prune removes only directories whose owner pid is gone; live, unknown and foreign ones stay', () => {
  const { tmp, env } = sandbox();
  const dead = deadPid();
  const live = process.pid;
  const kept = [
    mk(tmp, `construct-tests-${live}-abc123`),
    mk(tmp, `construct-e2e-state-${live}-XyZ`),
    mk(tmp, 'construct-txn-legacy', { '.owner': `${live}\n` }),
    mk(tmp, 'construct-unknown-owner-fresh'), // no pid anywhere, brand new: kept
    mk(tmp, 'not-construct-at-all'),
  ];
  const removed = [
    mk(tmp, `construct-tests-${dead}-abc123`),
    mk(tmp, `construct-prhealth-${dead}-q1w2e3`, { 'deep/file.txt': 'x' }),
    mk(tmp, `construct-txn-${dead}-zz`),
    mk(tmp, 'construct-step-legacy', { '.owner': `${dead}\n` }),
  ];
  // A symlink named like a dead family must never be followed or removed through.
  const target = mk(tmp, 'target-dir', { 'keep.txt': 'x' });
  fs.symlinkSync(target, path.join(tmp, `construct-tests-${dead}-link`));

  const r = run(['--prune-only'], env);
  assert.equal(r.status, 0, r.stderr);
  for (const d of kept) assert.ok(fs.existsSync(d), `kept ${path.basename(d)}`);
  for (const d of removed) assert.equal(fs.existsSync(d), false, `removed ${path.basename(d)}`);
  assert.ok(fs.existsSync(path.join(target, 'keep.txt')), 'the symlink target is untouched');
  assert.ok(fs.lstatSync(path.join(tmp, `construct-tests-${dead}-link`)).isSymbolicLink(), 'the symlink itself is left alone');
  assert.match(r.stderr, new RegExp(`pruned .*construct-tests-${dead}-abc123 \\(owner pid ${dead} is gone\\)`));
});

test('a live directory older than any age is never pruned by age: mtime is not an owner', () => {
  const { tmp, env } = sandbox();
  const old = mk(tmp, `construct-testrun-${process.pid}-old`, { 'run.log': 'x' });
  const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
  fs.utimesSync(old, past, past);
  const r = run(['--prune-only'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(old), 'three hours old, owner alive: kept');
});

test('runs the command, passes its exit status through, and prunes afterwards', () => {
  const { tmp, env } = sandbox();
  const dead = mk(tmp, `construct-step-${deadPid()}-x`);
  const ok = run(['sh', '-c', 'echo ran; exit 0'], env);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /ran/);
  assert.equal(fs.existsSync(dead), false, 'pruned after the command');
  assert.equal(run(['sh', '-c', 'exit 3'], env).status, 3, 'the command exit status is the script exit status');
  assert.equal(run([], env).status, 2, 'usage');
});

test('the holder file names the pid, the start time and the command while the job runs, and is removed after', () => {
  const { env } = sandbox();
  const holder = `${env.CONSTRUCT_HEAVY_LOCK}.holder`;
  const r = run(['sh', '-c', `cat "${holder}"`], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^pid \d+ since \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: sh -c cat/);
  assert.equal(fs.existsSync(holder), false, 'holder file removed on exit');
});

test('a lock held by another process: gives up after CONSTRUCT_HEAVY_LOCK_WAIT_SEC with exit 75 and the holder named', onlyWithFlock, async () => {
  const { env } = sandbox({ CONSTRUCT_HEAVY_LOCK_WAIT_SEC: '1' });
  fs.writeFileSync(`${env.CONSTRUCT_HEAVY_LOCK}.holder`, 'pid 424242 since 2026-01-01T00:00:00Z: sleep forever\n');
  // `flock <file> <cmd>` holds the lock for the life of <cmd>.
  const holder = spawn('flock', [env.CONSTRUCT_HEAVY_LOCK, 'sleep', '30'], { stdio: 'ignore' });
  try {
    // Wait until the lock is really held before starting the waiter.
    for (let i = 0; i < 100; i += 1) {
      if (spawnSync('flock', ['-n', env.CONSTRUCT_HEAVY_LOCK, 'true']).status !== 0) break;
      await new Promise((res) => setTimeout(res, 20));
    }
    const started = Date.now();
    const r = run(['sh', '-c', 'echo must-not-run'], env);
    assert.equal(r.status, 75, r.stderr);
    assert.ok(Date.now() - started < 15_000, 'gave up within the wait, not at the 30 s sleep');
    assert.doesNotMatch(r.stdout, /must-not-run/);
    assert.match(r.stderr, /could not get the heavy-job lock .* within 1s/);
    assert.match(r.stderr, /Held by: pid 424242 since 2026-01-01T00:00:00Z: sleep forever/);
  } finally {
    holder.kill('SIGKILL');
  }
});

test('the RAM wait is bounded and the lock is released while waiting and after giving up', onlyWithMeminfo, () => {
  const { env } = sandbox({ CONSTRUCT_MIN_FREE_MB: '999999999', CONSTRUCT_HEAVY_RAM_WAIT_SEC: '1' });
  const started = Date.now();
  const r = run(['sh', '-c', 'echo must-not-run'], env);
  assert.equal(r.status, 75, r.stderr);
  assert.ok(Date.now() - started < 15_000);
  assert.doesNotMatch(r.stdout, /must-not-run/);
  // #882: no assertion on the 'waiting for ...' line: under load the first probe can already land past the 1 s
  // deadline, and heavy.sh then gives up without a waiting line. The give-up line is printed on every path.
  assert.match(r.stderr, /gave up waiting for >= 999999999 MB free RAM after 1s .*Lock released/);
  // Another job can take the lock right away.
  assert.equal(spawnSync('flock', ['-n', env.CONSTRUCT_HEAVY_LOCK, 'true']).status, 0, 'the lock is free');
});

// ---- #686: no flock on the PATH (e.g. macOS) -- the mkdir fallback --------------------------

test('flock missing: uses the mkdir lock dir instead, and cleans it up after the job', () => {
  const { env } = sandbox();
  const noFlock = { ...env, PATH: pathWithoutFlock() };
  assert.equal(spawnSync('flock', ['-h'], { env: noFlock }).error?.code, 'ENOENT', 'sanity: flock really is hidden from this PATH');

  const lockDir = `${env.CONSTRUCT_HEAVY_LOCK}.d`;
  const r = run(['sh', '-c', `[ -d "${lockDir}" ] && echo lockdir-present; echo ran`], noFlock);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /lockdir-present/, 'the mkdir lock exists while the job runs');
  assert.match(r.stdout, /ran/);
  assert.equal(fs.existsSync(lockDir), false, 'lock dir removed once the job exits');
});

test('flock missing: still serializes two overlapping jobs (mutual exclusion via mkdir)', async () => {
  const { tmp, env } = sandbox();
  const noFlock = { ...env, PATH: pathWithoutFlock() };
  const log = path.join(tmp, 'order.log');
  const stamp = (label) => `echo "${label} $(date +%s%N)" >> "${log}"`;

  // #882: no fixed head start. A runs only once it holds the lock, so its first stamp is proof it holds it; B is
  // started after that, and A keeps the lock until the test writes a release file. Under load a fixed 150 ms head
  // start was not enough and B took the lock first.
  const release = path.join(tmp, 'release');
  const a = spawn('bash', [HEAVY, 'sh', '-c', `${stamp('a-start')}; while [ ! -e "${release}" ]; do sleep 0.05; done; ${stamp('a-end')}`], { env: noFlock });
  const waitExit = (p) => new Promise((res) => p.on('exit', res));
  const exitA = waitExit(a);
  const logHas = (label) => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes(label);
  while (!logHas('a-start')) await new Promise((res) => setTimeout(res, 20));
  const b = spawn('bash', [HEAVY, 'sh', '-c', `${stamp('b-start')}; ${stamp('b-end')}`], { env: noFlock });
  const exitB = waitExit(b);
  await new Promise((res) => setTimeout(res, 300)); // give B time to contend; correctness does not depend on it
  assert.equal(logHas('b-start'), false, 'B must not run while A holds the lock');
  fs.writeFileSync(release, '');
  const [codeA, codeB] = await Promise.all([exitA, exitB]);
  assert.equal(codeA, 0);
  assert.equal(codeB, 0);
  assert.equal(fs.existsSync(`${env.CONSTRUCT_HEAVY_LOCK}.d`), false, 'lock dir cleaned up after both jobs');

  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  const idx = (label) => lines.findIndex((l) => l.startsWith(label));
  assert.ok(idx('a-start') < idx('a-end') && idx('a-end') < idx('b-start'), `expected a-start, a-end, b-start, b-end in order, got: ${lines.join(' | ')}`);
});

test('flock missing: a lock dir left by a dead process is cleaned up immediately, never waited out', () => {
  const { env } = sandbox({ CONSTRUCT_HEAVY_LOCK_WAIT_SEC: '20' });
  const noFlock = { ...env, PATH: pathWithoutFlock() };
  const lockDir = `${env.CONSTRUCT_HEAVY_LOCK}.d`;
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'pid'), `${deadPid()}\n`);

  const started = Date.now();
  const r = run(['sh', '-c', 'echo ran'], noFlock);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ran/);
  assert.ok(Date.now() - started < 5000, `picked up the dead holder's lock right away, did not sit out the 20s wait (took ${Date.now() - started}ms)`);
  assert.equal(fs.existsSync(lockDir), false, 'lock dir removed after the job');
});

test('flock missing: a lock held by another live process times out, names the holder, exit 75', async () => {
  const { env } = sandbox({ CONSTRUCT_HEAVY_LOCK_WAIT_SEC: '1' });
  const noFlock = { ...env, PATH: pathWithoutFlock() };
  const lockDir = `${env.CONSTRUCT_HEAVY_LOCK}.d`;
  const holderProc = spawn('sleep', ['30']); // a real, live pid to hold the lock, independent of heavy.sh
  try {
    await new Promise((res) => setTimeout(res, 50));
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'pid'), `${holderProc.pid}\n`);
    fs.writeFileSync(`${env.CONSTRUCT_HEAVY_LOCK}.holder`, 'pid 424242 since 2026-01-01T00:00:00Z: sleep forever\n');

    const started = Date.now();
    const r = run(['sh', '-c', 'echo must-not-run'], noFlock);
    assert.equal(r.status, 75, r.stderr);
    assert.ok(Date.now() - started < 15_000, 'gave up within the wait, not forever');
    assert.doesNotMatch(r.stdout, /must-not-run/);
    assert.match(r.stderr, /could not get the heavy-job lock .* within 1s/);
    assert.match(r.stderr, /Held by: pid 424242 since 2026-01-01T00:00:00Z: sleep forever/);
  } finally {
    holderProc.kill('SIGKILL');
  }
});

// ---- #854: the free-RAM probe on macOS (vm_stat) and Linux (/proc/meminfo) ------------------
// Both probes are faked so the tests run identically on every OS: CONSTRUCT_HEAVY_MEMINFO points at a
// fake meminfo (or a missing file, to force the vm_stat path), CONSTRUCT_HEAVY_VMSTAT at a fake vm_stat.

/** A fake `vm_stat` printing a 16 KiB page size and the given page counts. */
function fakeVmStat(dir, { free, inactive, speculative }) {
  const p = path.join(dir, `fake-vm_stat-${free}-${inactive}-${speculative}`);
  fs.writeFileSync(
    p,
    [
      '#!/bin/sh',
      'cat <<OUT',
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
      `Pages free:                              ${free}.`,
      'Pages active:                            400283.',
      `Pages inactive:                          ${inactive}.`,
      `Pages speculative:                        ${speculative}.`,
      'Pages wired down:                        234863.',
      'OUT',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return p;
}

test('macOS: vm_stat reporting too little free RAM makes the RAM wait time out (exit 75), nothing runs', () => {
  const { dir, env } = sandbox({ CONSTRUCT_MIN_FREE_MB: '3000', CONSTRUCT_HEAVY_RAM_WAIT_SEC: '1' });
  // (100 + 50 + 10) pages x 16 KiB = 2.5 MB available
  env.CONSTRUCT_HEAVY_VMSTAT = fakeVmStat(dir, { free: 100, inactive: 50, speculative: 10 });
  env.CONSTRUCT_HEAVY_MEMINFO = path.join(dir, 'no-such-meminfo');
  const r = run(['sh', '-c', 'echo must-not-run'], env);
  assert.equal(r.status, 75, r.stderr);
  assert.doesNotMatch(r.stdout, /must-not-run/);
  // #882: the measured value is checked on the give-up line, which every path prints; the 'waiting for' line is
  // skipped when the first probe already lands past the 1 s deadline (full-suite load).
  assert.match(r.stderr, /gave up waiting for >= 3000 MB free RAM after 1s \(have 2 MB\)/);
  assert.doesNotMatch(r.stderr, /without the free-RAM check/);
});

test('macOS: vm_stat available MB is (free + inactive + speculative) x page size, and enough of it runs the job', () => {
  // (64000 + 128000 + 0) pages x 16 KiB = 3000 MB exactly: meets CONSTRUCT_MIN_FREE_MB=3000.
  const { dir, env } = sandbox({ CONSTRUCT_MIN_FREE_MB: '3000', CONSTRUCT_HEAVY_RAM_WAIT_SEC: '1' });
  env.CONSTRUCT_HEAVY_VMSTAT = fakeVmStat(dir, { free: 64000, inactive: 128000, speculative: 0 });
  env.CONSTRUCT_HEAVY_MEMINFO = path.join(dir, 'no-such-meminfo');
  const r = run(['sh', '-c', 'echo ran'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ran/);
  // One page fewer is 2999 MB: below the bar.
  env.CONSTRUCT_HEAVY_VMSTAT = fakeVmStat(dir, { free: 63999, inactive: 128000, speculative: 0 });
  const low = run(['sh', '-c', 'echo must-not-run'], env);
  assert.equal(low.status, 75, low.stderr);
  assert.match(low.stderr, /have 2999 MB/);
});

test('Linux: /proc/meminfo MemAvailable wins over vm_stat when both exist', () => {
  const { dir, env } = sandbox({ CONSTRUCT_MIN_FREE_MB: '3000', CONSTRUCT_HEAVY_RAM_WAIT_SEC: '1' });
  const meminfo = path.join(dir, 'meminfo');
  fs.writeFileSync(meminfo, 'MemTotal:       16000000 kB\nMemFree:          100000 kB\nMemAvailable:    1024000 kB\n');
  env.CONSTRUCT_HEAVY_MEMINFO = meminfo;
  env.CONSTRUCT_HEAVY_VMSTAT = fakeVmStat(dir, { free: 9999999, inactive: 0, speculative: 0 });
  const r = run(['sh', '-c', 'echo must-not-run'], env);
  assert.equal(r.status, 75, r.stderr);
  assert.match(r.stderr, /have 1000 MB/);
});

test('neither probe available: runs without the RAM check and says so', () => {
  const { dir, env } = sandbox({ CONSTRUCT_MIN_FREE_MB: '999999999' });
  env.CONSTRUCT_HEAVY_MEMINFO = path.join(dir, 'no-such-meminfo');
  env.CONSTRUCT_HEAVY_VMSTAT = path.join(dir, 'no-such-vm_stat');
  const r = run(['sh', '-c', 'echo ran'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ran/);
  assert.match(r.stderr, /running without the free-RAM check/);
});

// ---- #855: Termux (no writable /tmp; everything under $PREFIX and $TMPDIR) -------------------
// CONSTRUCT_HEAVY_SHARED_TMP stands in for /tmp so the real machine-wide lock is never touched.

/** The sandbox env with the default lock path in play (no CONSTRUCT_HEAVY_LOCK). */
function defaultLockEnv(extra) {
  const { dir, env } = sandbox();
  delete env.CONSTRUCT_HEAVY_LOCK;
  return { dir, env: { ...env, ...extra } };
}

test('#855 no usable /tmp (Termux): the lock falls back to $TMPDIR, and a job really takes it there', () => {
  const { dir } = defaultLockEnv();
  const tmpdir = path.join(dir, 'termux-tmp');
  fs.mkdirSync(tmpdir);
  const { env } = defaultLockEnv({ CONSTRUCT_HEAVY_SHARED_TMP: path.join(dir, 'no-such-tmp'), TMPDIR: `${tmpdir}/` });
  const p = run(['--lock-path'], env);
  assert.equal(p.status, 0, p.stderr);
  assert.equal(p.stdout.trim(), path.join(tmpdir, 'construct-heavy.lock'));
  const r = run(['sh', '-c', `cat "${path.join(tmpdir, 'construct-heavy.lock.holder')}"`], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^pid \d+ since .*: sh -c cat/, 'the holder file sits next to the $TMPDIR lock while the job runs');
});

test('#855 a writable /tmp keeps the lock there even when $TMPDIR is set (macOS sets one per user): one lock per machine', () => {
  const { dir } = defaultLockEnv();
  const shared = path.join(dir, 'shared-tmp');
  fs.mkdirSync(shared);
  const { env } = defaultLockEnv({ CONSTRUCT_HEAVY_SHARED_TMP: shared, TMPDIR: path.join(dir, 'per-user') });
  assert.equal(run(['--lock-path'], env).stdout.trim(), path.join(shared, 'construct-heavy.lock'));
  const { env: real } = defaultLockEnv({ TMPDIR: path.join(dir, 'per-user') });
  delete real.CONSTRUCT_HEAVY_SHARED_TMP;
  assert.equal(run(['--lock-path'], real).stdout.trim(), '/tmp/construct-heavy.lock', 'the real default is unchanged (path only; the lock is not taken)');
});

test('#855 a lock whose folder does not exist fails fast with exit 2 and says how to fix it, nothing runs', () => {
  const { dir, env } = sandbox({ CONSTRUCT_HEAVY_LOCK_WAIT_SEC: '20' });
  env.CONSTRUCT_HEAVY_LOCK = path.join(dir, 'missing', 'heavy.lock');
  const started = Date.now();
  const r = run(['sh', '-c', 'echo must-not-run'], env);
  assert.equal(r.status, 2, r.stderr);
  assert.ok(Date.now() - started < 5000, 'did not sit out the lock wait');
  assert.doesNotMatch(r.stdout, /must-not-run/);
  assert.match(r.stderr, /the lock's folder .*missing does not exist .*CONSTRUCT_HEAVY_LOCK or TMPDIR/);
});

test('#855 status.sh reads the lock path from heavy.sh, and verify.sh makes its temp files under $TMPDIR', () => {
  const dev = path.dirname(HEAVY);
  const status = fs.readFileSync(path.join(dev, 'status.sh'), 'utf8');
  assert.doesNotMatch(status, /\/tmp\/construct-heavy\.lock/);
  assert.match(status, /heavy\.sh" --lock-path/);
  const verify = fs.readFileSync(path.join(dev, 'verify.sh'), 'utf8');
  assert.doesNotMatch(verify, /mktemp \/tmp/);
  assert.match(verify, /TMPD="\$\{TMPDIR:-\/tmp\}"/);
});

// #854: without flock (macOS), status.sh used to report "HELD" forever because `flock -n` itself failed.
// It must read heavy.sh's mkdir lock ($LOCK.d) instead. gh/curl/free are stubbed so no network is used.
test('#854 status.sh reports the heavy queue from the mkdir lock where flock is missing', { skip: HAVE_FLOCK ? 'flock is installed here, so status.sh takes the flock path' : false }, () => {
  const { dir, env } = sandbox();
  const shims = path.join(dir, 'shims');
  fs.mkdirSync(shims);
  for (const bin of ['gh', 'curl', 'free']) fs.writeFileSync(path.join(shims, bin), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const run = () => spawnSync('bash', [path.join(path.dirname(HEAVY), 'status.sh')], { env: { ...env, PATH: `${shims}:${env.PATH}` }, encoding: 'utf8', timeout: 60000 });
  const queue = (out) => out.split('\n')[out.split('\n').indexOf('-- heavy queue') + 1];
  assert.equal(queue(run().stdout), 'free');
  fs.mkdirSync(`${env.CONSTRUCT_HEAVY_LOCK}.d`);
  fs.writeFileSync(`${env.CONSTRUCT_HEAVY_LOCK}.d/pid`, String(process.pid));
  assert.match(queue(run().stdout), /^HELD by pid /);
});

// ---- #939: re-entrancy -- a heavy command that itself calls heavy.sh (install:all -> install-all.sh -> heavy.sh npm ci)
// used to wait for the lock its own ancestor held, for the whole CONSTRUCT_HEAVY_LOCK_WAIT_SEC. Each case runs with
// this machine's own lock (flock or mkdir) and with flock hidden (the mkdir lock), so both paths are covered here.
for (const [label, pathFor] of [['native lock', () => process.env.PATH], ['flock missing (mkdir lock)', pathWithoutFlock]]) {
  test(`#939 ${label}: a heavy.sh nested inside a heavy.sh command runs directly, finishes, and the lock is released`, () => {
    const { env } = sandbox({ CONSTRUCT_HEAVY_LOCK_WAIT_SEC: '3' });
    env.PATH = pathFor();
    delete env.CONSTRUCT_HEAVY_HELD;
    const started = Date.now();
    const r = run(['bash', '-c', `bash "${HEAVY}" sh -c 'echo inner-ran'; echo outer-done`], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /inner-ran[\s\S]*outer-done/);
    assert.match(r.stderr, /nested under heavy\.sh pid \d+, which already holds .*: running directly/);
    assert.doesNotMatch(r.stderr, /could not get the heavy-job lock/);
    assert.ok(Date.now() - started < 3_000, 'did not wait out the lock');
    assert.equal(fs.existsSync(`${env.CONSTRUCT_HEAVY_LOCK}.d`), false, 'mkdir lock released');
    assert.equal(fs.existsSync(`${env.CONSTRUCT_HEAVY_LOCK}.holder`), false, 'holder file removed');
    const again = run(['sh', '-c', 'echo free'], { ...env, CONSTRUCT_HEAVY_LOCK_WAIT_SEC: '1' });
    assert.equal(again.status, 0, `lock is free afterwards: ${again.stderr}`);
  });
}

test('#939 a forged marker naming a live lock holder that is not an ancestor does not bypass the lock (exit 75)', async () => {
  const { env } = sandbox({ CONSTRUCT_HEAVY_LOCK_WAIT_SEC: '1' });
  const noFlock = { ...env, PATH: pathWithoutFlock() };
  const lockDir = `${env.CONSTRUCT_HEAVY_LOCK}.d`;
  const holderProc = spawn('sleep', ['30']); // a live pid holding the lock, unrelated to the caller
  try {
    await new Promise((res) => setTimeout(res, 50));
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'pid'), `${holderProc.pid}\n`);
    fs.writeFileSync(`${env.CONSTRUCT_HEAVY_LOCK}.holder`, `pid ${holderProc.pid} since 2026-01-01T00:00:00Z: sleep\n`);
    const forged = { ...noFlock, CONSTRUCT_HEAVY_HELD: `${holderProc.pid}:${env.CONSTRUCT_HEAVY_LOCK}` };
    const r = run(['sh', '-c', 'echo must-not-run'], forged);
    assert.equal(r.status, 75, r.stderr);
    assert.doesNotMatch(r.stdout, /must-not-run/);
    assert.match(r.stderr, /ignoring CONSTRUCT_HEAVY_HELD/);
    assert.doesNotMatch(r.stderr, /nested under/);
  } finally {
    holderProc.kill('SIGKILL');
  }
});

test('#939 a stale marker (dead pid) or one for another lock is ignored and the lock is taken normally', () => {
  const { env } = sandbox();
  for (const marker of [`${deadPid()}:${env.CONSTRUCT_HEAVY_LOCK}`, `${process.pid}:/elsewhere/heavy.lock`, 'garbage']) {
    const r = run(['sh', '-c', `cat "${env.CONSTRUCT_HEAVY_LOCK}.holder"`], { ...env, CONSTRUCT_HEAVY_HELD: marker });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /ignoring CONSTRUCT_HEAVY_HELD/);
    assert.match(r.stdout, /^pid \d+ since /, 'took the lock itself (holder file written)');
  }
});
