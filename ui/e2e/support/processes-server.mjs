// #292 e2e harness: the real ui/server, with a FAKE step executor and two
// test-only routes, so the Processes drawer can be driven against a process
// that is genuinely running, paused, cancelled or failing.
//
// Everything a test observes goes through the product: the real session gate,
// the real routes, the real socket, the real process engine and store. Only
// two things are faked, and both are the seams the product itself provides:
// `executeStep` (what a bot runner would supply, #291) and the project
// directory. Starting a process from the UI is Plan mode (#289), not built, so
// the test creates one through the core API instead: `/__test/create`.
//
// The `/__test/*` routes exist ONLY in this file. They are not in ui/server,
// and they are outside `/api`, so they cannot be mistaken for product surface.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-e2e-proc-project-')));
const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-e2e-proc-state-')));
process.env.CONSTRUCT_STATE_DIR = stateDir;
process.chdir(projectDir);
// #365: the server no longer opens its working directory. The harness names this project explicitly (the config
// sets CONSTRUCT_WORKSPACE_ROOT to the tmp dir, so it is inside the workspace and contained like any other).
process.env.CONSTRUCT_E2E_PROJECT_DIR = projectDir;

const { app, start, processesService } = await import('../../server/src/index.mjs');
const { createProcess } = await import('../../../src/engine/processModel.mjs');

const touching = (file) => ({ features: ['checkout'], files: [{ path: file, change: 'create' }] });
const PLAN = (title) => ({
  version: 1,
  ticket: { source: 'text', title },
  steps: [
    { id: 'feature', title: 'Create the checkout feature', flow: 'create.feature', args: { name: 'checkout' }, executor: 'deterministic', touches: touching('features/checkout/index.ts') },
    { id: 'domain', title: 'Scaffold the Total domain unit', flow: 'create.unit', args: { layer: 'domain', name: 'Total', feature: 'checkout' }, executor: 'deterministic', dependsOn: ['feature'], touches: touching('features/checkout/domain/Total.ts') },
    { id: 'fill', title: 'Write the totals logic with a local model', flow: 'create.unit', args: { layer: 'service', name: 'Totals', feature: 'checkout', llm: 'ollama' }, executor: 'local-model', dependsOn: ['domain'], touches: touching('features/checkout/services/Totals.ts') },
  ],
});

/** `${processId}:${stepId}` -> release() for a step waiting on the test. */
const gates = new Map();
/** processIds whose first attempt at their first step should fail. */
const failOnce = new Set();

processesService.setExecutor(({ process: record, step, status, signal, log }) => new Promise((resolve, reject) => {
  const key = `${record.id}:${step.id}`;
  signal.addEventListener('abort', () => { gates.delete(key); reject(new Error('aborted')); }, { once: true });
  gates.set(key, () => {
    gates.delete(key);
    if (failOnce.has(record.id) && status.attempts === 1) {
      failOnce.delete(record.id);
      resolve({ ok: false, llm: null, error: 'the domain unit could not be scaffolded' });
      return;
    }
    if (step.executor === 'local-model') {
      log('llm', 'qwen2.5-coder:7b returned a scoped snippet for Totals.ts');
      resolve({
        ok: true,
        llm: { provider: 'ollama', calls: 2 },
        artifacts: [{ path: 'features/checkout/services/Totals.ts', change: 'create', before: null, after: 'export const total = 0;\n' }],
      });
      return;
    }
    log('ok', `${step.title}: block finished`);
    resolve({ ok: true, llm: null });
  });
}));

app.post('/__test/create', (req, res) => {
  const store = processesService.store();
  const engine = processesService.engine();
  const title = String(req.body?.title || 'Add totals to checkout');
  const record = createProcess(PLAN(title), { projectRoot: processesService.currentRoot(), title });
  store.save(record);
  if (req.body?.failOnce) failOnce.add(record.id);
  engine.start(record.id);
  res.json({ ok: true, id: record.id });
});

// #341: a FINISHED process whose bot left three files on its branch, so the approval UI can be driven
// against the real gate (src/engine/approvalGate.mjs). The project directory becomes a real git repo
// with a committed base; the bot branch is built the way the runner builds it (a worktree + a commit).
//   approve-N.txt   declared by the plan   -> applicable, the test approves it
//   reject-N.txt    declared by the plan   -> applicable, the test rejects it
//   sneaky-N.txt    NOT declared by the plan -> the gate refuses it (OUTSIDE_TOUCHES)
const { recordArtifact } = await import('../../../src/engine/processModel.mjs');
const { botBranch } = await import('../../../src/engine/botRunner.mjs');
const { spawnSync } = await import('node:child_process');
let seeds = 0;
const vcs = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

app.post('/__test/seed-review', (req, res) => {
  const root = processesService.currentRoot();
  seeds += 1;
  const n = seeds;
  if (!fs.existsSync(path.join(root, '.git'))) vcs(root, 'init', '-q', '-b', 'main');
  const base = { [`approve-${n}.txt`]: 'alpha\nbeta\n', [`reject-${n}.txt`]: 'one\ntwo\n' };
  for (const [p, c] of Object.entries(base)) fs.writeFileSync(path.join(root, p), c);
  vcs(root, 'add', '-A');
  vcs(root, 'commit', '-q', '-m', `base ${n}`);
  const bot = { [`approve-${n}.txt`]: 'alpha\nbeta\ngamma\n', [`reject-${n}.txt`]: 'one\ntwo\nthree\n', [`sneaky-${n}.txt`]: 'not in the plan\n' };
  const id = `review-${n}`;
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-e2e-wt-')), 'wt');
  vcs(root, 'worktree', 'add', '-q', '-b', botBranch(id), wt, 'HEAD');
  const changes = [];
  for (const [p, c] of Object.entries(bot)) {
    fs.writeFileSync(path.join(wt, p), c);
    changes.push({ path: p, change: p in base ? 'modify' : 'create', before: p in base ? base[p] : null, after: c });
  }
  vcs(wt, 'add', '-A');
  vcs(wt, 'commit', '-q', '-m', 'bot: step');
  vcs(root, 'worktree', 'remove', '--force', wt);
  const declared = changes.filter((c) => !c.path.startsWith('sneaky')).map((c) => ({ path: c.path, change: c.change }));
  const plan = { version: 1, ticket: { source: 'text', title: String(req.body?.title || 'Update the notes') }, steps: [{ id: 'edit', title: 'Edit the notes', flow: 'create.unit', args: { layer: 'domain', name: 'Notes', feature: 'notes' }, executor: 'deterministic', touches: { features: [], files: declared } }] };
  let rec = createProcess(plan, { id, projectRoot: root, title: plan.ticket.title });
  for (const c of changes) rec = recordArtifact(rec, { ...c, stepId: 'edit' });
  rec = { ...rec, state: 'done', steps: rec.steps.map((s) => ({ ...s, status: 'done' })) };
  processesService.store().save(rec);
  res.json({ ok: true, id, root, n });
});

app.post('/__test/release',(req, res) => {
  const key = `${req.body?.id}:${req.body?.step}`;
  const release = gates.get(key);
  if (!release) return res.status(404).json({ ok: false, error: `nothing waiting on ${key}` });
  release();
  return res.json({ ok: true });
});

app.get('/__test/waiting', (req, res) => res.json({ ok: true, waiting: [...gates.keys()] }));

start();
