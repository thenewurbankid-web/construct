// #305 -- running a feature's tests is a Process (#287): one plan, one step, flow `test.run` (src/plan.mjs), exactly like
// a Review-mode analysis (reviewAnalyses.mjs, #351). It is in the Processes drawer, queued behind the engine's slot and
// cancellable with the machine's own controls.
//
//   * `testRunPlan()`         the plan a run is: built by the SERVER from values it validated itself, never from a
//                             client string.
//   * `createTestRunExecutor()` the `executeStep` for that flow. It runs the forked worker (testRunWorker.mjs), holds
//                             the outcome in memory and returns `artifacts: []` ALWAYS: the bot runner (a branch and a
//                             worktree per process) is never involved and nothing reaches the approval gate (#337).
//   * `createTestRuns()`      starts one, reads its state back from the process record, cancels it, prunes old ones.
//   * `createTestRunJobs()`   which runs belong to which feature, the live one, and the latest result per test file.
//
// Nothing here writes to the project: Playwright runs with a throwaway config in a temp directory (testRunner.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StepAborted } from '../../../src/engine/processEngine.mjs';
import { topLevelState } from '../../../src/engine/processMachine.mjs';
import { parseBaseUrl, reclaimRunsOf, resolveSpecs } from '../../../src/engine/testRunner.mjs';
import { forkRunner, JOB_TIMEOUT_MS } from './reviewRunner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEST_RUN_WORKER = path.join(HERE, 'testRunWorker.mjs');
export const TEST_RUN_FLOW = 'test.run';
export const TEST_RUN_STEP = 'run';
/** Finished run records kept in the store (and so in the drawer); older ones are removed. */
export const KEEP_FINISHED_RUNS = 30;
const MAX_RESULTS = 100;
const KEEP_PER_FEATURE = 20;
const FEATURE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.spec\.ts$/;

const noRun = (message) => ({ ok: false, llm: null, artifacts: [], error: message });

/** Is this stored plan a test run (and so not a plan Review mode may offer as an expected scope)? */
export function isTestRunPlan(plan) {
  const steps = plan?.steps;
  return Array.isArray(steps) && steps.length > 0 && steps.every((s) => s?.flow === TEST_RUN_FLOW);
}

/** The plan a run is. `origin` is an already-validated app origin; `name`/`area` are an already-validated test. */
export function testRunPlan({ feature, name, area, origin }) {
  const one = name && area ? { name, area } : null;
  return {
    version: 1,
    ticket: { source: 'text', title: one ? `Run ${one.name} of ${feature}` : `Run every test of ${feature}` },
    steps: [{
      id: TEST_RUN_STEP,
      title: one ? `Run ${one.name} (${one.area}) of ${feature} against ${origin}` : `Run every test of ${feature} against ${origin}`,
      flow: TEST_RUN_FLOW,
      executor: 'deterministic',
      args: { feature, ...(one ? { name: one.name, area: one.area } : {}), 'base-url': origin },
    }],
  };
}

/** Finished runs' outcomes, by process id, bounded. Never persisted: a run is derived, so a restart simply runs again. */
export function createRunResults() {
  const map = new Map();
  return {
    get: (id) => map.get(id),
    set(id, value) {
      map.delete(id);
      map.set(id, value);
      while (map.size > MAX_RESULTS) map.delete(map.keys().next().value);
    },
    delete: (id) => map.delete(id),
  };
}

/** Default runner: the forked worker. The run's own debris (temp dir, a stray Playwright) is reclaimed by pid. */
export const forkTestRun = (job, options = {}) => forkRunner(job, { timeoutMs: JOB_TIMEOUT_MS, worker: TEST_RUN_WORKER, reclaim: (pid) => reclaimRunsOf(pid), what: 'test run', ...options });

/**
 * @param {{run?: Function, results?: ReturnType<typeof createRunResults>, runOptions?: object}} [opts]
 *   `run(job, {signal, onProgress})` is the test seam; the default forks the worker.
 */
export function createTestRunExecutor({ run = forkTestRun, results = createRunResults(), runOptions = {} } = {}) {
  async function executeStep({ process: proc, step, signal, log }) {
    if (step.flow !== TEST_RUN_FLOW) return noRun(`Step "${step.id}" is not a test run.`);
    const { feature, name, area, 'base-url': baseUrl } = step.args ?? {};
    // A plan is also an input the Plan screen accepts: re-check everything before anything is spawned.
    if (typeof feature !== 'string' || !FEATURE.test(feature)) return noRun(`Step "${step.id}" must name a feature; refusing to run anything else.`);
    if ((name === undefined) !== (area === undefined)) return noRun(`Step "${step.id}": naming one test needs its file name and its area together.`);
    if (name !== undefined && (typeof name !== 'string' || !NAME.test(name) || (area !== 'generated' && area !== 'yours'))) return noRun(`Step "${step.id}": that is not a test file name.`);
    const address = parseBaseUrl(baseUrl);
    if (!address.ok) return noRun(address.error.message);
    const found = resolveSpecs(proc.projectRoot, feature, { name, area });
    if (!found.ok) return noRun(found.error.message);
    const job = { root: proc.projectRoot, feature, ...(name ? { name, area } : {}), baseUrl: address.origin };
    log('ok', `Running ${found.specs.length} test file${found.specs.length === 1 ? '' : 's'} of ${feature} against ${address.origin}. Read-only: nothing in the project is written.`);
    let outcome;
    try {
      outcome = await run(job, { ...runOptions, signal, onProgress: (m) => { log('ok', String(m.progress)); runOptions.onProgress?.(m); } });
    } catch (e) {
      outcome = { ok: false, error: { code: 'WORKER_FAILED', message: String(e?.message || e) } };
    }
    if (signal.aborted || outcome?.error?.code === 'CANCELLED') throw new StepAborted(step.id);
    results.set(proc.id, { ...outcome, target: name ? { name, area } : null });
    if (!outcome?.ok) return noRun(outcome?.error?.message ?? 'The run produced no result.');
    const c = outcome.counts;
    for (const t of outcome.tests) {
      if (t.status === 'failed') log('warn', `${t.title}: ${t.failure?.kind === 'convention' ? 'harness problem, not a product bug' : t.failure?.kind === 'app' ? t.failure.summary : 'could not finish'}`);
    }
    log(c.failed ? 'warn' : 'ok', `Done: ${c.passed} passed, ${c.failed} failed, ${c.notRun} not run.`);
    // A failing test is a RESULT, not a failure of the process: the process ran and reported.
    return { ok: true, llm: null, artifacts: [] };
  }
  return { executeStep, results };
}

/** @param {{service: {startPlan: Function, store: Function, control: Function}, results: ReturnType<typeof createRunResults>}} deps */
export function createTestRuns({ service, results }) {
  const load = (id) => { try { return service.store()?.load(id) ?? null; } catch { return null; } };

  function prune() {
    const store = service.store();
    if (!store) return;
    const finished = store.all().processes
      .filter((p) => isTestRunPlan(p.plan) && ['done', 'failed', 'cancelled'].includes(topLevelState(p.state)))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    for (const old of finished.slice(KEEP_FINISHED_RUNS)) {
      try { store.remove(old.id); results.delete(old.id); } catch { /* best effort */ }
    }
  }

  return {
    start(spec) {
      prune();
      const started = service.startPlan(testRunPlan(spec));
      return started.ok ? { ok: true, processId: started.processId } : { ok: false, error: started.error };
    },
    /** A run's state, read from the process record (the single source of truth). */
    stateOf(processId) {
      const record = load(processId);
      if (!record) return { state: 'none' };
      const top = topLevelState(record.state);
      const base = { processId };
      if (top === 'done') {
        const r = results.get(processId);
        return r?.ok ? { ...base, state: 'done', result: r } : { ...base, state: 'none' };
      }
      if (top === 'failed') {
        const r = results.get(processId);
        return { ...base, state: 'error', error: r?.error ?? { code: 'RUN_FAILED', message: record.steps[0]?.error ?? 'The run failed.' } };
      }
      if (top === 'cancelled') return { ...base, state: 'cancelled' };
      if (top === 'paused') return { ...base, state: 'paused' };
      return { ...base, state: top === 'running' && record.steps[0]?.status === 'running' ? 'running' : 'queued' };
    },
    cancel: (processId) => service.control(processId, 'cancel'),
  };
}

/** Which runs belong to which feature: the one that is live, the newest problem and the latest outcome of every file. */
export function createTestRunJobs({ runs }) {
  const byFeature = new Map(); // `${root}\0${feature}` -> [{processId, target}] oldest first
  const LIVE = new Set(['queued', 'running', 'paused']);
  const keyOf = (root, feature) => `${root}\0${feature}`;
  const entries = (root, feature) => byFeature.get(keyOf(root, feature)) ?? [];
  const withState = (root, feature) => entries(root, feature).map((e) => ({ ...e, ...runs.stateOf(e.processId) }));

  return {
    /** Start a run unless this feature already has a live one. -> {started:true, processId} | {started:false, live} | {started:false, error} */
    enqueue(root, feature, target, origin) {
      const live = this.live(root, feature);
      if (live) return { started: false, live };
      const s = runs.start({ feature, ...(target ?? {}), origin });
      if (!s.ok) return { started: false, error: s.error };
      const list = entries(root, feature).slice(-(KEEP_PER_FEATURE - 1));
      list.push({ processId: s.processId, target: target ?? null });
      byFeature.set(keyOf(root, feature), list);
      return { started: true, processId: s.processId };
    },
    /** The feature's queued/running run, or null. */
    live(root, feature) {
      const e = withState(root, feature).reverse().find((x) => LIVE.has(x.state));
      return e ? { state: e.state, processId: e.processId, target: e.target } : null;
    },
    /** The newest run that did not produce a result (a refusal, a failure or a cancel), unless a newer one finished. */
    problem(root, feature) {
      const newest = withState(root, feature).reverse().find((x) => !LIVE.has(x.state) && x.state !== 'none');
      if (!newest || newest.state === 'done') return null;
      return { state: newest.state, target: newest.target, code: newest.error?.code ?? (newest.state === 'cancelled' ? 'CANCELLED' : 'RUN_FAILED'), message: newest.error?.message ?? (newest.state === 'cancelled' ? 'The run was cancelled.' : 'The run failed.') };
    },
    /** Latest outcome per test file across the feature's finished runs (newest wins) and the run it came from. */
    last(root, feature) {
      const seen = new Map();
      let lastRun = null;
      for (const e of withState(root, feature)) {
        if (e.state !== 'done') continue;
        lastRun = { baseUrl: e.result.baseUrl, durationMs: e.result.durationMs, counts: e.result.counts, target: e.target, processId: e.processId };
        for (const t of e.result.tests) seen.set(`${t.area}/${t.file}/${t.title}`, t);
      }
      return { tests: [...seen.values()], lastRun };
    },
    /** Cancel the feature's live run with the machine's own CANCEL. -> {status, body} | null when none is live. */
    cancel(root, feature) {
      const live = this.live(root, feature);
      return live ? runs.cancel(live.processId) : null;
    },
    pending() {
      let n = 0;
      for (const [k] of byFeature) { const [root, feature] = k.split('\0'); if (this.live(root, feature)) n += 1; }
      return n;
    },
  };
}
