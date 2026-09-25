// og-watchdog: idle sessions are summarized, closed and replaced by a fresh OG. Runs the real script against a throwaway repo
// with fake `claude` processes (argv0 "claude") and a private tmux name; never touches the developer's own sessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/tools/dev/og-watchdog.sh');
const have = (cmd, args = ['-V']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const skip = process.platform !== 'linux' || !have('tmux') || !have('python3', ['--version']) ? 'needs linux, tmux and python3' : false;

function rig(name, env = {}) {
  const root = makeTempDir('ogw-');
  const repo = path.join(root, 'repo'), state = path.join(root, 'state'), projects = path.join(root, 'projects'), bin = path.join(root, 'bin');
  for (const d of [repo, state, projects, bin, path.join(root, 'home')]) fs.mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const slug = repo.replace(/[^A-Za-z0-9]/g, '-');
  fs.mkdirSync(path.join(projects, slug), { recursive: true });
  const transcript = path.join(projects, slug, 'sess1.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'LAST WORDS: shipped X, next Y' }] } }) + '\n');
  // fake claude: when asked for a handoff it replies with the token alone on a line, like OG does
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/bash\nexec -a claude bash -c \'while read -r l; do case "$l" in *"reply with exactly this token"*) echo "${l##* }";; esac; done; sleep 600\'\n', { mode: 0o755 });
  const tmuxName = `ogtest-${process.pid}-${name}`;
  const e = { ...process.env, HOME: path.join(root, 'home'), OG_REPO: repo, OG_STATE_DIR: state, OG_TMUX: tmuxName, CLAUDE_BIN: path.join(bin, 'claude'),
    OG_PROJECTS_DIR: projects, OG_IDLE_MIN: '0', OG_IDLE_OG_MIN: '1', OG_SUMMARY_WAIT_MIN: '15', ...env };
  const run = (cmd, extra = {}) => spawnSync('bash', [SCRIPT, cmd], { env: { ...e, ...extra }, encoding: 'utf8' });
  const age = (minutes) => { const t = new Date(Date.now() - minutes * 60000); fs.utimesSync(transcript, t, t); };
  const foreign = [];
  const spawnForeign = () => { const p = spawn('bash', ['-c', 'exec -a claude sleep 600'], { cwd: repo, detached: true, stdio: 'ignore' }); p.unref(); foreign.push(p.pid); return p.pid; };
  // a killed child of this test process stays a zombie until reaped: count state Z as gone
  const alive = (pid) => { try { process.kill(pid, 0); } catch { return false; } try { return !/^\d+ \(.*\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; } };
  const log = () => fs.existsSync(path.join(state, 'watchdog.log')) ? fs.readFileSync(path.join(state, 'watchdog.log'), 'utf8') : '';
  const cleanup = () => { spawnSync('tmux', ['kill-session', '-t', tmuxName], { stdio: 'ignore' }); for (const p of foreign) try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); };
  const tmuxUp = () => spawnSync('tmux', ['has-session', '-t', tmuxName], { stdio: 'ignore' }).status === 0;
  return { root, repo, state, run, age, spawnForeign, alive, log, cleanup, tmuxUp, tmuxName };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('og-watchdog: an idle foreign session gets a handoff snapshot, is closed, and a fresh OG starts with it', { skip }, async () => {
  const r = rig('foreign');
  try {
    const pid = r.spawnForeign();
    r.age(180);
    await sleep(300);
    r.run('check');
    assert.match(r.log(), /recycling/);
    assert.match(r.log(), /started OG in tmux/);
    assert.equal(r.alive(pid), false, 'the idle session was closed');
    assert.ok(r.tmuxUp(), 'a fresh OG runs in tmux');
    const files = fs.readdirSync(path.join(r.state, 'handoffs'));
    assert.equal(files.length, 1);
    const snap = fs.readFileSync(path.join(r.state, 'handoffs', files[0]), 'utf8');
    assert.match(snap, /LAST WORDS: shipped X, next Y/, 'the previous session\'s last message is in the snapshot');
    assert.match(snap, /## Repo/);
    assert.match(fs.readFileSync(path.join(r.state, 'prompt.run.txt'), 'utf8'), /handoff snapshot: .*handoff-.*\.md/);
  } finally { r.cleanup(); }
});

test('og-watchdog: an active session is left alone', { skip }, async () => {
  const r = rig('active', { OG_IDLE_MIN: '1' });
  try {
    const pid = r.spawnForeign();
    r.age(0);
    await sleep(300);
    r.run('check');
    assert.doesNotMatch(r.log(), /recycling/);
    assert.equal(r.alive(pid), true);
    assert.equal(r.tmuxUp(), false);
  } finally { r.cleanup(); }
});

test('og-watchdog: a session younger than the threshold is never idle, however old the transcript', { skip }, async () => {
  const r = rig('young', { OG_IDLE_MIN: '30' });
  try {
    const pid = r.spawnForeign();
    r.age(600);
    await sleep(300);
    r.run('check');
    assert.doesNotMatch(r.log(), /recycling/);
    assert.equal(r.alive(pid), true);
  } finally { r.cleanup(); }
});

test('og-watchdog: paused means nothing is closed or started', { skip }, async () => {
  const r = rig('paused');
  try {
    const pid = r.spawnForeign();
    r.age(180);
    r.run('pause');
    await sleep(300);
    r.run('check');
    assert.match(r.log(), /idle .* but paused/);
    assert.equal(r.alive(pid), true);
    assert.equal(r.tmuxUp(), false);
  } finally { r.cleanup(); }
});

test('og-watchdog: the recycle cap stops a restart loop', { skip }, async () => {
  const r = rig('cap', { OG_MAX_RECYCLES: '2' });
  try {
    const pid = r.spawnForeign();
    r.age(180);
    const now = Math.floor(Date.now() / 1000);
    fs.writeFileSync(path.join(r.state, 'recycles'), `${now - 60}\n${now - 30}\n`);
    await sleep(300);
    r.run('check');
    assert.match(r.log(), /recycles already in 24 h: not recycling/);
    assert.equal(r.alive(pid), true);
  } finally { r.cleanup(); }
});

test('og-watchdog: the OG session is asked for its own handoff note first, then closed and replaced', { skip }, async () => {
  const r = rig('og', { OG_IDLE_OG_MIN: '0' });
  try {
    r.run('start');
    assert.ok(r.tmuxUp(), 'OG started');
    r.age(180);
    await sleep(800);
    r.run('check');
    assert.match(r.log(), /asked OG for its handoff note/);
    assert.match(fs.readFileSync(path.join(r.state, 'recycle'), 'utf8'), /^summarizing /);
    await sleep(800);
    r.run('check'); // the fake OG replied with the token, so the second pass closes and restarts
    assert.match(r.log(), /closing sessions and starting a fresh OG/);
    assert.ok(r.tmuxUp(), 'a fresh OG runs');
    assert.equal(fs.existsSync(path.join(r.state, 'recycle')), false);
  } finally { r.cleanup(); }
});

test('og-watchdog: with no session it starts OG', { skip }, async () => {
  const r = rig('none');
  try {
    r.age(180);
    r.run('check');
    assert.match(r.log(), /no Claude Code session/);
    assert.ok(r.tmuxUp());
  } finally { r.cleanup(); }
});
