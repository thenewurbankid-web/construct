// #548 -- the per-transition invariant: after a block/step writes files, three checks run in order,
// reusing what already exists rather than rebuilding it:
//   1. scope    -- the changed files must be a subset of the transition's `declaredScope`/`touches`
//                  (same shape in block-contract.mjs and plan.mjs -- see validateTouches).
//   2. blast radius -- impactFromChangedFiles() (packages/engine/impact.mjs), the same function
//                  PR health and Research mode already use. Never rebuilt here.
//   3. rules    -- the enforcer catalog (DEFAULT_ENFORCERS today) runs on the AFFECTED SET: the
//                  changed files plus every file the blast radius says depends on them. Project-scope
//                  rules (SLICE-001 skeleton, ownership, duplication, feature JSDoc) still see their
//                  whole affected feature, not a single file, since their result depends on dependents
//                  -- see soc-enforcer.mjs / readability-enforcer.mjs's own `opts.files` handling.
//
// This module is pure and read-only: it never writes, never mutates a transaction. Callers
// (processEngine.mjs's step commit, approvalGate.mjs's decide(), pipeline.mjs's runPipeline) decide
// what to do with the verdict.
import { impactFromChangedFiles } from './impact.mjs';
import { aggregateValidation } from '../core/registry.mjs';

/** The declared file paths of a scope/touches object (`{features?, files?}`), whichever of the two
 * shapes used across the codebase: a plain string, or `{path, change}` (plan.mjs's `touches.files`). */
export function declaredFilePaths(scope) {
  if (!scope || !Array.isArray(scope.files)) return [];
  return scope.files.map((f) => (typeof f === 'string' ? f : f?.path)).filter((p) => typeof p === 'string' && p.length);
}

/**
 * Rule 1 of the per-transition invariant: every changed file must be declared.
 *
 * @param {{features?: string[], files?: any[]}|null} scope A block's `declaredScope` or a plan step's `touches`.
 * @param {string[]} changedFiles Project-relative paths actually written.
 * @returns {{ok: boolean, outside: string[], declared: string[]}} `outside` lists changed files the scope never named.
 */
export function checkScope(scope, changedFiles) {
  const declared = new Set(declaredFilePaths(scope));
  const outside = [...new Set(changedFiles || [])].filter((f) => !declared.has(f)).sort();
  return { ok: outside.length === 0, outside, declared: [...declared].sort() };
}

/**
 * Rule 2: the blast radius of the changed files, via `impactFromChangedFiles` -- reused, not rebuilt.
 * Expands the changed-file set to every file the affected features' rules need to see (rule 3 reruns
 * project-scope rules on the whole affected feature, since their result depends on dependents).
 *
 * @param {string} root Project root.
 * @param {string[]} changedFiles Project-relative paths actually written.
 * @param {object} [impactOpts] Forwarded to `impactFromChangedFiles` (e.g. `depth`).
 * @returns {{files: string[], features: string[], impact: object|null}} `files` is `changedFiles` plus
 *   everything the impact graph implicates; `impact` is the raw report (`null` when there is nothing to trace).
 */
export function affectedSet(root, changedFiles, impactOpts = {}) {
  const seeds = [...new Set(changedFiles || [])].sort();
  if (!seeds.length) return { files: [], features: [], impact: null };
  const impact = impactFromChangedFiles(root, seeds, impactOpts);
  if (!impact.ok) return { files: seeds, features: [], impact };
  const files = new Set(seeds);
  const features = new Set();
  for (const row of impact.files || []) {
    files.add(row.path);
    if (row.feature) features.add(row.feature);
  }
  return { files: [...files].sort(), features: [...features].sort(), impact };
}

/**
 * Rule 3: run the enforcer catalog on the affected set only.
 *
 * @param {string} root Project root.
 * @param {string[]} changedFiles Project-relative paths actually written.
 * @param {Array<{name: string, validate: Function}>} enforcers e.g. `DEFAULT_ENFORCERS`.
 * @param {object} [impactOpts] Forwarded to `affectedSet`.
 * @returns {{violations: object[], ok: boolean, affected: {files: string[], features: string[], impact: object|null}}}
 */
export function validateAffectedSet(root, changedFiles, enforcers, impactOpts = {}) {
  const affected = affectedSet(root, changedFiles, impactOpts);
  const result = aggregateValidation(root, enforcers, { files: affected.files });
  return { ...result, affected };
}

/**
 * The whole per-transition invariant, in order: scope, then (only when in scope) blast radius and
 * rules on the affected set. Stops at the first failing rule -- an out-of-scope write never reaches
 * rule validation, since there is nothing meaningful to validate a refused transition against.
 *
 * @param {string} root Project root.
 * @param {object} options
 * @param {{features?: string[], files?: any[]}|null} options.scope The transition's declared scope.
 * @param {string[]} options.changedFiles Project-relative paths actually written.
 * @param {Array<{name: string, validate: Function}>} options.enforcers The rule catalog to run.
 * @param {object} [options.impactOpts] Forwarded to `affectedSet`.
 * @returns {{ok: boolean, code: 'OUT_OF_SCOPE'|'RULE_VIOLATION'|'OK', scope: object, blastRadius: object|null, validation: object|null}}
 */
export function checkTransition(root, { scope, changedFiles, enforcers, impactOpts } = {}) {
  const scopeResult = checkScope(scope, changedFiles);
  if (!scopeResult.ok) {
    return { ok: false, code: 'OUT_OF_SCOPE', scope: scopeResult, blastRadius: null, validation: null };
  }
  const files = [...new Set(changedFiles || [])];
  if (!files.length) {
    return { ok: true, code: 'OK', scope: scopeResult, blastRadius: { files: [], features: [], impact: null }, validation: { violations: [], ok: true } };
  }
  const { affected, ...validation } = validateAffectedSet(root, files, enforcers, impactOpts);
  return { ok: validation.ok, code: validation.ok ? 'OK' : 'RULE_VIOLATION', scope: scopeResult, blastRadius: affected, validation };
}
