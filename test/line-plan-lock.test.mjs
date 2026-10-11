// The plan file is shared by separate processes (the MCP server and the Cockpit server write line/plans/ses-cockpit.json),
// so its read-modify-write runs under one cross-process file lock (@line/construct-core/file-lock), and Line's JSONL
// state is appended in place instead of copying the project through a transaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { withFileLock, withFileLockSync, FileLockError, LOCK_BUSY_SENTENCE, LOCK_TIMEOUT } from '../packages/core/file-lock.mjs';
import { createAtomicPlanWriter, createStaticPlanApi, lockPlanApi } from '../packages/engine/line/planFallback.mjs';
import { appendRecord, readRecords } from '../packages/engine/line/drafter/retrieval.mjs';
import { logToolWrite } from '../packages/engine/line/toolRegistry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const url = (rel) => pathToFileURL(path.join(HERE, '..', rel)).href;
const tmp = () => makeTempDir('line-plan-lock-');
const ONE_SENTENCE = /^[A-Z][^\n]*[.?!]$/;

/** A registry with one read tool that logs every run (pid and step) to `runsFile`. */
const REGISTRY_SRC = (runsFile) => `{
  list: () => [{ name: 'test.touch', kind: 'read', schema: { safeParse: (v) => ({ success: true, data: v }) } }],
  call: async (tool, args) => { fs.appendFileSync(${JSON.stringify(runsFile)}, args.tag + ' ' + process.pid + '\\n'); return { ok: true }; },
}`;

/** Start a child that adds `n` steps to the plan, then runs steps until every step has finished. */
function child(root, planId, tag, n, runsFile) {
  const code = `
    import fs from 'node:fs';
    import { createAtomicPlanWriter, createStaticPlanApi } from ${JSON.stringify(url('packages/engine/line/planFallback.mjs'))};
    // A short pause after each read widens the read-to-write window the way a slow disk or a busy server does, so
    // without the cross-process lock both processes reliably read the same version and one write is lost.
    const w = createAtomicPlanWriter(${JSON.stringify(root)});
    const writer = { ...w, read: async (sid) => { const d = await w.read(sid); await new Promise((ok) => setTimeout(ok, Math.random() * 4)); return d; } };
    const api = createStaticPlanApi({ registry: ${REGISTRY_SRC(runsFile)}, writer, newId: () => 'cockpit' });
    const planId = ${JSON.stringify(planId)};
    const versioned = async (call) => { for (;;) { const g = await api.plan_get({ planId }); const r = await call(g.plan.version); if (r.ok || r.code !== 'conflict') return r; } };
    for (let i = 0; i < ${n}; i += 1) {
      const id = ${JSON.stringify(tag)} + i;
      const r = await versioned((version) => api.plan_add_step({ planId, version, by: 'agent', step: { id, tool: 'test.touch', args: { tag: id }, why: 'Touch ' + id + '.' } }));
      if (!r.ok) { console.error(JSON.stringify(r)); process.exit(2); }
    }
    for (;;) {
      const r = await versioned((version) => api.plan_run_next({ planId, version, by: 'line' }));
      if (r.ok) continue;
      if (/still running/.test(r.reason)) { await new Promise((ok) => setTimeout(ok, 5)); continue; }
      if (/^Every step has finished|^No step is ready|^The plan is done/.test(r.reason)) break;
      console.error(JSON.stringify(r)); process.exit(3);
    }
  `;
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    // A lost "running" write leaves a step running forever; fail instead of hanging.
    const stop = setTimeout(() => { err += 'timed out: the plan never finished'; p.kill('SIGKILL'); }, 60_000);
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', (status) => { clearTimeout(stop); resolve({ status, err }); });
  });
}

/** Start a child that takes the lock of `file` and holds it until killed; resolves once it holds it. */
function holder(file) {
  const code = `
    import { withFileLock } from ${JSON.stringify(url('packages/core/file-lock.mjs'))};
    await withFileLock(${JSON.stringify(file)}, () => { process.stdout.write('held\\n'); setInterval(() => {}, 1000); return new Promise(() => {}); });
  `;
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => { p.stdout.on('data', (d) => { if (String(d).includes('held')) resolve(p); }); });
}
const killed = (p) => new Promise((resolve) => { p.on('exit', resolve); p.kill('SIGKILL'); });

test('two processes adding and running steps on one plan file lose no change and run no step twice', async () => {
  const root = tmp();
  const runs = path.join(root, 'runs.log');
  const api = createStaticPlanApi({ registry: { list: () => [], call: async () => null }, writer: createAtomicPlanWriter(root), newId: () => 'cockpit' });
  const made = await api.plan_create({ goal: 'Touch every step.', by: 'user' });
  assert.equal(made.ok, true);
  const N = 30;
  const [a, b] = await Promise.all([child(root, made.plan.id, 'a', N, runs), child(root, made.plan.id, 'b', N, runs)]);
  assert.equal(a.status, 0, a.err);
  assert.equal(b.status, 0, b.err);
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'line', 'plans', 'ses-cockpit.json'), 'utf8')).plans[0];
  const ids = plan.steps.map((s) => s.id).sort();
  const want = [...Array.from({ length: N }, (_, i) => `a${i}`), ...Array.from({ length: N }, (_, i) => `b${i}`)].sort();
  assert.deepEqual(ids, want, 'every step from both processes is in the plan');
  assert.ok(plan.steps.every((s) => s.status === 'done'), 'every step ran');
  // version 1 at create, +1 per add, +2 per run (start, finish): any lost write would show as a lower version.
  assert.equal(plan.version, 1 + 2 * N + 2 * 2 * N);
  const ran = fs.readFileSync(runs, 'utf8').trim().split('\n').map((l) => l.split(' ')[0]).sort();
  assert.deepEqual(ran, want, 'each step ran exactly once');
  assert.deepEqual(fs.readdirSync(path.join(root, 'line', 'plans')).filter((f) => f.endsWith('.lock') || f.endsWith('.tmp')), [], 'no lock or temp file is left');
});

test('a stale lock (its holder killed, its mtime old) is taken over', async () => {
  const root = tmp();
  const file = path.join(root, 'line', 'plans', 'ses-cockpit.json');
  const p = await holder(file);
  await killed(p);
  assert.ok(fs.existsSync(`${file}.lock`), 'the dead holder left its lock');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(`${file}.lock`, old, old);
  assert.equal(await withFileLock(file, () => 'mine', { timeoutMs: 2000 }), 'mine');
  assert.equal(withFileLockSync(file, () => 'mine too', { timeoutMs: 2000 }), 'mine too');
  assert.equal(fs.existsSync(`${file}.lock`), false, 'released in finally');
});

test('a lock that is not freed in time is refused in one sentence with a typed code, by the helper and by the plan', async () => {
  const root = tmp();
  const writer = createAtomicPlanWriter(root);
  const registry = { list: () => [{ name: 'test.touch', kind: 'read', schema: { safeParse: (v) => ({ success: true, data: v }) } }], call: async () => null };
  const api = createStaticPlanApi({ registry, writer, newId: () => 'cockpit', lockTimeoutMs: 300 });
  const made = await api.plan_create({ goal: 'Touch a step.', by: 'user' });
  const file = writer.fileOf('ses-cockpit');
  const p = await holder(file);
  try {
    await assert.rejects(withFileLock(file, () => 'never', { timeoutMs: 200 }), (e) => e instanceof FileLockError && e.code === LOCK_TIMEOUT && e.sentence === LOCK_BUSY_SENTENCE);
    assert.equal(LOCK_BUSY_SENTENCE, 'Another Line process is changing the plan; try again.');
    assert.match(LOCK_BUSY_SENTENCE, ONE_SENTENCE);
    const r = await api.plan_add_step({ planId: made.plan.id, version: made.plan.version, by: 'agent', step: { tool: 'test.touch', args: {}, why: 'Touch it.' } });
    assert.deepEqual(r, { ok: false, code: 'lock_timeout', reason: LOCK_BUSY_SENTENCE });
    const linked = lockPlanApi({ plan_add_step: async () => ({ ok: true }), plan_get: async () => ({ ok: true }) }, { root, newId: () => 'cockpit', lockTimeoutMs: 300 });
    const lr = await linked.plan_add_step({ planId: made.plan.id });
    assert.deepEqual(lr, { ok: false, code: 'lock_timeout', reason: LOCK_BUSY_SENTENCE }, 'a linked @mx/plan is locked at the boundary too');
    assert.deepEqual(await linked.plan_get({ planId: made.plan.id }), { ok: true }, 'reads are not locked');
  } finally { await killed(p); }
  assert.equal((await writer.read('ses-cockpit')).plans[0].steps.length, 0, 'nothing changed');
});

test('Line-state appends write in place: no temp project copy, the same records', () => {
  const root = tmp();
  const scratch = tmp();
  const before = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
  try {
    const summary = { layout: { state: 'line' } };
    const r1 = { v: 1, request: 'add <component:C1> to <feature:F1>', slots: { C1: 'component', F1: 'feature' }, intent: 'add.component', approved: true };
    const r2 = { ...r1, approved: false };
    assert.equal(appendRecord(root, summary, r1), 'line/drafter/transitions.jsonl');
    appendRecord(root, summary, r2);
    assert.deepEqual(readRecords(root, summary), [r1, r2]);
    assert.equal(fs.readFileSync(path.join(root, 'line', 'drafter', 'transitions.jsonl'), 'utf8'), `${JSON.stringify(r1)}\n${JSON.stringify(r2)}\n`);
    logToolWrite(root, { tool: 'line.setWorkspace', by: 'ui', ok: true });
    logToolWrite(root, { tool: 'line.setWorkspace', by: 'agent', ok: false });
    const log = fs.readFileSync(path.join(root, 'line', 'log', 'tools.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map(({ at, ...rest }) => (assert.match(at, /^\d{4}-\d\d-\d\dT/), rest)), [{ tool: 'line.setWorkspace', by: 'ui', ok: true }, { tool: 'line.setWorkspace', by: 'agent', ok: false }]);
    assert.deepEqual(fs.readdirSync(scratch), [], 'no shadow copy of the project was made');
    const left = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(tmp|lock)$/.test(String(f)));
    assert.deepEqual(left(root), [], 'no temp or lock file is left');
  } finally {
    if (before === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = before;
  }
});
