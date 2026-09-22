import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { normalizeFrozen } from './frozen.mjs';
import { normalizeNonLayer } from './nonLayer.mjs';

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

// Every layer graph below shares the same feature-internal shape
// (controller/workflow/hook/service/domain/page/component all live under
// `features/*/<folder>/**`, framework-agnostic) — the only thing that
// actually differs per target framework is where the "route" layer's entry
// points physically live and how they're structured. Next.js App Router
// uses file-system routing (one `page.tsx` per route folder under `app/`);
// a react-spa target has no such per-route file — routing is centralized in
// one file (by convention `src/App.tsx`, mirroring `ui/client/src/App.jsx`'s
// real shape: a single file with a react-router `<Routes>` table mapping
// URL paths straight to controller elements) that this pattern must match
// instead. Every field other than `route` is intentionally identical to
// DEFAULT_LAYERS above.
export const REACT_SPA_LAYERS = { ...DEFAULT_LAYERS, route: { pattern: 'src/App.tsx', canImport: ['controller'] } };

// Recognized `project.framework` values in architecture.yml. `nextjs` stays
// the default so every project that predates this option (or simply never
// sets it) keeps behaving exactly as before.
export const FRAMEWORKS = ['nextjs', 'react-spa'];
const DEFAULT_FRAMEWORK = 'nextjs';

const LAYERS_BY_FRAMEWORK = {
  nextjs: DEFAULT_LAYERS,
  'react-spa': REACT_SPA_LAYERS,
};

/**
 * Validate and normalize a `project.framework` value from architecture.yml.
 * Absent/undefined normalizes to the default ('nextjs') for full backward
 * compatibility with every project written before this option existed.
 *
 * @param {string|null|undefined} raw The `project.framework` value from `architecture.yml`.
 * @returns {string} A supported framework id; `'nextjs'` when `raw` is absent.
 * @throws {Error} A usage error naming the supported frameworks when `raw` is unknown.
 *
 * @example
 * normalizeFramework(undefined); // => 'nextjs'
 * normalizeFramework('react-spa'); // => 'react-spa'
 */
export function normalizeFramework(raw) {
  if (raw === undefined || raw === null) return DEFAULT_FRAMEWORK;
  if (typeof raw !== 'string' || !FRAMEWORKS.includes(raw)) {
    throw usageError(
      `Unknown project.framework '${raw}' in architecture.yml — expected one of: ${FRAMEWORKS.join(', ')}.`,
    );
  }
  return raw;
}

// Ticket 7.5 — recognized `project.dataLayer.provider` values. Selects which
// transport adapter the service generator instantiates as `baseQuery` in
// `features/core/services/client.ts`: RTKQ's own `fetchBaseQuery` (the
// default, so a project that never sets this keeps getting exactly what it
// would have gotten before this option existed), a hand-rolled Axios
// adapter, or a network-free mock adapter for tests/demos.
export const DATA_LAYER_PROVIDERS = ['fetchBaseQuery', 'axios', 'mock'];
const DEFAULT_DATA_LAYER_PROVIDER = 'fetchBaseQuery';

/**
 * Validate and normalize a `project.dataLayer.provider` value from
 * architecture.yml. Absent/undefined normalizes to the default
 * ('fetchBaseQuery'), mirroring normalizeFramework's backward-compatible
 * shape above.
 */
export function normalizeDataLayerProvider(raw) {
  if (raw === undefined || raw === null) return DEFAULT_DATA_LAYER_PROVIDER;
  if (typeof raw !== 'string' || !DATA_LAYER_PROVIDERS.includes(raw)) {
    throw usageError(
      `Unknown project.dataLayer.provider '${raw}' in architecture.yml — expected one of: ${DATA_LAYER_PROVIDERS.join(', ')}.`,
    );
  }
  return raw;
}

/** The canonical base layer graph for a given (already-normalized) framework
 * value — the shape #66/#67 and architecture-graph.mjs's loadLayerGraph
 * branch on before applying any project-level `layers:` override. */
export function layersForFramework(framework) {
  return LAYERS_BY_FRAMEWORK[framework] || DEFAULT_LAYERS;
}

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
  // Epic #185 (#190) -- reuse the workflow narrator's health findings (packages/engine/workflowScenarios.mjs).
  'WORKFLOW-002': { severity: 'warning', name: 'Workflow states must be reachable from the initial state' },
  'WORKFLOW-003': { severity: 'warning', name: 'Non-final workflow states must have a way out' },
  // Ticket 7.4 (#114) -- genuinely new, per the epic's reconciliation notes (no existing
  // rule covers this): a controller's whole job is composing/wiring already-generated
  // layers together (import a page, import a hook, pass matched handlers down) -- never
  // a raw fetch() call or its own conditional/loop business logic, both of which belong
  // one layer down (service/hook/workflow/domain).
  'CONTROLLER-001': { severity: 'error', name: 'Controllers must compose (import + wire only) — no business logic or raw fetch()' },
  // #23 -- only evaluated when architecture.yml declares `frozen:` globs; see
  // frozen-detector.mjs for the exact (deterministic) heuristic and its option
  // fields (minDuplicateElements / similarity / maxOwnElements).
  'PAGE-007': { severity: 'warning', name: 'Pages wrap frozen (externally-authored) markup instead of reimplementing it' },
  'COMPONENT-004': { severity: 'warning', name: 'Components wrap frozen (externally-authored) markup instead of reimplementing it' },
  'CONTROLLER-002': { severity: 'warning', name: 'Controllers wrap frozen (externally-authored) markup instead of reimplementing it' },
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
  // Not a rule with a severity — a numeric threshold override consumed directly by
  // readability-enforcer.mjs (via readRawRules, not this merged/validated map).
  // Registered here (numeric: true) purely so normalizeRules doesn't reject the key as
  // unknown or demand a severity-string/options-object shape for it (see normalizeRules
  // below, and readRawRules' doc comment for why the actual value bypasses validation).
  'READ-002-max-loc': { name: "Override for READ-002's max-lines-per-file threshold", numeric: true },
  'IMPORT-001': { severity: 'error', name: 'Relative imports must resolve to a file that exists' },
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
    // A `numeric: true` default (e.g. 'READ-002-max-loc') is a threshold override, not a
    // severity-bearing rule — a bare number is its valid shape, and it's exempt from the
    // severity-string/options-object/VALID_SEVERITIES checks below entirely.
    if (base.numeric && typeof value === 'number') {
      merged[ruleId] = { ...base, value };
      continue;
    }
    if (typeof value === 'string') {
      entry = { ...base, severity: value };
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      entry = { ...base, ...value };
    } else {
      throw usageError(
        base.numeric
          ? `Invalid configuration for '${ruleId}' in architecture.yml — expected a number.`
          : `Invalid configuration for rule '${ruleId}' in architecture.yml — expected a severity string or an options object.`,
      );
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
 *
 * @param {string} startDir Directory to start from.
 * @returns {string|null} The nearest ancestor directory (or `startDir` itself) that holds an `architecture.yml`, or `null` when there is none.
 * @since 0.8
 *
 * @example
 * findProjectRoot('/work/app/features/plan'); // => '/work/app'
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

/** Read the raw, unvalidated `rules` map from architecture.yml (or `{}` if the file is
 * missing or malformed) — for a caller that needs an ad-hoc threshold value under a key
 * that isn't a normalized rule id in DEFAULT_RULES (e.g. readability-enforcer.mjs's
 * `READ-002-max-loc: <number>` override), without going through normalizeRules' strict
 * id/severity-shape validation (which only accepts a severity string or an options
 * object per key — not a bare number). Everything that *is* a real rule id should go
 * through loadConfig()/normalizeRules instead; this exists specifically so that escape
 * hatch doesn't force every non-rule config knob through the same strict shape. */
export function readRawRules(root) {
  const file = path.join(root, 'architecture.yml');
  if (!fs.existsSync(file)) return {};
  try {
    const c = yaml.load(fs.readFileSync(file, 'utf8'));
    return c && typeof c === 'object' && !Array.isArray(c) ? (c.rules || {}) : {};
  } catch {
    return {};
  }
}

/**
 * Load and normalize a project's `architecture.yml`. A missing file yields the built-in defaults (strict Next.js preset); a present one is merged over them: rules are normalized to severities, the layer graph is chosen from `project.framework`, and `frozen` / `nonLayer` globs are normalized.
 *
 * @param {string} root Project root that contains (or should contain) `architecture.yml`.
 * @returns {{version:number, preset:string, project:object, features:{root:string}, layers:object, rules:object, exceptions:object[], frozen:string[], nonLayer:string[]}} The effective configuration.
 * @throws {Error} A usage error when the file is not valid YAML or is not a mapping at the top level.
 * @since 0.8
 *
 * @example
 * const config = loadConfig(process.cwd());
 * config.rules['PAGE-001'].severity; // => 'error' unless architecture.yml overrides it
 */
export function loadConfig(root) {
  const file = path.join(root, 'architecture.yml');
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      preset: 'strict-nextjs',
      project: { framework: DEFAULT_FRAMEWORK, dataLayer: { provider: DEFAULT_DATA_LAYER_PROVIDER } },
      features: { root: 'features' },
      layers: DEFAULT_LAYERS,
      rules: DEFAULT_RULES,
      exceptions: [],
      frozen: [],
      nonLayer: [],
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
  const framework = normalizeFramework(c.project?.framework);
  const dataLayerProvider = normalizeDataLayerProvider(c.project?.dataLayer?.provider);

  return {
    version: 1,
    preset: 'strict-nextjs',
    ...c,
    project: {
      ...(c.project || {}),
      framework,
      dataLayer: { ...(c.project?.dataLayer || {}), provider: dataLayerProvider },
    },
    features: { root: 'features', ...(c.features || {}) },
    layers: layersForFramework(framework),
    rules,
    exceptions: c.exceptions || [],
    frozen: normalizeFrozen(c.frozen),
    nonLayer: normalizeNonLayer(c.nonLayer),
  };
}
