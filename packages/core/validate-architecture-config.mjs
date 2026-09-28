// A single entry point that validates a proposed architecture.yml (parsed
// object, not yet written to disk) against every shape check loadConfig()
// applies piecemeal (normalizeRules, normalizeLayers, validateExceptionsShape,
// normalizeFrozen, normalizeNonLayer). Each of those throws on the first
// problem it finds; this collects every problem instead, so a Rules composer
// can show a user everything wrong with a proposed edit at once rather than
// one round-trip per fix (#395/#761).
import { normalizeRules, normalizeLayers, normalizeFramework, DEFAULT_RULES } from './config.mjs';
import { validateExceptionsShape } from './exceptions.mjs';
import { normalizeFrozen } from './frozen.mjs';
import { normalizeNonLayer } from './nonLayer.mjs';
import { ConstructError } from './diagnostics.mjs';

/**
 * Validate a proposed architecture.yml (already `yaml.load`-parsed, in the
 * same shape loadConfig() reads: `rules`, `project.framework`, `layers`,
 * `exceptions`, `frozen`, `nonLayer`, `features.root`) without writing
 * anything or throwing. Never mutates `proposed`.
 *
 * @param {unknown} proposed The parsed architecture.yml candidate.
 * @returns {{valid: boolean, errors: string[]}} `valid` is `errors.length === 0`.
 *
 * @example
 * validateArchitectureConfig({ rules: { 'BOGUS-1': 'error' } }).errors;
 * // => ["Unknown rule 'BOGUS-1' in architecture.yml"]
 */
export function validateArchitectureConfig(proposed) {
  const errors = [];

  if (proposed === undefined || proposed === null) return { valid: true, errors };
  if (typeof proposed !== 'object' || Array.isArray(proposed)) {
    return { valid: false, errors: ['architecture.yml must be a YAML mapping (object) at the top level.'] };
  }

  const run = (fn) => {
    try {
      fn();
    } catch (e) {
      errors.push(e instanceof ConstructError || e instanceof Error ? e.message : String(e));
    }
  };

  let framework = 'nextjs';
  run(() => { framework = normalizeFramework(proposed.project?.framework); });
  run(() => normalizeRules(proposed.rules, DEFAULT_RULES));
  run(() => normalizeLayers(proposed.layers, framework));
  run(() => validateExceptionsShape(proposed));
  run(() => normalizeFrozen(proposed.frozen));
  run(() => normalizeNonLayer(proposed.nonLayer));

  if (proposed.features !== undefined) {
    if (typeof proposed.features !== 'object' || Array.isArray(proposed.features) || proposed.features === null) {
      errors.push("Invalid 'features' in architecture.yml — expected a mapping, e.g. { root: 'features' }.");
    } else if (proposed.features.root !== undefined && (typeof proposed.features.root !== 'string' || !proposed.features.root.trim())) {
      errors.push("Invalid 'features.root' in architecture.yml — expected a non-empty string.");
    }
  }

  return { valid: errors.length === 0, errors };
}
