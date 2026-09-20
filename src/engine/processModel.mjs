// #287 — the process record: what a running plan actually is, as JSON.
//
// A process is a plan (#286) plus everything the plan itself deliberately
// refuses to carry: which step is running, what each step's status is, the
// log of what happened with provenance, and the files that were changed.
// #286's validator REJECTS a plan step carrying `status`, and that stays
// true — status here is keyed by `step.id` and lives beside the plan, never
// inside it, so re-planning the same ticket still produces byte-identical
// JSON.
//
// Everything in this file is pure: every mutator takes a process and returns
// a NEW process, nothing reads the filesystem, and the clock is injected
// (`now`), so a test can assert on exact timestamps and a caller can replay
// a process deterministically. Persistence is processStore.mjs's job; running
// steps is processEngine.mjs's.
//
// The machine's action names (`markStarted`, `requestPause`, ...) are
// implemented here, in ACTIONS: processMachine.mjs decides *whether* an event
// is accepted and *which* actions fire, this file decides what they do to the
// record. Neither file can drift from the other silently, because an action
// named in the config with no implementation here fails a test.
import crypto from 'node:crypto';
import { validatePlan } from '../plan.mjs';
import {
  PROCESS_STATES,
  PROCESS_STATE_PATHS,
  transition,
  initialProcessState,
  topLevelState,
  isTerminal,
  allowedEvents,
} from './processMachine.mjs';

export const PROCESS_VERSION = 1;

/** Per-step status, keyed by the plan step's `id`.
 *  - `pending`       not reached yet
 *  - `running`       in flight
 *  - `awaiting-user` a `user`-executor step has been reached; the process
 *                    pauses and waits for the person (#291's "You" steps)
 *  - `done` / `failed`
 *  - `skipped`       never run, because the process was cancelled or an
 *                    earlier step it depends on failed */
export const STEP_STATUSES = Object.freeze(['pending', 'running', 'awaiting-user', 'done', 'failed', 'skipped']);

/**
 * Log provenance — the exact three badges `docs/design/cockpit-layout.md` §5
 * names, and a closed set on purpose:
 *  - `ok`   a deterministic block did this and it succeeded. No model.
 *  - `llm`  a model was involved, whatever the outcome. Filtering the log to
 *           this one value must always answer "where did a model touch my
 *           project?" — that is the Vision-level requirement, so it is keyed
 *           to involvement, not to success.
 *  - `warn` something wants a human's attention, including a step failing.
 *
 * There is deliberately no separate `error` provenance: a failure is not only
 * a log line, it is `steps[].status === 'failed'` with `steps[].error`, which
 * is the authoritative record. The log badge stays the design's three.
 */
export const LOG_PROVENANCE = Object.freeze(['ok', 'llm', 'warn']);

/** How an artifact changed a file. A subset of the plan's TOUCH_CHANGES —
 * `read` and `move` are not artifacts: nothing was written. */
export const ARTIFACT_CHANGES = Object.freeze(['create', 'modify', 'delete']);

/** Control a caller has asked for but that has not taken effect yet, because
 * a step in flight cannot be torn down mid-syscall. */
export const PENDING_CONTROLS = Object.freeze(['pause', 'cancel']);

/** Oldest entries are dropped past this, and `logDropped` counts them, so a
 * long-running process cannot grow its state file without bound. */
export const MAX_LOG_ENTRIES = 2000;

export const PROCESS_ERROR_CODES = Object.freeze({
  PROCESS_NOT_OBJECT: 'PROCESS_NOT_OBJECT',
  PROCESS_MISSING_FIELD: 'PROCESS_MISSING_FIELD',
  PROCESS_UNKNOWN_FIELD: 'PROCESS_UNKNOWN_FIELD',
  PROCESS_FIELD_TYPE: 'PROCESS_FIELD_TYPE',
  PROCESS_VERSION_INVALID: 'PROCESS_VERSION_INVALID',
  PROCESS_STATE_INVALID: 'PROCESS_STATE_INVALID',
  PROCESS_PLAN_INVALID: 'PROCESS_PLAN_INVALID',
  PENDING_CONTROL_INVALID: 'PENDING_CONTROL_INVALID',
  STEP_UNKNOWN: 'STEP_UNKNOWN',
  STEP_MISSING: 'STEP_MISSING',
  STEP_STATUS_INVALID: 'STEP_STATUS_INVALID',
  STEP_LLM_UNRECORDED: 'STEP_LLM_UNRECORDED',
  LOG_PROVENANCE_INVALID: 'LOG_PROVENANCE_INVALID',
  LOG_STEP_UNKNOWN: 'LOG_STEP_UNKNOWN',
  ARTIFACT_CHANGE_INVALID: 'ARTIFACT_CHANGE_INVALID',
  ARTIFACT_PATH_ABSOLUTE: 'ARTIFACT_PATH_ABSOLUTE',
  ARTIFACT_STEP_UNKNOWN: 'ARTIFACT_STEP_UNKNOWN',
  EVENT_REJECTED: 'EVENT_REJECTED',
});

export const PROCESS_TOP_LEVEL_FIELDS = Object.freeze([
  'version', 'id', 'projectRoot', 'title', 'plan', 'state', 'pendingControl', 'currentStepId',
  'createdAt', 'startedAt', 'finishedAt', 'steps', 'log', 'logSeq', 'logDropped', 'artifacts', 'error', 'owner',
]);
export const PROCESS_REQUIRED_FIELDS = Object.freeze([
  'version', 'id', 'projectRoot', 'plan', 'state', 'createdAt', 'steps', 'log', 'artifacts',
]);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isAbsolutePath = (p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
const defaultNow = () => new Date().toISOString();

/** A fresh process id. Random by design — a process is an event in time, not
 * a derivation of the plan, and two runs of the same plan are two processes.
 * Callers that need determinism (tests, replay) pass their own `id`. */
export function createProcessId() {
  return `proc_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** The sha256 of some content, or null for content that was deleted. */
function hashOf(content) {
  if (content === null || content === undefined) return null;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Build a process for `plan`. The plan is stored verbatim so the record is
 * self-contained: a process file read a week later still knows exactly what
 * it was running, even if the plan that produced it is long gone.
 *
 * Throws TypeError on an invalid plan — a process must never be created
 * around a plan that cannot execute. Validate with `validatePlan()` and show
 * the errors before getting here.
 *
 * @param {object} plan a valid plan.v1 object
 * @param {object} [options]
 * @param {string} [options.id]
 * @param {string} [options.projectRoot]
 * @param {() => string} [options.now]
 * @param {string} [options.title]
 */
export function createProcess(plan, { id = createProcessId(), projectRoot, now = defaultNow, title } = {}) {
  const { valid, errors } = validatePlan(plan);
  if (!valid) throw new TypeError(`Cannot create a process for an invalid plan: ${errors[0].code} at ${errors[0].path || '(root)'} — ${errors[0].message}`);
  if (!isNonEmptyString(projectRoot)) throw new TypeError('createProcess() needs a `projectRoot` — a process is always a process against a project.');

  const at = now();
  return {
    version: PROCESS_VERSION,
    id,
    projectRoot,
    title: title || plan.ticket.title,
    plan,
    state: initialProcessState(),
    pendingControl: null,
    currentStepId: null,
    createdAt: at,
    startedAt: null,
    finishedAt: null,
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      flow: step.flow,
      executor: step.executor,
      status: 'pending',
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      // `llm` is null until the step finishes, and MUST be set explicitly
      // then — see completeStep(). "A model was not involved" is a recorded
      // fact, not an absence.
      llm: null,
      error: null,
    })),
    log: [],
    logSeq: 0,
    logDropped: 0,
    artifacts: [],
    error: null,
    // Which OS process is driving this one, set by processStore.mjs on save.
    // How a `running` record left behind by a killed server is recognised as
    // not actually running; see adoptInterrupted().
    owner: null,
  };
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

/**
 * Append a log entry. `provenance` is required and closed (LOG_PROVENANCE) —
 * there is no default, because a default is how "was a model involved?"
 * quietly stops being answerable.
 *
 * Returns a new process. Throws TypeError on an unknown provenance.
 */
export function appendLog(process, { provenance, message, stepId = null, detail = null, now = defaultNow }) {
  if (!LOG_PROVENANCE.includes(provenance)) {
    throw new TypeError(`Log provenance must be one of: ${LOG_PROVENANCE.join(', ')} (got ${JSON.stringify(provenance)}).`);
  }
  const seq = process.logSeq + 1;
  const entry = {
    seq,
    at: now(),
    provenance,
    message: String(message),
    stepId,
    ...(detail ? { detail } : {}),
  };
  const log = [...process.log, entry];
  const overflow = Math.max(0, log.length - MAX_LOG_ENTRIES);
  return {
    ...process,
    log: overflow ? log.slice(overflow) : log,
    logSeq: seq,
    logDropped: process.logDropped + overflow,
  };
}

/** Every log entry a model produced — the one-call answer to "where did a
 * model touch this?", which is why `llm` is provenance and not severity. */
export function modelLog(process) {
  return process.log.filter((e) => e.provenance === 'llm');
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

/**
 * Record a file this process changed. `before`/`after` are optional file
 * contents: pass them and the artifact carries the hashes and byte counts a
 * Diff tab needs without re-reading a tree that may have moved on; omit them
 * and the artifact is still a truthful record of what was touched.
 *
 * `approved` starts null — collected, not accepted. The approval gate itself
 * is #291's (the runner must not accept model output on its own); this is the
 * place it records its verdict.
 */
export function recordArtifact(process, { path: filePath, change, stepId = null, before, after, now = defaultNow }) {
  if (!ARTIFACT_CHANGES.includes(change)) {
    throw new TypeError(`Artifact change must be one of: ${ARTIFACT_CHANGES.join(', ')} (got ${JSON.stringify(change)}).`);
  }
  if (!isNonEmptyString(filePath)) throw new TypeError('An artifact needs a non-empty project-relative path.');
  if (isAbsolutePath(filePath)) {
    throw new TypeError(`Artifact path "${filePath}" is absolute — artifacts are project-relative so a process record stays portable, the same rule the plan's \`touches\` follows.`);
  }

  const artifact = {
    path: filePath,
    change,
    stepId,
    at: now(),
    approved: null,
    before: before === undefined ? null : { bytes: before === null ? 0 : Buffer.byteLength(before), sha256: hashOf(before) },
    after: after === undefined ? null : { bytes: after === null ? 0 : Buffer.byteLength(after), sha256: hashOf(after) },
  };
  // Re-touching the same file in the same process replaces the record rather
  // than accumulating one row per write: the Diff tab asks "what did this
  // process do to this file", which has one answer.
  const existing = process.artifacts.findIndex((a) => a.path === filePath);
  const artifacts = [...process.artifacts];
  if (existing >= 0) {
    artifacts[existing] = {
      ...artifact,
      // A file created and then modified by a later step is still a creation
      // as far as the tree is concerned, and its `before` is the first one.
      change: artifacts[existing].change === 'create' && change === 'modify' ? 'create' : change,
      before: artifacts[existing].before ?? artifact.before,
      approved: artifacts[existing].approved,
    };
  } else {
    artifacts.push(artifact);
  }
  return { ...process, artifacts };
}

/** Artifacts still waiting for a human verdict. */
export function pendingApproval(process) {
  return process.artifacts.filter((a) => a.approved === null);
}

/**
 * Set the approval verdict on artifacts. `paths` omitted means "every
 * artifact still awaiting a verdict" — deliberately NOT "every artifact":
 * an Approve-all or Reject-all button must not quietly overturn a decision
 * the user already made on a specific file. Naming a path always wins, so an
 * explicit change of mind is still possible.
 */
export function setApproval(process, approved, paths = null) {
  const targets = paths === null ? null : new Set(paths);
  return {
    ...process,
    artifacts: process.artifacts.map((a) => {
      const selected = targets === null ? a.approved === null : targets.has(a.path);
      return selected ? { ...a, approved } : a;
    }),
  };
}

// ---------------------------------------------------------------------------
// Per-step status
// ---------------------------------------------------------------------------

function patchStep(process, stepId, patch) {
  const i = process.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new TypeError(`No step "${stepId}" in process ${process.id}.`);
  const steps = [...process.steps];
  steps[i] = { ...steps[i], ...patch };
  return { ...process, steps };
}

/** The step record for `stepId`, or undefined. */
export function stepStatus(process, stepId) {
  return process.steps.find((s) => s.id === stepId);
}

/** The plan step (not the status record) for `stepId`, or undefined — what a
 * runner hands to `planToCommand()`. */
export function planStep(process, stepId) {
  return process.plan.steps.find((s) => s.id === stepId);
}

/**
 * The next step to run: the first `pending` step in plan array order. #286
 * guarantees `dependsOn` only points at EARLIER steps, so array order is
 * already a valid execution order and no topological sort is needed here.
 * Returns undefined when nothing is left to run.
 *
 * A step whose dependency failed or was skipped is not runnable; the engine
 * skips it rather than running it into a broken precondition.
 */
export function nextRunnableStep(process) {
  return process.steps.find((s) => s.status === 'pending' && dependenciesSatisfied(process, s.id));
}

/** True when every step this one `dependsOn` finished successfully. */
export function dependenciesSatisfied(process, stepId) {
  const step = planStep(process, stepId);
  return (step?.dependsOn || []).every((dep) => stepStatus(process, dep)?.status === 'done');
}

/** Steps that can never run now, because something they depend on did not
 * finish. The engine marks them `skipped` rather than leaving them `pending`
 * forever, so a failed process's step list is honest. */
export function unreachableSteps(process) {
  return process.steps.filter(
    (s) => s.status === 'pending' && (planStep(process, s.id)?.dependsOn || []).some((dep) => ['failed', 'skipped'].includes(stepStatus(process, dep)?.status)),
  );
}

/** Mark a step as started. `awaiting-user` instead of `running` for a `user`
 * step, which is a thing a person does, not a thing the runner is doing. */
export function startStep(process, stepId, { now = defaultNow } = {}) {
  const step = stepStatus(process, stepId);
  if (!step) throw new TypeError(`No step "${stepId}" in process ${process.id}.`);
  const status = step.executor === 'user' ? 'awaiting-user' : 'running';
  const next = patchStep(process, stepId, { status, attempts: step.attempts + 1, startedAt: now(), finishedAt: null, error: null });
  return { ...next, currentStepId: stepId };
}

/**
 * @param {object} process
 * @param {string} stepId
 * @param {string} status
 * @param {object} options
 * @param {{provider?: string, calls?: number} | null} [options.llm]
 * @param {string | null} [options.error]
 * @param {() => string} [options.now]
 */
function finishStep(process, stepId, status, { llm, error = null, now = defaultNow }) {
  const step = stepStatus(process, stepId);
  if (!step) throw new TypeError(`No step "${stepId}" in process ${process.id}.`);
  if (llm === undefined) {
    throw new TypeError(
      `Finishing step "${stepId}" must state whether a model was involved: pass llm: null for none, or llm: { provider, calls }. `
      + 'Every step records this (#287); an unset value would make "where did a model touch my project?" unanswerable.',
    );
  }
  const finishedAt = now();
  const durationMs = step.startedAt ? Date.parse(finishedAt) - Date.parse(step.startedAt) : null;
  const next = patchStep(process, stepId, {
    status,
    finishedAt,
    durationMs: Number.isNaN(durationMs) ? null : durationMs,
    llm: llm === null ? null : { provider: llm.provider ?? null, calls: llm.calls ?? 0 },
    error,
  });
  return { ...next, currentStepId: next.currentStepId === stepId ? null : next.currentStepId };
}

/** Finish a step successfully. `llm` is required: `null` for a deterministic
 * step, `{ provider, calls }` when a model wrote something.
 *
 * @param {object} process
 * @param {string} stepId
 * @param {object} [options]
 * @param {{provider?: string, calls?: number} | null} [options.llm]
 * @param {() => string} [options.now]
 */
export function completeStep(process, stepId, { llm, now = defaultNow } = {}) {
  return finishStep(process, stepId, 'done', { llm, now });
}

/** Finish a step as failed. `llm` is required for the same reason — a step
 * that failed *after* calling a model still called a model.
 *
 * @param {object} process
 * @param {string} stepId
 * @param {object} [options]
 * @param {{provider?: string, calls?: number} | null} [options.llm]
 * @param {unknown} [options.error]
 * @param {() => string} [options.now]
 */
export function failStep(process, stepId, { llm, error, now = defaultNow } = {}) {
  return finishStep(process, stepId, 'failed', { llm, error: error ? String(error) : 'failed', now });
}

/** Mark a step as never-going-to-run. */
export function skipStep(process, stepId, { reason = null, now = defaultNow } = {}) {
  return patchStep(process, stepId, { status: 'skipped', finishedAt: now(), error: reason, llm: null });
}

// ---------------------------------------------------------------------------
// The lifecycle: events in, new process out
// ---------------------------------------------------------------------------

/** The machine's action names, implemented. processMachine.mjs owns *when*
 * each fires; this owns *what it does*. An action named in the config with no
 * entry here fails test/processModel.test.mjs. */
const ACTIONS = Object.freeze({
  markStarted: (p, { now }) => ({ ...p, startedAt: p.startedAt || now(), pendingControl: null }),
  markFinished: (p, { now }) => ({ ...p, finishedAt: now(), pendingControl: null, currentStepId: null }),
  requestPause: (p) => ({ ...p, pendingControl: 'pause' }),
  requestCancel: (p) => ({ ...p, pendingControl: 'cancel' }),
  clearPendingControl: (p) => ({ ...p, pendingControl: null, error: null }),
  // The in-flight step's staged writes are dropped; see the cancel decision
  // on #287. Nothing to undo on disk — transactionalWriter.mjs buffers a
  // step's writes and only lands them on a successful commit(), so a step
  // stopped in flight has written nothing. This marks the record to match.
  discardStepTransaction: (p, { now }) => (p.currentStepId
    ? { ...patchStep(p, p.currentStepId, { status: 'pending', finishedAt: now(), error: null }), currentStepId: null }
    : p),
  recordStepResult: (p) => p, // startStep/completeStep/failStep already did it
});

/** The action names the machine declares, for the drift test. */
export const PROCESS_ACTION_NAMES = Object.freeze(Object.keys(ACTIONS));

/**
 * Send a lifecycle event. The single entry point for state changes: it runs
 * the machine, applies the declared actions, and logs the move.
 *
 * Returns `{ process, accepted, error }`. `accepted: false` leaves the
 * process untouched and names why — "you cannot resume a process that is not
 * paused" is a refusal with a code, not a silent no-op, so an API can answer
 * a bad request honestly.
 */
export function applyEvent(process, eventType, { now = defaultNow, message = null } = {}) {
  const result = transition(process.state, eventType, process);
  if (!result) {
    return {
      process,
      accepted: false,
      error: {
        code: PROCESS_ERROR_CODES.EVENT_REJECTED,
        message: `Process ${process.id} is in "${process.state}" and does not accept "${eventType}". Accepted here: ${allowedEvents(process.state, process).join(', ') || 'nothing — it is finished'}.`,
      },
    };
  }
  let next = { ...process, state: result.value };
  for (const action of result.actions) {
    const fn = ACTIONS[action];
    if (!fn) throw new TypeError(`The process machine declares action "${action}" with no implementation in processModel.mjs.`);
    next = fn(next, { now, event: eventType });
  }
  if (result.changed) {
    next = appendLog(next, {
      provenance: topLevelState(result.value) === 'failed' ? 'warn' : 'ok',
      message: message || `Process ${eventType.toLowerCase().replace(/_/g, ' ')}: ${process.state} → ${result.value}.`,
      now,
    });
  }
  return { process: next, accepted: true, error: null };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * What a list of processes shows (#292): enough to render a row without
 * shipping the whole plan, the whole log and every artifact to a client.
 */
export function processSummary(process) {
  const done = process.steps.filter((s) => s.status === 'done').length;
  const failed = process.steps.filter((s) => s.status === 'failed').length;
  return {
    id: process.id,
    title: process.title,
    projectRoot: process.projectRoot,
    state: topLevelState(process.state),
    stateDetail: process.state,
    pendingControl: process.pendingControl,
    currentStepId: process.currentStepId,
    progress: { done, failed, total: process.steps.length },
    // "Where was a model involved?" answerable from a list row, not only by
    // opening the detail view.
    modelSteps: process.steps.filter((s) => s.llm !== null).length,
    plannedModelSteps: process.plan.steps.filter((s) => s.executor === 'local-model').length,
    artifacts: process.artifacts.length,
    pendingApproval: pendingApproval(process).length,
    createdAt: process.createdAt,
    startedAt: process.startedAt,
    finishedAt: process.finishedAt,
    terminal: isTerminal(process.state),
    controls: allowedEvents(process.state, process),
    error: process.error,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Structural check of a process record, mirroring `validatePlan()`'s
 * contract: `{ valid, errors }`, never throws, never mutates, never prints,
 * and reports every problem rather than stopping at the first. The store runs
 * it on every load, so a hand-edited or truncated state file is rejected with
 * a named code instead of crashing a server on a missing field.
 */
export function validateProcess(process) {
  const errors = [];
  const push = (code, at, message) => errors.push({ code, path: at, message });

  if (!isPlainObject(process)) {
    return { valid: false, errors: [{ code: PROCESS_ERROR_CODES.PROCESS_NOT_OBJECT, path: '', message: 'A process must be a JSON object.' }] };
  }
  for (const key of Object.keys(process)) {
    if (!PROCESS_TOP_LEVEL_FIELDS.includes(key)) {
      push(PROCESS_ERROR_CODES.PROCESS_UNKNOWN_FIELD, key, `Unknown process field "${key}". Known fields: ${PROCESS_TOP_LEVEL_FIELDS.join(', ')}.`);
    }
  }
  for (const key of PROCESS_REQUIRED_FIELDS) {
    if (!(key in process)) push(PROCESS_ERROR_CODES.PROCESS_MISSING_FIELD, key, `Missing required field "${key}".`);
  }
  if ('version' in process && process.version !== PROCESS_VERSION) {
    push(PROCESS_ERROR_CODES.PROCESS_VERSION_INVALID, 'version', `"version" must be ${PROCESS_VERSION} (got ${JSON.stringify(process.version)}).`);
  }
  if ('id' in process && !isNonEmptyString(process.id)) push(PROCESS_ERROR_CODES.PROCESS_FIELD_TYPE, 'id', '"id" must be a non-empty string.');
  if ('projectRoot' in process && !isNonEmptyString(process.projectRoot)) push(PROCESS_ERROR_CODES.PROCESS_FIELD_TYPE, 'projectRoot', '"projectRoot" must be a non-empty string.');
  if ('state' in process && !PROCESS_STATE_PATHS.includes(process.state)) {
    push(
      PROCESS_ERROR_CODES.PROCESS_STATE_INVALID,
      'state',
      `"state" must be one of the machine's state paths: ${PROCESS_STATE_PATHS.join(', ')} (got ${JSON.stringify(process.state)}). Top-level states are ${PROCESS_STATES.join(', ')}.`,
    );
  }
  if (process.pendingControl != null && !PENDING_CONTROLS.includes(process.pendingControl)) {
    push(PROCESS_ERROR_CODES.PENDING_CONTROL_INVALID, 'pendingControl', `"pendingControl" must be null or one of: ${PENDING_CONTROLS.join(', ')}.`);
  }

  const planResult = 'plan' in process ? validatePlan(process.plan) : { valid: false, errors: [] };
  if ('plan' in process && !planResult.valid) {
    for (const e of planResult.errors) push(PROCESS_ERROR_CODES.PROCESS_PLAN_INVALID, `plan.${e.path}`, `The embedded plan is invalid: ${e.code} — ${e.message}`);
  }

  const planIds = new Set(isPlainObject(process.plan) && Array.isArray(process.plan.steps) ? process.plan.steps.map((s) => s?.id) : []);
  if (!Array.isArray(process.steps)) {
    if ('steps' in process) push(PROCESS_ERROR_CODES.PROCESS_FIELD_TYPE, 'steps', '"steps" must be an array, one entry per plan step.');
  } else {
    const seen = new Set();
    process.steps.forEach((step, i) => {
      const at = `steps[${i}]`;
      if (!isPlainObject(step)) {
        push(PROCESS_ERROR_CODES.PROCESS_FIELD_TYPE, at, 'Each step status must be an object.');
        return;
      }
      seen.add(step.id);
      if (!planIds.has(step.id)) push(PROCESS_ERROR_CODES.STEP_UNKNOWN, `${at}.id`, `Step status "${step.id}" does not match any step in the embedded plan.`);
      if (!STEP_STATUSES.includes(step.status)) {
        push(PROCESS_ERROR_CODES.STEP_STATUS_INVALID, `${at}.status`, `"status" must be one of: ${STEP_STATUSES.join(', ')} (got ${JSON.stringify(step.status)}).`);
      }
      // The Vision-level rule, enforced rather than documented: a step that
      // finished states whether a model was involved. `llm: null` is a valid,
      // meaningful answer; `undefined` is not an answer at all.
      if ((step.status === 'done' || step.status === 'failed') && step.llm === undefined) {
        push(PROCESS_ERROR_CODES.STEP_LLM_UNRECORDED, `${at}.llm`, `Step "${step.id}" finished without recording whether a model was involved. Use null for "no model", not an absent field.`);
      }
    });
    for (const id of planIds) {
      if (!seen.has(id)) push(PROCESS_ERROR_CODES.STEP_MISSING, 'steps', `Plan step "${id}" has no status entry — every plan step is tracked.`);
    }
  }

  if (Array.isArray(process.log)) {
    process.log.forEach((entry, i) => {
      if (!isPlainObject(entry) || !LOG_PROVENANCE.includes(entry.provenance)) {
        push(PROCESS_ERROR_CODES.LOG_PROVENANCE_INVALID, `log[${i}].provenance`, `Every log entry needs a provenance of: ${LOG_PROVENANCE.join(', ')}.`);
        return;
      }
      if (entry.stepId != null && !planIds.has(entry.stepId)) {
        push(PROCESS_ERROR_CODES.LOG_STEP_UNKNOWN, `log[${i}].stepId`, `Log entry references unknown step "${entry.stepId}".`);
      }
    });
  } else if ('log' in process) {
    push(PROCESS_ERROR_CODES.PROCESS_FIELD_TYPE, 'log', '"log" must be an array.');
  }

  if (Array.isArray(process.artifacts)) {
    process.artifacts.forEach((a, i) => {
      const at = `artifacts[${i}]`;
      if (!isPlainObject(a)) {
        push(PROCESS_ERROR_CODES.PROCESS_FIELD_TYPE, at, 'Each artifact must be an object.');
        return;
      }
      if (!ARTIFACT_CHANGES.includes(a.change)) push(PROCESS_ERROR_CODES.ARTIFACT_CHANGE_INVALID, `${at}.change`, `"change" must be one of: ${ARTIFACT_CHANGES.join(', ')}.`);
      if (!isNonEmptyString(a.path) || isAbsolutePath(a.path)) {
        push(PROCESS_ERROR_CODES.ARTIFACT_PATH_ABSOLUTE, `${at}.path`, 'An artifact path must be a non-empty, project-relative path.');
      }
      if (a.stepId != null && !planIds.has(a.stepId)) push(PROCESS_ERROR_CODES.ARTIFACT_STEP_UNKNOWN, `${at}.stepId`, `Artifact references unknown step "${a.stepId}".`);
    });
  } else if ('artifacts' in process) {
    push(PROCESS_ERROR_CODES.PROCESS_FIELD_TYPE, 'artifacts', '"artifacts" must be an array.');
  }

  return { valid: errors.length === 0, errors };
}

/** One human-readable line per structured error, matching
 * `formatPlanErrors()`. */
export function formatProcessErrors(errors) {
  return errors.map((e) => `${e.code}${e.path ? ` at ${e.path}` : ''}: ${e.message}`);
}
