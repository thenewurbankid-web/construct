const VALID_SEVERITIES = new Set(['error', 'warning', 'off']);
const VALID_MODULES = new Set(['architecture', 'separation-of-concerns', 'readability']);
const REQUIRED_FIELDS = ['rule', 'module', 'severity', 'file', 'line', 'message', 'why', 'expected'];

export const EXIT_CODES = { OK: 0, VIOLATIONS: 1, USAGE_ERROR: 2, INTERNAL_ERROR: 3 };

export class ConstructError extends Error {
  constructor(message, { violations = [], exitCode = EXIT_CODES.INTERNAL_ERROR } = {}) {
    super(message);
    this.name = 'ConstructError';
    this.violations = violations;
    this.exitCode = exitCode;
  }
}

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

export function formatReport(violations, { format = 'text' } = {}) {
  const ok = !violations.some((v) => v.severity === 'error');
  if (format === 'json') return JSON.stringify({ status: ok ? 'passed' : 'failed', violations }, null, 2);
  if (!violations.length) return '✓ Construct validation passed';
  return violations.map(formatViolation).join('\n\n');
}

export function exitCodeForViolations(violations) {
  return violations.some((v) => v.severity === 'error') ? EXIT_CODES.VIOLATIONS : EXIT_CODES.OK;
}
