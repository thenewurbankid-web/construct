// #541 -- `POST /api/research` (the Cockpit's read-only "research" actions: summarize and doctor) honouring the
// project's `project.execution.mode`. The route in index.mjs is a thin call into handleResearch.
//
//   engine (default)  the in-process path exactly as before: `research(...)` through runCapturing.
//   cli               the real `construct summarize|doctor --format json` as a subprocess (coreVerbs.mjs), parsed
//                     as JSON, and answered in the same `{ok, output, attribution, ...}` shape plus `mode`.
//
// Requests the CLI has no `--format json` contract for (summarize's md/compact/prose views and `since`) stay
// in-process in both modes and say so in the body (`mode: 'engine'`, `note`). The project root the subprocess
// gets is the server's own derived, contained root (`findRoot`), never a client path.
import { READ_ONLY_ATTRIBUTION, renderDoctorText } from '../../../packages/core/cli.mjs';
import { containedProjectRoot } from './projectGuard.mjs';
import { resolveExecutionMode } from './coreExecutor.mjs';
import { runSummarize, runDoctor, summarizeHasJsonContract, cliCommandResult } from './coreVerbs.mjs';

export const NO_JSON_CONTRACT_NOTE = 'This view has no --format json contract in the CLI, so it ran in-process even though the project asks for cli mode.';

/**
 * The execution mode and the contained root for the open project.
 *
 * @param {string|null} projectDir The open project's directory (settings), or null.
 * @param {(dir:string)=>string|null} [findRoot] Derives the contained project root (default: projectGuard's).
 * @returns {{mode:'engine'|'cli', root:string|null, error?:string}} `error` is set (and `mode` is 'engine') when
 *   architecture.yml is unreadable or names an unknown mode: the user's to fix, so the route answers 400.
 */
export function executionFor(projectDir, findRoot = containedProjectRoot) {
  const root = projectDir ? findRoot(projectDir) : null;
  if (!root) return { mode: 'engine', root: null };
  try {
    return { mode: resolveExecutionMode(root), root };
  } catch (e) {
    return { mode: 'engine', root, error: e.message };
  }
}

/**
 * Handle one `/api/research` request.
 *
 * @param {{body?:object, projectDir:string|null, findRoot?:Function, inProcess:(args:string[])=>Promise<object>, cli?:object}} ctx
 *   `inProcess(args)` runs the in-process path and returns runCapturing's result; `cli` passes `env`, `bin`,
 *   `timeoutMs` or `spawnImpl` to the executor (tests).
 * @returns {Promise<{status:number, body:object}>} The HTTP status and JSON body.
 */
export async function handleResearch({ body, projectDir, findRoot, inProcess, cli = {} }) {
  const { action, feature, format, since } = body || {};
  let args;
  if (action === 'summarize') {
    args = ['summarize'];
    if (feature) args.push('--feature', feature);
    if (format) args.push('--format', format);
    if (since) args.push('--since', since);
  } else if (action === 'doctor') {
    args = ['doctor'];
  } else {
    return { status: 400, body: { ok: false, error: 'action must be "summarize" or "doctor"' } };
  }
  const exec = executionFor(projectDir, findRoot);
  if (exec.error) return { status: 400, body: { ok: false, error: exec.error } };
  const inProc = async (note) => {
    const result = await inProcess(args);
    return { status: result.httpStatus, body: { ...result, mode: 'engine', ...(note ? { note } : {}) } };
  };
  if (exec.mode !== 'cli') return inProc();
  if (action === 'summarize') {
    if (!summarizeHasJsonContract({ format, since })) return inProc(NO_JSON_CONTRACT_NOTE);
    const result = await cliCommandResult(() => runSummarize(exec.root, { mode: 'cli', feature: feature || undefined, ...cli }), { attribution: READ_ONLY_ATTRIBUTION });
    return { status: result.httpStatus, body: result };
  }
  const result = await cliCommandResult(() => runDoctor(exec.root, { mode: 'cli', ...cli }), { lines: (r) => renderDoctorText(r.doc), attribution: READ_ONLY_ATTRIBUTION });
  return { status: result.httpStatus, body: result };
}
