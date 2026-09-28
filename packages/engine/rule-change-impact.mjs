// Deterministic before/after impact of a PROPOSED architecture.yml rule change
// (#395/#760): "this makes 14 files newly violate PAGE-004", computed before
// anything is written to the real project. `analyzeImpact` (impact.mjs)
// answers "what already violates rule X, reachable from here"; this answers
// "what would newly violate/stop violating any rule if I applied this edit".
//
// Isolation strategy: `aggregateValidation` runs enforcers that read
// architecture.yml straight off disk (loadConfig(root)), so there is no seam
// to hand them a config object directly. Instead, each side of the diff runs
// against its own throwaway copy of the project tree with that side's config
// written to `architecture.yml` — the real project directory is never
// touched, read-only or otherwise.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { aggregateValidation } from '../core/registry.mjs';
import { DEFAULT_ENFORCERS } from './defaultEnforcers.mjs';

const EXCLUDED_NAMES = new Set(['node_modules', '.git', '.next']);

function runAgainstConfig(root, config, enforcers) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-rule-impact-'));
  try {
    fs.cpSync(root, tempRoot, {
      recursive: true,
      filter: (src) => !EXCLUDED_NAMES.has(path.basename(src)),
    });
    fs.writeFileSync(path.join(tempRoot, 'architecture.yml'), yaml.dump(config || {}));
    return aggregateValidation(tempRoot, enforcers).violations;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function violationKey(v) {
  return `${v.rule}::${v.file}`;
}

/**
 * Diff the violations a project would have under `currentConfig` versus
 * under `proposedConfig`, grouped by rule id.
 *
 * @param {string} root Project root (read-only; copied to a temp dir, never mutated).
 * @param {object} currentConfig The raw (pre-loadConfig-normalization) architecture.yml shape today.
 * @param {object} proposedConfig The raw architecture.yml shape after the proposed edit.
 * @param {{enforcers?: Array}} [opts] Override the enforcer list (defaults to `DEFAULT_ENFORCERS`).
 * @returns {Record<string, {newlyViolating: string[], newlyClean: string[]}>} Empty object when the change has no effect.
 */
export function simulateRuleChangeImpact(root, currentConfig, proposedConfig, opts = {}) {
  const enforcers = opts.enforcers || DEFAULT_ENFORCERS;
  const currentViolations = runAgainstConfig(root, currentConfig, enforcers);
  const proposedViolations = runAgainstConfig(root, proposedConfig, enforcers);

  const currentKeys = new Set(currentViolations.map(violationKey));
  const proposedKeys = new Set(proposedViolations.map(violationKey));

  const diff = {};
  const bucket = (rule) => (diff[rule] ||= { newlyViolating: [], newlyClean: [] });

  for (const v of proposedViolations) {
    if (!currentKeys.has(violationKey(v))) bucket(v.rule).newlyViolating.push(v.file);
  }
  for (const v of currentViolations) {
    if (!proposedKeys.has(violationKey(v))) bucket(v.rule).newlyClean.push(v.file);
  }
  return diff;
}
