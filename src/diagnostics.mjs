// 'info' (#473, PROP-LINK) is a real finding worth showing but never a validation failure --
// exitCodeForViolations below only ever fails a run on 'error', so adding it here never changes
// what makes `construct validate` exit non-zero.
const VALID_SEVERITIES = new Set(['error', 'warning', 'info', 'off']);
const VALID_MODULES = new Set(['architecture', 'separation-of-concerns', 'readability']);
const REQUIRED_FIELDS = ['rule', 'module', 'severity', 'file', 'line', 'message', 'why', 'expected'];

export const EXIT_CODES = { OK: 0, VIOLATIONS: 1, USAGE_ERROR: 2, INTERNAL_ERROR: 3 };

/**
 * An error that carries the violations that caused it and the process exit code the CLI should use. Thrown by commands that must stop (validation failures, usage errors); `src/cli.mjs` turns it into an exit status.
 *
 * @example
 * throw new ConstructError("2 violations", { violations, exitCode: EXIT_CODES.VIOLATIONS });
 *
 * @since 0.8
 */
export class ConstructError extends Error {
  constructor(message, { violations = [], exitCode = EXIT_CODES.INTERNAL_ERROR } = {}) {
    super(message);
    this.name = 'ConstructError';
    this.violations = violations;
    this.exitCode = exitCode;
  }
}

/**
 * Check that a violation object has every required field and valid `severity`, `module` and `expected` values.
 *
 * @param {object} v Violation to check.
 * @returns {true} Always `true` when valid.
 * @throws {Error} Naming the missing or invalid field.
 */
export function assertValidViolation(v) {
  for (const key of REQUIRED_FIELDS) {
    if (!(key in v)) throw new Error(`Invalid violation: missing "${key}" (rule ${v.rule ?? '?'})`);
  }
  if (!VALID_SEVERITIES.has(v.severity)) throw new Error(`Invalid violation severity "${v.severity}" for rule ${v.rule}`);
  if (!VALID_MODULES.has(v.module)) throw new Error(`Invalid violation module "${v.module}" for rule ${v.rule}`);
  if (!Array.isArray(v.expected)) throw new Error(`Invalid violation "expected" (must be an array) for rule ${v.rule}`);
  return true;
}

/**
 * Build and validate a diagnostic-contract violation object.
 *
 * @param {{rule: string, module: string, severity: string, file: string, line: number, message: string, why: string, expected?: string[], suggestedFix?: string, docsUrl?: string}} input
 */
export function makeViolation({ rule, module, severity, file, line, message, why, expected = [], suggestedFix, docsUrl }) {
  const v = { rule, module, severity, file, line, message, why, expected, suggestedFix, docsUrl };
  assertValidViolation(v);
  return v;
}

export function formatViolation(v) {
  const icon = v.severity === 'error' ? '❌' : v.severity === 'warning' ? '⚠️' : 'ℹ️';
  const lines = [`${icon} ${v.rule} [${v.module}]`, `  ${v.file}:${v.line}`, `  ${v.message}`, `  Why: ${v.why}`];
  if (v.expected?.length) lines.push(`  Expected: ${v.expected.join(' or ')}`);
  if (v.suggestedFix) lines.push(`  Fix: ${v.suggestedFix}`);
  if (v.docsUrl) lines.push(`  Docs: ${v.docsUrl}`);
  return lines.join('\n');
}

/**
 * Render violations for the terminal or as JSON.
 *
 * @param {object[]} violations Violation objects from `makeViolation`.
 * @param {{format?: 'text'|'json'}} [options] `json` returns `{status, violations}` as a string.
 * @returns {string} The report text (a one-line pass message when there are no violations).
 */
export function formatReport(violations, { format = 'text' } = {}) {
  const ok = !violations.some((v) => v.severity === 'error');
  if (format === 'json') return JSON.stringify({ status: ok ? 'passed' : 'failed', violations }, null, 2);
  if (!violations.length) return '✓ Construct validation passed';
  return violations.map(formatViolation).join('\n\n');
}

/**
 * The process exit code for a set of violations: only `error` severity fails the run.
 *
 * @param {object[]} violations Violation objects.
 * @returns {number} `EXIT_CODES.VIOLATIONS` (1) if any violation has severity `error`, else `EXIT_CODES.OK` (0).
 */
export function exitCodeForViolations(violations) {
  return violations.some((v) => v.severity === 'error') ? EXIT_CODES.VIOLATIONS : EXIT_CODES.OK;
}
