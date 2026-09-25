// `GET /api/validate`: runs the same validation `construct validate` runs
// (aggregateValidation + DEFAULT_ENFORCERS from the core) against the current
// project's root and returns the violations as data. Read-only, origin-guarded,
// and scoped to the project root found from the settings project directory
// (no path parameter, so a caller cannot point it at another directory).
import { aggregateValidation } from '../../../packages/core/registry.mjs';
import { DEFAULT_ENFORCERS } from '../../../packages/engine/defaultEnforcers.mjs';
import { findProjectRoot } from '../../../packages/core/config.mjs';
import { serverLog } from './logBuffer.mjs';
import { ExecutionError, resolveExecutionMode, runValidate } from './coreExecutor.mjs';
import { runCapturing } from './commandRunner.mjs';

export const MAX_VIOLATIONS = 500;

/** The 200 body: the same fields whichever execution mode produced the violations. */
function reportBody({ violations, ok, durationMs }) {
  return {
    ok: true,
    passed: ok,
    total: violations.length,
    truncated: violations.length > MAX_VIOLATIONS,
    durationMs,
    violations: violations.slice(0, MAX_VIOLATIONS).map((v) => ({
      rule: v.rule,
      module: v.module,
      severity: v.severity,
      file: v.file,
      line: v.line,
      message: v.message,
      why: v.why,
      suggestedFix: v.suggestedFix,
    })),
  };
}

/**
 * @param {{origin?:string, clientOrigin:string, projectDir?:string|null,
 *   validate?:Function, findRoot?:Function, log?:object, now?:()=>number}} ctx
 * @returns {{status:number, body:object}}
 */
export function handleValidate({ origin, clientOrigin, projectDir, validate = aggregateValidation, findRoot = findProjectRoot, log = serverLog, now = Date.now }) {
  if (origin && origin !== clientOrigin) return { status: 403, body: { ok: false, error: 'Origin not allowed.' } };
  const root = projectDir ? findRoot(projectDir) : null;
  if (!root) {
    return { status: 400, body: { ok: false, error: 'No Construct project found for the current project directory. Pick a project first.' } };
  }
  const started = now();
  try {
    const { violations, ok } = validate(root, DEFAULT_ENFORCERS);
    const durationMs = now() - started;
    const errors = violations.filter((v) => v.severity === 'error').length;
    log.record('validate', errors ? 'warn' : 'info', `validate: ${violations.length} violation(s), ${errors} error(s) in ${durationMs} ms`);
    return { status: 200, body: reportBody({ violations, ok, durationMs }) };
  } catch (e) {
    log.record('validate', 'error', `validate failed: ${e.message}`);
    return { status: 500, body: { ok: false, error: 'Validation could not run.' } };
  }
}

/**
 * #541: `GET /api/validate` honouring the project's `project.execution.mode`. `engine` (the default) is exactly
 * `handleValidate` above, unchanged; `cli` runs the real `construct validate --format json` as a subprocess
 * (coreExecutor.mjs) and answers with the same body plus `mode`, so a CLI failure (timeout, non-zero exit,
 * output that is not the JSON report) shows in the Cockpit as a 502 with the CLI's own words rather than as an
 * empty list. Diagnostics is a core activity; UI-helper endpoints never come through here (see coreExecutor.mjs).
 *
 * @param {object} ctx `handleValidate`'s context plus `execute?` (a runValidate stand-in), `execEnv?`, `cliBin?`, `timeoutMs?`.
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleValidateForProject(ctx) {
  const { origin, clientOrigin, projectDir, findRoot = findProjectRoot, log = serverLog, now = Date.now, execute = runValidate, execEnv, cliBin, timeoutMs } = ctx;
  if (origin && origin !== clientOrigin) return { status: 403, body: { ok: false, error: 'Origin not allowed.' } };
  const root = projectDir ? findRoot(projectDir) : null;
  if (!root) return handleValidate(ctx); // the same 400 as ever
  let mode;
  try {
    mode = resolveExecutionMode(root);
  } catch (e) {
    // an unknown project.execution.mode (or an unreadable architecture.yml) is the user's to fix: say what it is
    log.record('validate', 'error', `validate failed: ${e.message}`);
    return { status: 400, body: { ok: false, error: e.message } };
  }
  if (mode === 'engine') {
    const { status, body } = handleValidate(ctx);
    return { status, body: { ...body, mode } };
  }
  const started = now();
  // #612: the subprocess runs INSIDE the per-login queue and global concurrency cap (runCapturing), like every other
  // cli-mode verb (coreVerbs.mjs cliCommandResult), so a validate never overlaps a write to the same project.
  let outcome = null;
  const queued = await runCapturing(async () => {
    try { outcome = { result: await execute(root, { mode, env: execEnv, bin: cliBin, timeoutMs }) }; } catch (e) { outcome = { error: e }; }
  });
  if (outcome === null) {
    // abandoned at the command deadline (504): the queue moved on
    log.record('validate', 'error', `validate (via CLI) failed: ${queued.error}`);
    return { status: queued.httpStatus ?? 500, body: { ok: false, mode, error: queued.error ?? 'The command was abandoned.' } };
  }
  try {
    if (outcome.error) throw outcome.error;
    const { violations, ok } = outcome.result;
    const durationMs = now() - started;
    const errors = violations.filter((v) => v.severity === 'error').length;
    log.record('validate', errors ? 'warn' : 'info', `validate (via CLI): ${violations.length} violation(s), ${errors} error(s) in ${durationMs} ms`);
    return { status: 200, body: { ...reportBody({ violations, ok, durationMs }), mode } };
  } catch (e) {
    const message = e instanceof ExecutionError ? e.message : 'Validation could not run.';
    log.record('validate', 'error', `validate (via CLI) failed: ${message}`);
    return { status: e instanceof ExecutionError ? 502 : 500, body: { ok: false, mode, error: message } };
  }
}
