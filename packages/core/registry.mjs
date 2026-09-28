// Pluggable enforcer registry for `construct validate`.
//
// An "enforcer" is `{ name, validate(root) -> { violations } }`. Each enforcer
// is responsible for returning diagnostics.mjs-shaped violation objects
// (see makeViolation in packages/core/diagnostics.mjs) tagged with their own `module`
// field. This module only knows how to merge results and compute an overall
// pass/fail — it never imports enforcer implementations itself, so it has no
// dependency on modules that may not exist yet in the working tree.

/**
 * @typedef {{violations: Array<Record<string, any>>}} EnforcerResult
 * @typedef {{name: string, validate: (root: string, opts?: {files?: string[]}) => EnforcerResult}} Enforcer
 */

/**
 * Run every enforcer against `root` and merge their violations.
 *
 * @param {string} root - project root to validate.
 * @param {Enforcer[]} [enforcers]
 * @param {{files?: string[]}} [opts] - forwarded to each enforcer as its second argument (#548); an
 *   enforcer that does not accept `opts.files` yet just ignores the extra argument and checks the
 *   whole project, exactly as before.
 * @returns {{violations: Array<Record<string, any>>, ok: boolean}}
 */
export function aggregateValidation(root, enforcers, opts) {
  const list = enforcers ?? [];
  const violations = [];
  for (const enforcer of list) {
    const result = enforcer && typeof enforcer.validate === 'function' ? enforcer.validate(root, opts) : undefined;
    if (result && Array.isArray(result.violations)) violations.push(...result.violations);
  }
  const ok = !violations.some((v) => v.severity === 'error');
  return { violations, ok };
}

// TODO(integration): once Modules 1-3 land, build the real enforcer list here
// (or in packages/core/cli.mjs's `validate` command) and pass it to aggregateValidation:
//
//   import { validateArchitecture } from './architecture-enforcer.mjs';
//   import { validateSeparationOfConcerns } from './soc-enforcer.mjs';
//   import { validateReadability } from './readability-enforcer.mjs';
//
//   export const DEFAULT_ENFORCERS = [
//     { name: 'architecture', validate: validateArchitecture },
//     { name: 'separation-of-concerns', validate: validateSeparationOfConcerns },
//     { name: 'readability', validate: validateReadability },
//   ];
//
// See packages/core/cli.mjs's `validate()` export for the exact call site where the
// legacy single-enforcer array is built today — replace/extend that array.
