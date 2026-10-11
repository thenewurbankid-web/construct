// Line profile (ca1): the enforcer `construct validate --profile line` (or `preset: line` in
// architecture.yml) runs instead of the strict-nextjs enforcer set. It runs the LINE-* rules
// (contract.mjs, checks.mjs) plus the existing per-layer rules that still apply to Line items:
// detectLayerViolations for every library/feature component, page and workflow, as the matching
// Construct layer, with the project's own `rules:` severities and exceptions.
import { loadConfig } from '../../config.mjs';
import { makeViolation } from '../../diagnostics.mjs';
import { exceptionApplies, validateExceptionsShape } from '../../exceptions.mjs';
import { detectLayerViolations, layerViolationOptsFor } from '../../architecture-enforcer.mjs';
import { LINE_RULES, LINE_RULE_IDS, KIND_LAYER, normalizeLineConfig } from './contract.mjs';
import {
  resolveLayout, loadProject, isItemFile, checkLayout, checkBase, checkOwner, checkDirection, checkWriter, checkShared, checkModules, matchesAny, parseFailures,
} from './checks.mjs';

export { LINE_RULES, LINE_RULE_IDS, normalizeLineConfig } from './contract.mjs';

/** Which check produces each LINE-* rule. */
const CHECKS = {
  'LINE-LAYOUT': (p) => checkLayout(p),
  'LINE-BASE': (p) => checkBase(p),
  'LINE-OWNER': (p) => checkOwner(p),
  'LINE-DIR': (p) => checkDirection(p),
  'LINE-WRITER': (p, line) => checkWriter(p, line),
  'LINE-SHARED': (p, line) => checkShared(p, line),
  'LINE-MODULE': (p, line) => checkModules(p, line),
};

/** Existing Construct layer rules for every library/feature component, page and workflow. */
function layerHits(project, config) {
  const out = [];
  for (const file of project.files) {
    const layer = KIND_LAYER[file.kind];
    if ((file.area !== 'library' && file.area !== 'feature') || !layer || !isItemFile(file) || file.rel.endsWith('.json')) continue;
    if (project.ast(file.rel) instanceof Error) continue;
    for (const desc of detectLayerViolations(layer, project.source(file.rel), layerViolationOptsFor(config, layer))) {
      out.push({ ...desc, file: file.rel });
    }
  }
  return out;
}

/**
 * Validate a project against the Line profile.
 *
 * @param {string} root Project root.
 * @param {{files?: string[], rules?: string[]}} [opts] `files` keeps only findings in those
 *   root-relative files; `rules` runs only those LINE-* rules (layer rules run when `rules` is absent).
 * @returns {{violations: object[], ok: boolean, layout: {library: string, features: string, state: string}}}
 */
export function validateLine(root, opts = {}) {
  const config = loadConfig(root);
  validateExceptionsShape(config);
  const line = normalizeLineConfig(/** @type {any} */ (config).line);
  const layout = resolveLayout(root, line);
  const project = loadProject(root, layout);
  const only = opts.rules ? new Set(opts.rules) : null;
  const violations = [];

  for (const id of LINE_RULE_IDS) {
    if (only && !only.has(id)) continue;
    const { severity } = line.rules[id];
    if (severity === 'off') continue;
    const rule = LINE_RULES[id];
    for (const h of CHECKS[id](project, line)) {
      if (exceptionApplies(config, id, h.file)) continue;
      violations.push(makeViolation({ rule: id, module: 'architecture', severity, file: h.file, line: h.line, message: h.message, why: rule.why, expected: rule.expected }));
    }
  }

  if (!only) {
    for (const h of layerHits(project, config)) {
      const severity = config.rules[h.rule]?.severity || 'error';
      if (severity === 'off' || exceptionApplies(config, h.rule, h.file)) continue;
      violations.push(makeViolation({ rule: h.rule, module: 'architecture', severity, file: h.file, line: h.line, message: h.message, why: h.why, expected: h.expected || [], suggestedFix: h.suggestedFix }));
    }
    for (const f of parseFailures(project)) {
      if (matchesAny(f.file, line.writerExempt)) continue;
      violations.push(makeViolation({
        rule: 'PARSE-ERROR', module: 'architecture', severity: 'warning', file: f.file, line: 1,
        message: `Could not parse "${f.file}" (${f.message}), so the Line rules could not check it.`,
        why: 'A file that does not parse cannot be checked for base links, imports or file writes.',
        expected: ['syntactically valid TypeScript/JSX'],
      }));
    }
  }

  const scoped = opts.files && opts.files.length ? new Set(opts.files) : null;
  const kept = scoped ? violations.filter((v) => scoped.has(v.file)) : violations;
  return { violations: kept, ok: !kept.some((v) => v.severity === 'error'), layout };
}

/** The enforcer list for the "line" profile (registry.mjs's Enforcer shape). */
export const LINE_ENFORCERS = Object.freeze([{ name: 'line', validate: (root, opts) => validateLine(root, opts) }]);
