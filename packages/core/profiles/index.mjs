// Validation profiles (ca1): which enforcer set `construct validate` runs. `strict-nextjs` is the
// default set (packages/engine/defaultEnforcers.mjs); `line` is the Line project profile
// (packages/core/profiles/line, docs/line-architecture.md). A project picks one with `preset:` in
// architecture.yml; `construct validate --profile <name>` overrides it for one run.
import { DEFAULT_ENFORCERS } from '@line/construct-engine/default-enforcers';
import { LINE_ENFORCERS } from './line/index.mjs';
import { loadConfig } from '../config.mjs';
import { ConstructError, EXIT_CODES } from '../diagnostics.mjs';

export const PROFILES = Object.freeze({ 'strict-nextjs': DEFAULT_ENFORCERS, line: LINE_ENFORCERS });

/**
 * The profile a validate run uses: the requested one, else architecture.yml's `preset:` when it names
 * a profile, else strict-nextjs.
 * @param {string} root Project root.
 * @param {string} [requested] A `--profile` value.
 * @returns {string} A key of PROFILES.
 * @throws {ConstructError} A usage error for an unknown requested profile.
 */
export function selectProfile(root, requested) {
  if (requested !== undefined) {
    if (!Object.hasOwn(PROFILES, requested)) {
      throw new ConstructError(`"${requested}" is not a validation profile; the profiles are ${Object.keys(PROFILES).join(', ')}.`, { exitCode: EXIT_CODES.USAGE_ERROR });
    }
    return requested;
  }
  const preset = loadConfig(root).preset;
  return typeof preset === 'string' && Object.hasOwn(PROFILES, preset) ? preset : 'strict-nextjs';
}

/**
 * The enforcer list a project's own validate runs use: its `preset:` profile, else strict-nextjs.
 * Every gate (the transactional writer, the approval gate, the core executor, MCP and Cockpit's
 * validate) calls this, so a `preset: line` project is checked by the Line rules everywhere, not
 * only by `construct validate`.
 * @param {string} root Project root.
 * @returns {import('../registry.mjs').Enforcer[]} Its enforcers.
 */
export function enforcersForRoot(root) {
  return enforcersForProfile(selectProfile(root));
}

/**
 * The enforcer list for a profile name.
 * @param {string} name A key of PROFILES.
 * @returns {import('../registry.mjs').Enforcer[]} Its enforcers (the strict-nextjs set for an unknown name).
 */
export function enforcersForProfile(name) {
  return /** @type {import('../registry.mjs').Enforcer[]} */ (Object.hasOwn(PROFILES, name) ? PROFILES[name] : DEFAULT_ENFORCERS);
}
