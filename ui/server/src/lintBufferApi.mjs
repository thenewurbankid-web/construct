// #550: `POST /api/lint-buffer` -- buffer-scope rule diagnostics for one unsaved editor
// buffer (the core's lintBuffer, packages/core/lint-buffer.mjs; see its header for
// exactly which rules run here vs. only on a full `construct validate` pass). Read-only,
// origin-guarded like `/api/validate`; `file` is contained inside the project root the
// same way every other file-scoped route is (workspace.mjs's `contain`), with
// `mustExist: false` since an unsaved new file has nothing on disk yet.
import { lintBuffer } from '../../../packages/core/lint-buffer.mjs';
import { findProjectRoot } from '../../../packages/core/config.mjs';
import { contain, WorkspaceError } from './workspace.mjs';
import { serverLog } from './logBuffer.mjs';

export const MAX_VIOLATIONS = 500;

/**
 * @param {{origin?:string, clientOrigin:string, projectDir?:string|null, file?:string,
 *   source?:string, lint?:Function, findRoot?:Function, log?:object, now?:()=>number}} ctx
 * @returns {{status:number, body:object}}
 */
export function handleLintBuffer({ origin, clientOrigin, projectDir, file, source, lint = lintBuffer, findRoot = findProjectRoot, log = serverLog, now = Date.now }) {
  if (origin && origin !== clientOrigin) return { status: 403, body: { ok: false, error: 'Origin not allowed.' } };
  const root = projectDir ? findRoot(projectDir) : null;
  if (!root) {
    return { status: 400, body: { ok: false, error: 'No Construct project found for the current project directory. Pick a project first.' } };
  }
  if (typeof file !== 'string' || !file) return { status: 400, body: { ok: false, error: 'file is required.' } };
  if (typeof source !== 'string') return { status: 400, body: { ok: false, error: 'source is required.' } };

  let abs;
  try {
    abs = contain(root, file, { mustExist: false });
  } catch (e) {
    if (e instanceof WorkspaceError) return { status: e.status, body: { ok: false, error: e.message } };
    throw e;
  }

  const started = now();
  try {
    const { violations } = lint(root, abs, source);
    const durationMs = now() - started;
    const errors = violations.filter((v) => v.severity === 'error').length;
    log.record('lint-buffer', errors ? 'warn' : 'info', `lint-buffer: ${file}: ${violations.length} violation(s), ${errors} error(s) in ${durationMs} ms`);
    return {
      status: 200,
      body: {
        ok: true,
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
      },
    };
  } catch (e) {
    log.record('lint-buffer', 'error', `lint-buffer failed: ${e.message}`);
    return { status: 500, body: { ok: false, error: 'Lint could not run.' } };
  }
}
