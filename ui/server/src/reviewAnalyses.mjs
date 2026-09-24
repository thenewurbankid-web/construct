// #351 -- an analysis is a Process (#287): one plan, one step, flow `review.analyze` (src/plan.mjs).
//
// What this file adds is only the glue that makes the existing pieces meet:
//   * `analysisPlan()`     the plan an analysis is: built by the SERVER from commit ids it took from its own
//                          validated branch list, never from a client string.
//   * `createReviewExecutor()`  the `executeStep` for that flow. It runs the forked read-only worker
//                          (reviewRunner.mjs) and holds the report in memory.
//   * `composeExecutors()` routes a step by its flow: `review.analyze` -> here, everything else -> the bot
//                          runner (#291), unchanged.
//   * `createAnalyses()`   starts one, reads its state back from the process record, cancels it, and keeps
//                          the drawer from filling up with old analyses.
//
// SAFETY (why this can never write, and never enters the approval gate #337):
//   * The bot runner creates a `construct/bot/<id>` branch and a worktree per process, which would mutate the
//     user's refs. An analysis therefore does NOT run through it: it runs the read-only worker, which reads
//     two commits through temporary detached worktrees and removes them again.
//   * The executor returns `artifacts: []` ALWAYS. The report is never an artifact, so `pendingApproval` is
//     0 and the gate has nothing to review, apply or refuse.
//   * The commit ids are re-checked here (40-64 hex chars) before anything is spawned, because a plan is
//     also an input the Plan screen accepts: a step must not be able to smuggle an option or a path.
import { repoInfo } from '../../../packages/engine/gitTrees.mjs';
import { StepAborted } from '../../../packages/engine/processEngine.mjs';
import { topLevelState } from '../../../packages/engine/processMachine.mjs';
import { findProjectRoot } from '../../../packages/core/config.mjs';
import { forkRunner } from './reviewRunner.mjs';
import { cliReviewRunner } from './reviewCli.mjs';
import { resolveExecutionMode } from './coreExecutor.mjs';

export const ANALYSIS_FLOW = 'review.analyze';
export const ANALYSIS_STEP = 'analyse';
/** Finished analysis records kept in the store (and so in the drawer); older ones are removed. */
export const KEEP_FINISHED = 30;
const MAX_RESULTS = 100;
const HEX_ID = /^[0-9a-f]{40,64}$/;
const short = (sha) => String(sha).slice(0, 8);

/** Is this stored plan an analysis (and so not a plan the Review screen may offer as an expected scope)? */
export function isAnalysisPlan(plan) {
  const steps = plan?.steps;
  return Array.isArray(steps) && steps.length > 0 && steps.every((s) => s?.flow === ANALYSIS_FLOW);
}

/** The plan an analysis is. `expected` is `{features, files}` or absent. */
export function analysisPlan({ baseName, headName, baseSha, headSha, expected }) {
  const scope = expected && ((expected.features?.length ?? 0) + (expected.files?.length ?? 0) > 0) ? { features: [...expected.features], files: [...expected.files] } : null;
  return {
    version: 1,
    ticket: { source: 'text', title: `Review ${headName} against ${baseName}` },
    steps: [{
      id: ANALYSIS_STEP,
      title: `Analyse ${headName} (${short(headSha)}) against ${baseName} (${short(baseSha)})`,
      flow: ANALYSIS_FLOW,
      executor: 'deterministic',
      args: { base: baseSha, head: headSha, ...(scope ? { plan: scope } : {}) },
    }],
  };
}

/** Finished analyses' reports, by process id, bounded. Never persisted: a report is derived, so a restart
 * simply asks again. */
export function createResults() {
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

/** The execution mode of the project an analysis belongs to (`project.execution.mode`, #541); 'engine' when the
 * folder has no architecture.yml. Throws the config's own error for an unknown value. */
export function projectModeOf(projectRoot) {
  const root = findProjectRoot(projectRoot);
  return root ? resolveExecutionMode(root) : 'engine';
}

/**
 * @param {{run?: Function, runCli?: Function, modeOf?: (projectRoot:string)=>string, results?: ReturnType<typeof createResults>, runOptions?: object}} [opts]
 *   `run(job, {signal, onProgress})` is the test seam; the default forks the read-only worker. In a project whose
 *   `project.execution.mode` is `cli` the same job goes to `runCli` instead (default: the real `construct review`
 *   subprocess, reviewCli.mjs); `modeOf` reads the mode (default: architecture.yml).
 */
export function createReviewExecutor({ run = forkRunner, runCli = cliReviewRunner, modeOf = projectModeOf, results = createResults(), runOptions = {} } = {}) {
  async function executeStep({ process: proc, step, signal, log }) {
    const none = { ok: false, llm: null, artifacts: [] };
    if (step.flow !== ANALYSIS_FLOW) return { ...none, error: `Step "${step.id}" is not an analysis.` };
    const { base, head, plan } = step.args ?? {};
    if (typeof base !== 'string' || typeof head !== 'string' || !HEX_ID.test(base) || !HEX_ID.test(head)) {
      return { ...none, error: `Step "${step.id}" must name its two commits by full commit id; refusing to read anything else.` };
    }
    const info = repoInfo(proc.projectRoot);
    if (!info.ok) return { ...none, error: info.error.message };
    const job = { root: info.top, baseSha: base, headSha: head, ...(plan ? { expected: { features: plan.features ?? [], files: plan.files ?? [] } } : {}) };
    let mode;
    try {
      mode = modeOf(proc.projectRoot);
    } catch (e) {
      return { ...none, error: String(e?.message || e) };
    }
    log('ok', `Reading ${short(base)} and ${short(head)} in temporary checkouts${mode === 'cli' ? ' (through the construct CLI, project.execution.mode: cli)' : ''}. Read-only: the working tree, branches and stash are not touched.`);
    let outcome;
    try {
      outcome = await (mode === 'cli' ? runCli : run)(job, { ...runOptions, signal, onProgress: (m) => { log('ok', String(m.progress)); runOptions.onProgress?.(m); } });
    } catch (e) {
      outcome = { ok: false, error: { code: 'WORKER_FAILED', message: String(e?.message || e) } };
    }
    if (signal.aborted || outcome?.error?.code === 'CANCELLED') throw new StepAborted(step.id);
    results.set(proc.id, outcome);
    if (!outcome?.ok) return { ...none, error: outcome?.error?.message ?? 'The analysis produced no result.' };
    log('ok', `Done: ${outcome.report.change.counts.files} file(s) changed, ${outcome.report.findings.length} finding(s).`);
    return { ok: true, llm: null, artifacts: [] };
  }
  return { executeStep, results };
}

/** Route a step by its flow. Only the read-only flows avoid the bot runner: `review.analyze` (#351) and `test.run`
 * (#305). A `test.run` step with no test executor is refused rather than handed to the bot runner, which would give
 * it a branch and a worktree it has no use for. */
export function composeExecutors({ bot, review, testRun = null }) {
  return (ctx) => {
    if (ctx.step.flow === ANALYSIS_FLOW) return review(ctx);
    if (ctx.step.flow === 'test.run') return testRun ? testRun(ctx) : Promise.resolve({ ok: false, llm: null, artifacts: [], error: 'Running tests is not available in this server.' });
    return bot(ctx);
  };
}

/**
 * @param {{service: {startPlan: Function, store: Function, control: Function}, results: ReturnType<typeof createResults>}} deps
 */
export function createAnalyses({ service, results }) {
  const load = (id) => { try { return service.store()?.load(id) ?? null; } catch { return null; } };

  /** Keep the newest KEEP_FINISHED finished analyses; remove the rest (record + report). */
  function prune() {
    const store = service.store();
    if (!store) return;
    const finished = store.all().processes
      .filter((p) => isAnalysisPlan(p.plan) && ['done', 'failed', 'cancelled'].includes(topLevelState(p.state)))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    for (const old of finished.slice(KEEP_FINISHED)) {
      try { store.remove(old.id); results.delete(old.id); } catch { /* best effort */ }
    }
  }

  return {
    /** Create and start the process. -> {ok:true, processId} | {ok:false, error} */
    start(spec) {
      prune();
      const started = service.startPlan(analysisPlan(spec));
      return started.ok ? { ok: true, processId: started.processId } : { ok: false, error: started.error };
    },
    /** The analysis's row state, read from the process record (the single source of truth). */
    stateOf(processId) {
      const record = load(processId);
      if (!record) return { state: 'none' };
      const top = topLevelState(record.state);
      const stepStatus = record.steps[0]?.status;
      const base = { processId };
      if (top === 'done') {
        const r = results.get(processId);
        return r?.ok ? { ...base, state: 'done', result: r } : { ...base, state: 'none' };
      }
      if (top === 'failed') {
        const r = results.get(processId);
        return { ...base, state: 'error', error: r?.error ?? { code: 'WORKER_FAILED', message: record.steps[0]?.error ?? 'The analysis failed.' } };
      }
      if (top === 'cancelled') return { ...base, state: 'cancelled' };
      if (top === 'paused') return { ...base, state: 'paused' };
      return { ...base, state: top === 'running' && stepStatus === 'running' ? 'running' : 'queued' };
    },
    /** The machine's own CANCEL, through the same service the drawer's button uses. */
    cancel: (processId) => service.control(processId, 'cancel'),
  };
}
