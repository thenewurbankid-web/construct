// #541 -- `POST /api/create`, `/api/refactor` and `/api/import` honouring the project's `project.execution.mode`
// (the routes in index.mjs are thin calls into these handlers; research is researchApi.mjs).
//
//   engine (default)  the in-process path exactly as before: the cli.mjs function through runCapturing.
//   cli               the real `construct create|refactor|import ... --format json` as a subprocess (coreVerbs.mjs),
//                     answered in the same `{ok, output, attribution, ...}` shape plus `mode`.
//
// A request that asks for a MODEL call (create's and import's "have the LLM write it" options, an explicit `llm`)
// always runs in-process, and the body says so (`mode: 'engine'`, `note`): the provider keys live in the Cockpit
// server, the subprocess gets an allow-listed environment, and an LLM fill has no byte-identical contract. The
// argument checks, the workspace containment of `from` / `planPath`, and the project root the subprocess gets
// (the server's own derived, contained root) are the same in both modes: nothing of the client's reaches the
// subprocess except validated request fields.
import { renderCreateText, renderRefactorText, renderImportText } from '../../../packages/core/cli.mjs';
import { executionFor } from './researchApi.mjs';
import { runCreate, runRefactor, runImport, createArgv, refactorArgv, importArgv, cliCommandResult } from './coreVerbs.mjs';

export const LLM_IN_PROCESS_NOTE = 'A model call runs in the Cockpit server (it holds the provider keys), so this request ran in-process even though the project asks for cli mode.';

/** Shared routing: refuse a bad request, read the mode, then serve in-process or through the CLI. */
async function serve({ argv, projectDir, findRoot, inProcess, viaCli, cliOnly = true, note }) {
  const exec = executionFor(projectDir, findRoot);
  if (exec.error) return { status: 400, body: { ok: false, error: exec.error } };
  if (exec.mode === 'cli' && cliOnly) {
    const result = await viaCli(exec.root);
    return { status: result.httpStatus, body: result };
  }
  const result = await inProcess(argv);
  return { status: result.httpStatus, body: { ...result, mode: 'engine', ...(exec.mode === 'cli' && note ? { note } : {}) } };
}

/**
 * Handle one `/api/create` request.
 *
 * @param {{body?:object, projectDir:string|null, findRoot?:Function, inProcess:(argv:string[])=>Promise<object>, llmProvider?:()=>string, cli?:object}} ctx
 *   `inProcess(argv)` runs the in-process path (runCapturing) and returns its result; `llmProvider()` names the
 *   provider Settings picked for create's fill; `cli` passes `env`, `bin`, `timeoutMs`, `spawnImpl` to the executor.
 * @returns {Promise<{status:number, body:object}>} The HTTP status and JSON body.
 */
export async function handleCreate({ body, projectDir, findRoot, inProcess, llmProvider = () => 'claude', cli = {} }) {
  const b = body || {};
  const a = createArgv(b);
  if (a.error) return { status: 400, body: { ok: false, error: a.error } };
  // LLM use is opt-in PER RUN (#109); "a feature" has no fillable body, so it never applies.
  const wantsLlm = b.useLlm === true && b.kind !== 'feature';
  const argv = wantsLlm ? [...a.argv, '--llm', llmProvider()] : a.argv;
  return serve({
    argv, projectDir, findRoot, inProcess, cliOnly: !wantsLlm, note: LLM_IN_PROCESS_NOTE,
    viaCli: (root) => cliCommandResult(() => runCreate(root, b, { mode: 'cli', ...cli }), { lines: (r) => renderCreateText(r.doc), attribution: (r) => r.doc.attribution ?? null }),
  });
}

/**
 * Handle one `/api/refactor` request.
 *
 * @param {{body?:object, projectDir:string|null, findRoot?:Function, inProcess:(argv:string[])=>Promise<object>, cli?:object}} ctx As `handleCreate`.
 * @returns {Promise<{status:number, body:object}>} The HTTP status and JSON body.
 */
export async function handleRefactor({ body, projectDir, findRoot, inProcess, cli = {} }) {
  const b = body || {};
  const a = refactorArgv(b);
  if (a.error) return { status: 400, body: { ok: false, error: a.error } };
  return serve({
    argv: a.argv, projectDir, findRoot, inProcess,
    viaCli: (root) => cliCommandResult(() => runRefactor(root, b, { mode: 'cli', ...cli }), { lines: (r) => renderRefactorText(r.doc), attribution: (r) => r.doc.attribution ?? null }),
  });
}

/**
 * Handle one `/api/import` request.
 *
 * @param {{body?:object, projectDir:string|null, findRoot?:Function, inProcess:(argv:string[])=>Promise<object>, resolveRead:(value:string)=>string, mapError:(e:Error)=>{status:number, body:object}, llmProvider?:()=>string|undefined, cli?:object}} ctx
 *   As `handleCreate`, plus `resolveRead` (workspace containment for `from` and `planPath`; may throw) and `mapError`
 *   (turns what it throws into a status and body); `llmProvider()` is the provider Settings picked for import's fill.
 * @returns {Promise<{status:number, body:object}>} The HTTP status and JSON body.
 */
export async function handleImport({ body, projectDir, findRoot, inProcess, resolveRead, mapError, llmProvider = () => undefined, cli = {} }) {
  const b = body || {};
  const missing = importArgv(b);
  if (missing.error) return { status: 400, body: { ok: false, error: missing.error } };
  // `from` and `planPath` are files the server will READ: contained BEFORE anything runs, in both modes, and the
  // contained absolute path is what the subprocess is given (never the client's string).
  let params;
  try {
    params = { ...b, ...(b.mode === 'unit' ? { from: resolveRead(b.from) } : { planPath: resolveRead(b.planPath) }) };
  } catch (e) {
    return mapError(e);
  }
  // An explicit `llm` provider name (direct API use) still wins; the UI sends `useLlm: true` instead.
  const llm = b.llm || (b.useLlm === true ? llmProvider() : undefined);
  const argv = llm ? [...importArgv(params).argv, '--llm', llm] : importArgv(params).argv;
  return serve({
    argv, projectDir, findRoot, inProcess, cliOnly: !llm, note: LLM_IN_PROCESS_NOTE,
    viaCli: (root) => cliCommandResult(() => runImport(root, params, { mode: 'cli', ...cli }), { lines: (r) => renderImportText(r.doc), attribution: (r) => r.doc.attribution ?? null }),
  });
}
