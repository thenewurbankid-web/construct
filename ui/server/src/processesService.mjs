// #292 — the Cockpit's window onto the process runtime (#287, #291).
//
// This file adds no business logic. Which controls are legal is the state
// machine's answer (`processSummary().controls`); this only asks it. What a
// process is, where it lives and how it is driven are core's
// (src/engine/*.mjs). The service opens the store for the current project,
// keeps one engine per project so pause/resume/cancel/retry act on the real
// running work, and republishes every persisted change to whoever listens
// (the WebSocket, see processesSocket.mjs).
//
// SECURITY: a process id from a client is only ever compared against the ids
// the store itself lists. It is never joined into a path, never given to a
// shell. The one place a path from a client matters (the artifact diff) is
// matched against the paths recorded on the process, the same way.
import { spawnSync } from 'node:child_process';
import { findProjectRoot } from '../../../src/config.mjs';
import { openProcessStore, resolveStateDir } from '../../../src/engine/processStore.mjs';
import { processSummary } from '../../../src/engine/processModel.mjs';
import { createProcessEngine } from '../../../src/engine/processEngine.mjs';
import { createBotRunner, botBranch } from '../../../src/engine/botRunner.mjs';
import { createApprovalGate, GATE_CODES } from '../../../src/engine/approvalGate.mjs';

/** The UI verbs and the machine event each one sends. The client may only
 * name a verb; whether it is legal now is decided by the machine. */
export const CONTROL_EVENTS = Object.freeze({
  pause: 'PAUSE',
  resume: 'RESUME',
  cancel: 'CANCEL',
  retry: 'RETRY',
});

/** How many log lines a view carries. The record keeps up to 2000; a drawer
 * that repaints on every change does not need to ship all of them each time. */
export const LOG_TAIL = 500;

/** `processSummary()` plus a version that only ever grows (the record's log sequence, which every state
 * change advances). Responses and socket frames can reach a client out of order; the version lets it keep
 * the newest instead of whichever arrived last. */
export function versionedSummary(record) {
  return { ...processSummary(record), version: record.logSeq };
}

/** A process as the drawer's detail view shows it: the summary (with the
 * machine's own `controls`), every step, the artifacts as read-only records
 * and the tail of the log. The plan itself and the raw record stay home. */
export function processView(record) {
  const dropped = Math.max(0, record.log.length - LOG_TAIL);
  return {
    summary: versionedSummary(record),
    steps: record.steps.map((s) => ({
      id: s.id,
      title: s.title,
      flow: s.flow,
      executor: s.executor,
      status: s.status,
      attempts: s.attempts,
      durationMs: s.durationMs,
      llm: s.llm,
      error: s.error,
    })),
    artifacts: record.artifacts.map((a) => ({
      path: a.path, change: a.change, stepId: a.stepId, approved: a.approved, before: a.before, after: a.after,
    })),
    log: record.log.slice(dropped),
    logHidden: record.logDropped + dropped,
  };
}

function runGit(cwd, args) {
  // --literal-pathspecs: the artifact path reaches git after `--`, and it must be a path, never a
  // pathspec pattern (`:(glob)`, `:(top)`), exactly as the approval gate (#337) does.
  const res = spawnSync('git', ['--literal-pathspecs', ...args], { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return { ok: res.status === 0, out: res.stdout ?? '', err: (res.stderr || res.error?.message || '').trim() };
}

/**
 * @param {object} options
 * @param {() => string} options.getProjectDir the project directory the Cockpit is pointed at right now
 * @param {string} [options.stateDir]
 * @param {(ctx: any) => Promise<any>} [options.executeStep] defaults to the real bot runner (#291)
 */
export function createProcessesService({ getProjectDir, stateDir = resolveStateDir(), executeStep = null } = {}) {
  /** project root -> { store, engine, root } */
  const projects = new Map();
  const listeners = new Set();
  let executor = executeStep;
  let runner = null;

  const emit = (record) => {
    for (const fn of listeners) {
      try { fn(record); } catch { /* one bad listener must not stop the engine */ }
    }
  };

  const engineOptions = () => {
    if (executor) return { executeStep: executor };
    runner ||= createBotRunner({ stateDir });
    return { executeStep: runner.executeStep, maxConcurrent: runner.maxConcurrent };
  };

  function open() {
    const dir = getProjectDir();
    const root = dir ? findProjectRoot(dir) || dir : null;
    if (!root) return null;
    let entry = projects.get(root);
    if (!entry) {
      const store = openProcessStore(root, { stateDir });
      // A record left `running` by a server that was killed is not running;
      // pause it so it can be resumed. Once per project per server start.
      store.adoptInterrupted();
      const engine = createProcessEngine({ store, ...engineOptions(), onChange: emit });
      // The approval gate (#337) is the only writer of a bot's output into the tree; the service
      // only hands it what the router derived (see decide() below).
      const gate = createApprovalGate({ store, runner });
      entry = { store, engine, root, gate };
      projects.set(root, entry);
    }
    return entry;
  }

  /** The record for `id`, matched against what the store lists. */
  function find(entry, id) {
    if (typeof id !== 'string') return null;
    return entry.store.all().processes.find((p) => p.id === id) ?? null;
  }

  return {
    /** Swap the executor (tests and the e2e harness). Applies to projects opened afterwards. */
    setExecutor(fn) { executor = fn; projects.clear(); },
    currentRoot: () => open()?.root ?? null,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** The engine for the current project, for a harness that has to start work. */
    engine: () => open()?.engine ?? null,
    store: () => open()?.store ?? null,
    /** Does `record` belong to the project the Cockpit is looking at? */
    isCurrent(record) { return open()?.root === record.projectRoot; },

    list() {
      const entry = open();
      if (!entry) return { projectRoot: null, processes: [], problems: [] };
      const { processes: records, problems } = entry.store.all();
      return { projectRoot: entry.root, processes: records.map(versionedSummary), problems: problems.map((p) => ({ id: p.id, reason: p.reason })) };
    },

    /** -> { status, body } */
    detail(id) {
      const entry = open();
      const record = entry && find(entry, id);
      if (!record) return { status: 404, body: { ok: false, error: 'No such process.' } };
      return { status: 200, body: { ok: true, process: processView(record) } };
    },

    control(id, verb) {
      const event = Object.hasOwn(CONTROL_EVENTS, verb) ? CONTROL_EVENTS[verb] : null;
      if (!event) return { status: 400, body: { ok: false, error: `Unknown control "${String(verb).slice(0, 40)}". Expected one of: ${Object.keys(CONTROL_EVENTS).join(', ')}.` } };
      const entry = open();
      const record = entry && find(entry, id);
      if (!record) return { status: 404, body: { ok: false, error: 'No such process.' } };
      // The machine decides. This check happens BEFORE the engine is asked,
      // because `engine.retry()` prepares the record before it consults the
      // machine, so an illegal retry must never reach it.
      const { controls } = processSummary(record);
      if (!controls.includes(event)) {
        return { status: 409, body: { ok: false, error: `A process in "${record.state}" does not accept ${verb}.`, controls } };
      }
      const result = entry.engine[verb](record.id);
      if (!result.accepted) return { status: 409, body: { ok: false, error: result.error?.message || 'Refused.', controls } };
      return { status: 200, body: { ok: true, process: processView(entry.store.load(record.id)) } };
    },

    /** #341 — the gate's read-only review of one process: per artifact the exact diff, its sha256, the
     * refusals and whether it is `applicable`. -> { status, body } */
    review(id) {
      const entry = open();
      const record = entry && find(entry, id);
      if (!record) return { status: 404, body: { ok: false, error: 'No such process.' } };
      const review = entry.gate.review(record.id);
      if (!review.ok) return { status: 409, body: { ok: false, error: review.error.message, code: review.error.code } };
      return { status: 200, body: review };
    },

    /** #341 — ONE decision on ONE artifact. `by` is an argument the ROUTER derives from the signed session;
     * nothing in the request body can reach it. `diffSha256` is passed through exactly as the client echoed
     * it; it is never computed or defaulted here, so the gate compares it with the diff it re-derives.
     * -> { status, body } */
    decide(id, { by, path, verdict, diffSha256 }) {
      const entry = open();
      const record = entry && find(entry, id);
      if (!record) return { status: 404, body: { ok: false, error: 'No such process.' } };
      const decision = { path, verdict };
      if (diffSha256 !== undefined) decision.diffSha256 = diffSha256;
      const result = entry.gate.decide(record.id, { by, decisions: [decision] });
      if (!result.ok) {
        const status = result.error.code === GATE_CODES.PROCESS_NOT_FOUND ? 404 : result.error.code === GATE_CODES.PROCESS_ACTIVE ? 409 : 400;
        return { status, body: { ok: false, error: result.error.message, code: result.error.code } };
      }
      // The gate saves the record directly, not through the engine, so tell the socket.
      const fresh = entry.store.load(record.id);
      if (fresh) emit(fresh);
      const outcome = result.results[0];
      const body = { ok: true, ...result, decided: outcome.decided, refusals: outcome.refusals };
      return { status: outcome.decided ? 200 : 409, body: outcome.decided ? body : { ...body, ok: false, error: outcome.refusals[0]?.message || 'Refused.' } };
    },

    /** The unified diff of one recorded artifact, read from the bot's branch.
     * `filePath` must equal a path recorded on the process; the branch name
     * is derived from the id the store returned, not the client's string. */
    artifactDiff(id, filePath) {
      const entry = open();
      const record = entry && find(entry, id);
      if (!record) return { status: 404, body: { ok: false, error: 'No such process.' } };
      const artifact = record.artifacts.find((a) => a.path === filePath);
      if (!artifact) return { status: 404, body: { ok: false, error: 'That file is not one of this process\'s artifacts.' } };
      const branch = botBranch(record.id);
      const exists = runGit(entry.root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      if (!exists.ok) return { status: 200, body: { ok: true, diff: null, reason: 'The bot\'s branch is gone, so there is no diff to show.' } };
      const diff = runGit(entry.root, ['diff', '--no-color', `HEAD...refs/heads/${branch}`, '--', artifact.path]);
      if (!diff.ok) return { status: 200, body: { ok: true, diff: null, reason: diff.err || 'git could not produce a diff.' } };
      return { status: 200, body: { ok: true, diff: diff.out.slice(0, 200_000), truncated: diff.out.length > 200_000 } };
    },
  };
}
