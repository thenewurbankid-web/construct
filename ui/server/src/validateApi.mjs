// `GET /api/validate`: runs the same validation `construct validate` runs
// (aggregateValidation + DEFAULT_ENFORCERS from the core) against the current
// project's root and returns the violations as data. Read-only, origin-guarded,
// and scoped to the project root found from the settings project directory
// (no path parameter, so a caller cannot point it at another directory).
import { aggregateValidation } from '../../../packages/core/registry.mjs';
import { DEFAULT_ENFORCERS } from '../../../packages/engine/defaultEnforcers.mjs';
import { findProjectRoot } from '../../../packages/core/config.mjs';
import { serverLog } from './logBuffer.mjs';

export const MAX_VIOLATIONS = 500;

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
    return {
      status: 200,
      body: {
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
      },
    };
  } catch (e) {
    log.record('validate', 'error', `validate failed: ${e.message}`);
    return { status: 500, body: { ok: false, error: 'Validation could not run.' } };
  }
}
