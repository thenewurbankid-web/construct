// Scoped, time-boxed rule exceptions (architecture.yml `exceptions:`), shared by every
// enforcer (architecture, separation-of-concerns, readability). One implementation of:
//   - validateExceptionsShape(config)   throws ConstructError on a malformed entry
//   - exceptionApplies(config, rule, file)   is this rule+file currently exempt?
//   - expiredExceptionViolations(config)     warnings for stale (expired) exceptions
// An exception is { path: <glob>, rule: <id> | rules: [<id>...], expires?: <ISO date | Date>,
// reason?: <string> }. Expired exceptions no longer suppress anything.
import { matchGlob } from './glob.mjs';
import { makeViolation, ConstructError, EXIT_CODES } from './diagnostics.mjs';

// architecture.yml is YAML: an unquoted date-like scalar (e.g. `expires:
// 2020-01-01`) is parsed by js-yaml's default schema into a real JS `Date`,
// not a string — quoting it (`expires: "2020-01-01"`) yields a string
// instead. Both are legitimate on-disk representations of the same author
// intent, so every place that reads `expires` accepts either.
function isValidExpiry(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function formatExpiry(value) {
  if (!(value instanceof Date)) return value;
  return Number.isNaN(value.getTime()) ? String(value) : value.toISOString().slice(0, 10);
}

/** Throws a ConstructError naming the exact malformed exception entry. */
export function validateExceptionsShape(config) {
  (config.exceptions || []).forEach((e, i) => {
    if (!e || typeof e.path !== 'string' || !e.path) {
      throw new ConstructError(
        `Invalid exception at architecture.yml exceptions[${i}]: missing required "path" glob.`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
    const rules = e.rule ? [e.rule] : e.rules;
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new ConstructError(
        `Invalid exception at architecture.yml exceptions[${i}] (path: "${e.path}"): must declare "rule" or a non-empty "rules" array.`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
    if (e.expires !== undefined && !isValidExpiry(e.expires)) {
      throw new ConstructError(
        `Invalid exception at architecture.yml exceptions[${i}] (path: "${e.path}"): "expires" is not a valid ISO date ("${formatExpiry(e.expires)}").`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
  });
  return true;
}

/** Does a (non-expired) exception cover this rule + file? */
export function exceptionApplies(config, rule, file) {
  const now = Date.now();
  return (config.exceptions || []).some((e) => {
    const rules = e.rule ? [e.rule] : e.rules || [];
    return rules.includes(rule) && matchGlob(e.path, file) && (!e.expires || new Date(e.expires).getTime() >= now);
  });
}

/** Warning-severity diagnostics flagging exceptions that have gone stale. */
export function expiredExceptionViolations(config) {
  const now = Date.now();
  return (config.exceptions || [])
    .filter((e) => e.expires && new Date(e.expires).getTime() < now)
    .map((e) => makeViolation({
      rule: 'EXCEPTION-EXPIRED',
      module: 'architecture',
      severity: 'warning',
      file: e.path,
      line: 1,
      message: `Exception for ${(e.rule ? [e.rule] : e.rules || []).join(', ')} on "${e.path}" expired on ${formatExpiry(e.expires)}.`,
      why: 'Time-boxed exceptions must be renewed or removed once they expire; an expired exception no longer suppresses violations.',
      expected: ['renew the exception', 'remove the exception'],
      suggestedFix: `Update or delete the exception entry for "${e.path}" in architecture.yml.`,
    }));
}
