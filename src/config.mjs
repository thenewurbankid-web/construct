import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

export const DEFAULT_LAYERS = {
  route: { pattern: 'app/**/page.tsx', canImport: ['controller'] },
  controller: { pattern: 'features/*/controllers/**', canImport: ['workflow', 'hook', 'service', 'page', 'component', 'domain', 'types'] },
  workflow: { pattern: 'features/*/workflows/**', canImport: ['service', 'domain', 'types'] },
  hook: { pattern: 'features/*/hooks/**', canImport: ['workflow', 'service', 'domain', 'types'] },
  service: { pattern: 'features/*/services/**', canImport: ['domain', 'types'] },
  domain: { pattern: 'features/*/domain/**', canImport: ['types'] },
  page: { pattern: 'features/*/pages/**', canImport: ['component', 'types'] },
  component: { pattern: 'features/*/components/**', canImport: ['component', 'types'] },
};

// Rule severities AND non-architecture thresholds (e.g. a future readability
// rule like 'READ-002-max-loc') live in this same uniform map. A value is
// either a bare severity string ('error' | 'warning' | 'off') or an object
// that at minimum carries `severity`, plus whatever extra fields the owning
// enforcer needs (e.g. { severity: 'warning', maxLoc: 200 }).
export const DEFAULT_RULES = {
  'ROUTE-001': { severity: 'error', name: 'Routes delegate to controllers' },
  'ROUTE-002': { severity: 'error', name: 'Routes cannot own business logic or effects' },
  'PAGE-001': { severity: 'error', name: 'Pages are presentation-only' },
  'PAGE-002': { severity: 'error', name: 'Pages cannot import workflows' },
  'PAGE-003': { severity: 'error', name: 'Pages cannot import services' },
  'PAGE-004': { severity: 'error', name: 'Pages cannot call fetch' },
  'PAGE-005': { severity: 'error', name: 'Pages cannot import domain logic' },
  'PAGE-006': { severity: 'error', name: 'Pages cannot use application state/machines' },
  'COMPONENT-001': { severity: 'error', name: 'Components are presentation-only' },
  'COMPONENT-002': { severity: 'error', name: 'Components cannot import controllers' },
  'COMPONENT-003': { severity: 'error', name: 'Components cannot import workflows/services/domain' },
  'WORKFLOW-001': { severity: 'error', name: 'Workflows cannot import React/UI' },
  'SERVICE-001': { severity: 'error', name: 'Services own external effects' },
  'SERVICE-002': { severity: 'error', name: 'Services cannot import React/UI' },
  'DOMAIN-001': { severity: 'error', name: 'Domain is pure' },
  'SLICE-001': { severity: 'error', name: 'Feature internals are isolated' },
  'SLICE-002': { severity: 'error', name: 'Cross-feature imports use public index.ts' },
  'MODULE-001': { severity: 'error', name: 'One primary module per file' },
  'PURE-001': { severity: 'warning', name: 'Domain functions should be deterministic' },
  'DRY-001': { severity: 'warning', name: 'Business knowledge has one source of truth' },
  'SOC-001': { severity: 'error', name: 'Every responsibility has an architectural owner' },
  'SLICE-003': { severity: 'warning', name: 'Public API (index.ts) stays in sync with actual feature exports' },
  'READ-001': { severity: 'error', name: 'Components/controllers are PascalCase; hooks are use-prefixed camelCase' },
  'READ-002': { severity: 'error', name: 'Files and functions stay under their length threshold' },
  'READ-003': { severity: 'warning', name: 'Public API exports document intent with JSDoc' },
  'EXCEPTION-EXPIRED': { severity: 'warning', name: 'Time-boxed exceptions must be renewed or removed once they expire' },
};

const VALID_SEVERITIES = new Set(['error', 'warning', 'off']);

// Plain Levenshtein edit distance, used only to produce "did you mean" hints.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function closestRuleId(unknownId, knownIds) {
  const upper = unknownId.toUpperCase();
  let best = null;
  let bestScore = Infinity;
  for (const id of knownIds) {
    // Prefer substring relationships (typo'd suffix/prefix) over raw distance.
    const substringBonus = id.toUpperCase().includes(upper) || upper.includes(id.toUpperCase()) ? -2 : 0;
    const score = levenshtein(upper, id.toUpperCase()) + substringBonus;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function usageError(message) {
  return new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
}

/**
 * Merge and validate a user-supplied `rules` map from architecture.yml
 * against DEFAULT_RULES. Throws a ConstructError (USAGE_ERROR) with a
 * "did you mean" suggestion for unknown rule ids, and for invalid severities.
 */
export function normalizeRules(userRules, defaults = DEFAULT_RULES) {
  const knownIds = Object.keys(defaults);
  const merged = { ...defaults };
  for (const [ruleId, value] of Object.entries(userRules || {})) {
    if (!(ruleId in defaults)) {
      const suggestion = closestRuleId(ruleId, knownIds);
      throw usageError(
        `Unknown rule '${ruleId}' in architecture.yml` + (suggestion ? ` — did you mean '${suggestion}'?` : ''),
      );
    }
    const base = defaults[ruleId];
    let entry;
    if (typeof value === 'string') {
      entry = { ...base, severity: value };
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      entry = { ...base, ...value };
    } else {
      throw usageError(`Invalid configuration for rule '${ruleId}' in architecture.yml — expected a severity string or an options object.`);
    }
    if (!VALID_SEVERITIES.has(entry.severity)) {
      throw usageError(
        `Invalid severity '${entry.severity}' for rule '${ruleId}' in architecture.yml — expected one of: error, warning, off.`,
      );
    }
    merged[ruleId] = entry;
  }
  return merged;
}

/**
 * Walk up from `startDir` looking for the nearest `architecture.yml`,
 * stopping at the filesystem root. Returns the containing directory, or
 * null if none is found. Supports monorepos where a subpackage has no
 * config of its own and should inherit the parent's.
 */
export function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'architecture.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(root) {
  const file = path.join(root, 'architecture.yml');
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      preset: 'strict-nextjs',
      features: { root: 'features' },
      layers: DEFAULT_LAYERS,
      rules: DEFAULT_RULES,
      exceptions: [],
    };
  }

  let c;
  try {
    c = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (e) {
    throw usageError(`Failed to parse architecture.yml: ${e.message}`);
  }
  if (typeof c !== 'object' || Array.isArray(c)) {
    throw usageError('architecture.yml must be a YAML mapping (object) at the top level.');
  }

  const rules = normalizeRules(c.rules, DEFAULT_RULES);

  return {
    version: 1,
    preset: 'strict-nextjs',
    ...c,
    features: { root: 'features', ...(c.features || {}) },
    layers: DEFAULT_LAYERS,
    rules,
    exceptions: c.exceptions || [],
  };
}
