// cl1 UAT walk (docs/line/review.md, "cl1"), kept re-runnable: the owner's steps as written, on a copy of
// examples/line-sample. The Cockpit part goes through the same /api/line/plan routes the Plan panel's buttons call
// (cl1 adds no screen); the rest is the CLI exactly as review.md types it. Every sentence printed is checked for plain
// English (full sentences, no stack traces).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLinePlanRouter } from './linePlanApi.mjs';
import { createLinePlanService, loadPlanApi } from '../../../packages/engine/line/planService.mjs';
import { listFragments } from '../../../packages/engine/line/fragments.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(REPO, 'packages/cli/construct.mjs');
const ORIGIN = 'http://localhost:3000';
const NO_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };
const construct = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: REPO });
const PAGE = 'features/orders/pages/OrdersPage.tsx';

/** One Cockpit session on `dir`: the fragment that makes orders use billing, Approve, run; then Apply recommended fix. */
async function cockpitSession(t, dir) {
  const app = express();
  app.use(express.json());
  const svc = createLinePlanService({ root: dir, commands: null, load: (o) => loadPlanApi({ ...o, linkOptions: NO_LINK }) });
  app.use('/api/line', createLinePlanRouter({ clientOrigin: ORIGIN, getRoot: () => ({ ok: true, root: dir }), serviceFor: () => svc }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const post = async (p, body) => (await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) })).json();
  // What the last session left needing you is left as it is first (Leave as it is, Approve), as the owner would.
  for (const s of (await (await fetch(`${base}/plan`)).json()).steps.filter((x) => x.state === 'needs-fix' || x.state === 'needs-you')) {
    const leave = await post('/plan/step', { tool: 'line.leaveAsIs', args: { stepId: s.id } });
    await post('/plan/approve', { stepId: leave.stepId });
    await post('/plan/run', { stepId: leave.stepId });
  }
  const list = listFragments(dir, PAGE);
  const added = await post('/plan/step', { tool: 'line.setFragment', args: { file: PAGE, fragmentId: list.fragments[0].id, code: "() => import('../../billing/pages/InvoicesPage')", contentHash: list.contentHash } });
  await post('/plan/approve', { stepId: added.stepId });
  const ran = await post('/plan/run', { stepId: added.stepId });
  const step = ran.steps.find((s) => s.id === added.stepId);
  assert.equal(step.state, 'needs-fix', step.sentence);
  const fix = step.result.options.find((o) => o.id === 'fix' && o.recommended);
  const fixStep = await post('/plan/step', { tool: fix.step.tool, args: { ...fix.step.args, fixOf: added.stepId } });
  await post('/plan/approve', { stepId: fixStep.stepId });
  await post('/plan/run', { stepId: fixStep.stepId });
  server.close();
}

const sentences = (out) => out.trim().split('\n').filter(Boolean);
const plain = (line) => /^(- [\w./-]+: )?(- )?[A-Z0-9`"].*[.:)]$/.test(line) && !/at .*\.mjs:\d+|Error:|undefined|\[object/.test(line);

test('UAT cl1: spec from code, two Cockpit sessions with the same refusal, then misses, a drafted issue and the picked context', async (t) => {
  // Step 1: what Line is, from its code.
  const spec = construct('line', 'spec', '--topic', 'plan');
  assert.equal(spec.status, 0, spec.stderr);
  const plan = JSON.parse(spec.stdout);
  assert.match(plan.version, /^sha256:[0-9a-f]{16}$/);
  assert.ok(plan.topics.plan.protocol.includes('Only a person approves a write step, in Cockpit; an agent cannot approve.'));

  // Step 2: a copy of the sample, and the same refused change in two Cockpit sessions.
  const dir = makeTempDir('line-cl1-uat-');
  fs.cpSync(path.join(REPO, 'examples/line-sample'), dir, { recursive: true });
  const before = construct('validate', '--dir', dir, '--profile', 'line', '--format', 'json');
  await cockpitSession(t, dir);
  await cockpitSession(t, dir);
  assert.equal(fs.readdirSync(path.join(dir, 'line/traces')).length, 2, 'one trace per session');

  // Step 3: what recurred.
  const misses = construct('line', 'misses', '--dir', dir);
  assert.equal(misses.status, 0, misses.stderr);
  const lines = sentences(misses.stdout);
  assert.equal(lines[0], 'Read 2 session traces: 2 kinds of refusal, 2 that recur with no working typed fix.');
  assert.ok(lines.includes('- Framework issue: Editing a code fragment (line.setFragment) was refused twice (LINE-DIR). Every typed fix or retry tried (2) was refused again or failed its checks.'), misses.stdout);
  assert.equal(lines.at(-1), 'Add --draft to write each one as a markdown issue in the project\'s line/issues folder (nothing is filed).');
  for (const l of lines) assert.ok(plain(l), `plain English: ${l}`);

  // Step 4: draft them (not filed), and read one.
  const drafted = construct('line', 'misses', '--dir', dir, '--draft');
  assert.equal(drafted.status, 0, drafted.stderr);
  const files = sentences(drafted.stdout).filter((l) => l.startsWith('Drafted (not filed): ')).map((l) => l.replace('Drafted (not filed): ', ''));
  assert.equal(files.length, 2);
  const md = fs.readFileSync(path.join(dir, files.find((f) => f.includes('setfragment'))), 'utf8');
  assert.match(md, /^# \[Framework\] Editing a code fragment \(line\.setFragment\) is refused with LINE-DIR and no typed fix works\n\n> Draft only/);
  assert.match(md, /## Spec slice \(rules\)\n- \*\*LINE-DIR\*\* \(error\): A feature uses the library and never another feature/);
  assert.match(md, /- `features\/billing\/pages\/InvoicesPage\.tsx`: The refused code imports InvoicesPage\.tsx\./);

  // Step 5: the context Line hands Claude for the latest miss.
  const ctx = construct('line', 'context', '--dir', dir);
  assert.equal(ctx.status, 0, ctx.stderr);
  const c = sentences(ctx.stdout);
  assert.match(c[0], /^The latest refusal, promoting an item to the library \(line\.promote\): This needs you: 0 of 2 checks passed\./);
  assert.equal(c[1], 'Line picked 3 files (static order):');
  for (const l of c) assert.ok(plain(l), `plain English: ${l}`);

  // Traces and drafts are Line state: validate finds nothing new because of them.
  const after = construct('validate', '--dir', dir, '--profile', 'line', '--format', 'json');
  assert.equal(after.stdout.length > 0, true);
  const count = (r) => { try { return JSON.parse(r.stdout).violations?.length ?? JSON.parse(r.stdout).findings?.length ?? null; } catch { return null; } };
  assert.equal(count(after), count(before), 'no new findings from line/traces or line/issues');
});
