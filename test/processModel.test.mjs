// #287 — the process record.
//
// Two properties matter more than the rest and are asserted first:
//  1. the plan is not mutated and never gains a `status` — #286's validator
//     rejects a step carrying one, and this is the file that would have been
//     tempted to add it;
//  2. a step cannot finish without stating whether a model was involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../src/plan.mjs';
import { PROCESS_MACHINE } from '../packages/engine/processMachine.mjs';
import {
  PROCESS_VERSION,
  STEP_STATUSES,
  LOG_PROVENANCE,
  ARTIFACT_CHANGES,
  MAX_LOG_ENTRIES,
  PROCESS_ERROR_CODES,
  PROCESS_ACTION_NAMES,
  createProcess,
  createProcessId,
  validateProcess,
  formatProcessErrors,
  appendLog,
  modelLog,
  recordArtifact,
  pendingApproval,
  setApproval,
  startStep,
  completeStep,
  failStep,
  skipStep,
  stepStatus,
  planStep,
  nextRunnableStep,
  dependenciesSatisfied,
  unreachableSteps,
  applyEvent,
  processSummary,
} from '../packages/engine/processModel.mjs';

function clock(start = Date.UTC(2026, 8, 20, 9, 0, 0)) {
  let t = start;
  return () => { const at = new Date(t).toISOString(); t += 1000; return at; };
}

const PLAN = {
  version: 1,
  ticket: { source: 'github-issue', ref: '#287', title: 'Process runtime model in core' },
  steps: [
    { id: 'a', title: 'Create the feature', flow: 'create.feature', args: { name: 'checkout' }, executor: 'deterministic', touches: { features: ['checkout'], files: [{ path: 'features/checkout/index.ts', change: 'create' }] } },
    { id: 'b', title: 'Fill the service', flow: 'create.unit', args: { layer: 'service', name: 'Totals', feature: 'checkout', llm: 'ollama' }, executor: 'local-model', dependsOn: ['a'], touches: { files: [{ path: 'features/checkout/services/Totals.ts', change: 'create' }] } },
    { id: 'c', title: 'Check the report', flow: 'validate', args: {}, executor: 'deterministic', dependsOn: ['b'] },
  ],
};

const fresh = (now = clock()) => createProcess(PLAN, { id: 'p1', projectRoot: '/tmp/project', now });

test('a process carries the plan verbatim and keeps run state beside it, never inside it', () => {
  const p = fresh();
  assert.equal(p.version, PROCESS_VERSION);
  assert.deepEqual(p.plan, PLAN, 'the plan is stored unchanged, so the record is self-contained');
  assert.equal(validatePlan(p.plan).valid, true, 'and is still a valid plan afterwards');
  assert.equal(PLAN.steps.some((s) => 'status' in s), false, 'no status leaked back into the plan — #286 rejects a step that carries one');

  assert.deepEqual(p.steps.map((s) => s.id), ['a', 'b', 'c'], 'per-step status is keyed by the plan step id');
  assert.equal(p.steps.every((s) => s.status === 'pending' && s.llm === null && s.attempts === 0), true);
  assert.equal(p.state, 'queued');
  assert.equal(p.title, 'Process runtime model in core');
  assert.equal(validateProcess(p).valid, true);
});

test('a process cannot be built around a plan that cannot execute', () => {
  assert.throws(() => createProcess({ version: 1, ticket: { source: 'text', title: 'x' }, steps: [] }, { projectRoot: '/tmp/p' }), /Cannot create a process for an invalid plan/);
  assert.throws(() => createProcess(PLAN, {}), /needs a `projectRoot`/);
  assert.match(createProcessId(), /^proc_[0-9a-f]{20}$/);
});

test('finishing a step without saying whether a model was involved is an error, not a default', () => {
  let p = startStep(fresh(), 'a', { now: clock() });
  assert.throws(() => completeStep(p, 'a', {}), /must state whether a model was involved/);
  assert.throws(() => failStep(p, 'a', { error: 'boom' }), /must state whether a model was involved/);

  p = completeStep(p, 'a', { llm: null, now: clock() });
  assert.equal(stepStatus(p, 'a').status, 'done');
  assert.equal(stepStatus(p, 'a').llm, null, 'null is a recorded fact: no model was involved');

  let q = startStep(fresh(), 'b', { now: clock() });
  q = completeStep(q, 'b', { llm: { provider: 'ollama', calls: 3 }, now: clock() });
  assert.deepEqual(stepStatus(q, 'b').llm, { provider: 'ollama', calls: 3 });
});

test('a validator catches a record whose finished step never recorded its model involvement', () => {
  const p = fresh();
  const broken = { ...p, steps: p.steps.map((s) => (s.id === 'a' ? { id: s.id, status: 'done' } : s)) };
  const { valid, errors } = validateProcess(broken);
  assert.equal(valid, false);
  assert.equal(errors.some((e) => e.code === PROCESS_ERROR_CODES.STEP_LLM_UNRECORDED), true);
  assert.match(formatProcessErrors(errors).join('\n'), /Use null for "no model"/);
});

test('a user step is awaiting-user rather than running, because it is a person doing it', () => {
  const plan = { ...PLAN, steps: [{ id: 'u', title: 'Review it', flow: 'manual.task', args: { instructions: 'Read it.' }, executor: 'user', touches: { features: [], files: [] } }] };
  const p = startStep(createProcess(plan, { id: 'p2', projectRoot: '/tmp/p', now: clock() }), 'u', { now: clock() });
  assert.equal(stepStatus(p, 'u').status, 'awaiting-user');
  assert.equal(STEP_STATUSES.includes('awaiting-user'), true);
});

test('log provenance is required and closed, and llm lines answer "where did a model touch this?"', () => {
  const now = clock();
  let p = fresh(now);
  assert.throws(() => appendLog(p, { provenance: 'error', message: 'x' }), /Log provenance must be one of: ok, llm, warn/);
  assert.throws(() => appendLog(p, { message: 'x' }), /Log provenance must be one of/);

  p = appendLog(p, { provenance: 'ok', message: 'scaffolded', stepId: 'a', now });
  p = appendLog(p, { provenance: 'llm', message: 'ollama wrote the body', stepId: 'b', now });
  p = appendLog(p, { provenance: 'warn', message: 'review it', stepId: 'b', now });

  assert.deepEqual(p.log.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(LOG_PROVENANCE, ['ok', 'llm', 'warn']);
  assert.deepEqual(modelLog(p).map((e) => e.message), ['ollama wrote the body']);
  assert.equal(p.log[0].at < p.log[1].at, true, 'entries are timestamped in order');
});

test('the log is bounded, and says how much it dropped rather than pretending it is complete', () => {
  const now = clock();
  let p = fresh(now);
  for (let i = 0; i < MAX_LOG_ENTRIES + 5; i += 1) p = appendLog(p, { provenance: 'ok', message: `line ${i}`, now });
  assert.equal(p.log.length, MAX_LOG_ENTRIES);
  assert.equal(p.logDropped, 5);
  assert.equal(p.logSeq, MAX_LOG_ENTRIES + 5);
  assert.equal(p.log[0].message, 'line 5', 'the oldest lines go first');
});

test('artifacts are project-relative, hashed, deduplicated per file, and start unapproved', () => {
  const now = clock();
  let p = fresh(now);
  assert.throws(() => recordArtifact(p, { path: '/etc/passwd', change: 'modify', now }), /absolute/);
  assert.throws(() => recordArtifact(p, { path: 'x.ts', change: 'move', now }), /Artifact change must be one of: create, modify, delete/);
  assert.deepEqual(ARTIFACT_CHANGES, ['create', 'modify', 'delete']);

  p = recordArtifact(p, { path: 'features/checkout/index.ts', change: 'create', stepId: 'a', after: 'export {};\n', now });
  assert.equal(p.artifacts.length, 1);
  assert.equal(p.artifacts[0].after.sha256.length, 64);
  assert.equal(p.artifacts[0].after.bytes, 11);
  assert.equal(p.artifacts[0].approved, null);

  // A later step editing the same file updates the record rather than adding
  // a second row — "what did this process do to this file" has one answer.
  p = recordArtifact(p, { path: 'features/checkout/index.ts', change: 'modify', stepId: 'b', after: 'export const x = 1;\n', now });
  assert.equal(p.artifacts.length, 1);
  assert.equal(p.artifacts[0].change, 'create', 'a file this process created is still a creation, however often it is then edited');
  assert.equal(p.artifacts[0].stepId, 'b');
});

test('approval is collected, not assumed', () => {
  const now = clock();
  let p = recordArtifact(recordArtifact(fresh(now), { path: 'a.ts', change: 'create', after: 'a', now }), { path: 'b.ts', change: 'create', after: 'b', now });
  assert.equal(pendingApproval(p).length, 2);
  p = setApproval(p, true, ['a.ts']);
  assert.deepEqual(pendingApproval(p).map((a) => a.path), ['b.ts']);
  p = setApproval(p, false);
  assert.deepEqual(p.artifacts.map((a) => a.approved), [true, false]);
});

test('the next runnable step is plan order, because #286 guarantees dependencies only point backwards', () => {
  const now = clock();
  let p = fresh(now);
  assert.equal(nextRunnableStep(p).id, 'a');
  assert.equal(dependenciesSatisfied(p, 'b'), false);

  p = completeStep(startStep(p, 'a', { now }), 'a', { llm: null, now });
  assert.equal(dependenciesSatisfied(p, 'b'), true);
  assert.equal(nextRunnableStep(p).id, 'b');

  p = failStep(startStep(p, 'b', { now }), 'b', { llm: { provider: 'ollama', calls: 1 }, error: 'model offline', now });
  assert.equal(nextRunnableStep(p), undefined, 'a step whose dependency failed is not runnable');
  assert.deepEqual(unreachableSteps(p).map((s) => s.id), ['c']);
  assert.equal(stepStatus(p, 'b').llm.provider, 'ollama', 'a step that failed AFTER calling a model still called a model');

  p = skipStep(p, 'c', { reason: 'b failed', now });
  assert.equal(stepStatus(p, 'c').status, 'skipped');
  assert.deepEqual(unreachableSteps(p), []);
});

test('planStep reaches the real plan step a runner hands to planToCommand', () => {
  const p = fresh();
  assert.equal(planStep(p, 'b').flow, 'create.unit');
  assert.equal(planStep(p, 'nope'), undefined);
});

test('every action the machine declares has an implementation — the two files cannot drift', () => {
  const declared = new Set();
  const walk = (states) => {
    for (const node of Object.values(states)) {
      for (const handler of Object.values(node.on || {})) {
        for (const branch of Array.isArray(handler) ? handler : [handler]) {
          for (const a of (typeof branch === 'object' && branch.actions) || []) declared.add(a);
        }
      }
      if (node.states) walk(node.states);
    }
  };
  walk(PROCESS_MACHINE.states);
  for (const action of declared) {
    assert.equal(PROCESS_ACTION_NAMES.includes(action), true, `the machine declares "${action}" with no implementation in processModel.mjs`);
  }
  assert.equal(declared.size > 0, true);
});

test('applyEvent runs the machine and its actions, and refuses an event by name instead of silently ignoring it', () => {
  const now = clock();
  const p = fresh(now);

  const rejected = applyEvent(p, 'RESUME', { now });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.process, p, 'a refused event leaves the record untouched');
  assert.equal(rejected.error.code, PROCESS_ERROR_CODES.EVENT_REJECTED);
  assert.match(rejected.error.message, /Accepted here: START, CANCEL/);

  const started = applyEvent(p, 'START', { now });
  assert.equal(started.accepted, true);
  assert.equal(started.process.state, 'running.active');
  assert.equal(started.process.startedAt !== null, true);
  assert.equal(started.process.log.at(-1).provenance, 'ok');

  const paused = applyEvent(started.process, 'PAUSE', { now });
  assert.equal(paused.process.state, 'running.stopping');
  assert.equal(paused.process.pendingControl, 'pause');

  const yielded = applyEvent(paused.process, 'YIELDED', { now });
  assert.equal(yielded.process.state, 'paused');

  const cancelled = applyEvent(yielded.process, 'CANCEL', { now });
  assert.equal(cancelled.process.state, 'cancelled');
  assert.equal(cancelled.process.finishedAt !== null, true);
  assert.equal(cancelled.process.pendingControl, null);
});

test('cancelling while a step is in flight puts that step back to pending — its staged writes never landed', () => {
  const now = clock();
  let p = startStep(applyEvent(fresh(now), 'START', { now }).process, 'a', { now });
  assert.equal(p.currentStepId, 'a');

  p = applyEvent(p, 'CANCEL', { now }).process;
  assert.equal(p.state, 'running.stopping');
  p = applyEvent(p, 'YIELDED', { now }).process;

  assert.equal(p.state, 'cancelled');
  assert.equal(stepStatus(p, 'a').status, 'pending', 'nothing was committed, so the step simply did not happen');
  assert.equal(p.currentStepId, null);
});

test('a failed process reports warn provenance on the move itself', () => {
  const now = clock();
  const running = applyEvent(fresh(now), 'START', { now }).process;
  const failed = applyEvent(running, 'STEP_FAILED', { now });
  assert.equal(failed.process.state, 'failed');
  assert.equal(failed.process.log.at(-1).provenance, 'warn');
});

test('processSummary is everything a list row needs and nothing a client should not be shipped', () => {
  const now = clock();
  let p = applyEvent(fresh(now), 'START', { now }).process;
  p = completeStep(startStep(p, 'a', { now }), 'a', { llm: null, now });
  p = recordArtifact(p, { path: 'features/checkout/index.ts', change: 'create', stepId: 'a', after: 'x', now });

  const s = processSummary(p);
  assert.equal(s.state, 'running');
  assert.equal(s.stateDetail, 'running.active');
  assert.deepEqual(s.progress, { done: 1, failed: 0, total: 3 });
  assert.equal(s.plannedModelSteps, 1, 'how many steps the plan says a model will touch');
  assert.equal(s.modelSteps, 0, 'and how many actually have so far');
  assert.equal(s.pendingApproval, 1);
  assert.equal(s.terminal, false);
  assert.deepEqual(s.controls, ['STEP_COMPLETED', 'STEP_FAILED', 'FINISHED', 'PAUSE', 'CANCEL']);
  assert.equal('plan' in s, false, 'a list row does not carry the whole plan');
  assert.equal('log' in s, false);
});

test('validateProcess names every kind of corruption rather than throwing', () => {
  const p = fresh();
  const cases = [
    [null, PROCESS_ERROR_CODES.PROCESS_NOT_OBJECT],
    [{ ...p, version: 99 }, PROCESS_ERROR_CODES.PROCESS_VERSION_INVALID],
    [{ ...p, surprise: 1 }, PROCESS_ERROR_CODES.PROCESS_UNKNOWN_FIELD],
    [{ ...p, state: 'melted' }, PROCESS_ERROR_CODES.PROCESS_STATE_INVALID],
    [{ ...p, pendingControl: 'stop' }, PROCESS_ERROR_CODES.PENDING_CONTROL_INVALID],
    [{ ...p, id: '' }, PROCESS_ERROR_CODES.PROCESS_FIELD_TYPE],
    [{ ...p, steps: p.steps.map((s) => ({ ...s, status: 'wat' })) }, PROCESS_ERROR_CODES.STEP_STATUS_INVALID],
    [{ ...p, steps: [...p.steps, { id: 'ghost', status: 'pending' }] }, PROCESS_ERROR_CODES.STEP_UNKNOWN],
    [{ ...p, steps: p.steps.slice(1) }, PROCESS_ERROR_CODES.STEP_MISSING],
    [{ ...p, log: [{ seq: 1, message: 'x' }] }, PROCESS_ERROR_CODES.LOG_PROVENANCE_INVALID],
    [{ ...p, log: [{ seq: 1, provenance: 'ok', message: 'x', stepId: 'ghost' }] }, PROCESS_ERROR_CODES.LOG_STEP_UNKNOWN],
    [{ ...p, artifacts: [{ path: 'a.ts', change: 'move' }] }, PROCESS_ERROR_CODES.ARTIFACT_CHANGE_INVALID],
    [{ ...p, artifacts: [{ path: '/abs.ts', change: 'create' }] }, PROCESS_ERROR_CODES.ARTIFACT_PATH_ABSOLUTE],
    [{ ...p, artifacts: [{ path: 'a.ts', change: 'create', stepId: 'ghost' }] }, PROCESS_ERROR_CODES.ARTIFACT_STEP_UNKNOWN],
    [{ ...p, plan: { ...PLAN, steps: [{ ...PLAN.steps[0], status: 'done' }] } }, PROCESS_ERROR_CODES.PROCESS_PLAN_INVALID],
  ];
  for (const [record, code] of cases) {
    const { valid, errors } = validateProcess(record);
    assert.equal(valid, false, `${code} should have been rejected`);
    assert.equal(errors.some((e) => e.code === code), true, `expected ${code}, got ${errors.map((e) => e.code).join(', ')}`);
  }

  const missing = validateProcess({ version: PROCESS_VERSION });
  assert.equal(missing.errors.filter((e) => e.code === PROCESS_ERROR_CODES.PROCESS_MISSING_FIELD).length > 3, true, 'every missing field is reported, not just the first');
});
