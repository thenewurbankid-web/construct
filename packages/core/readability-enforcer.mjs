// Readability/naming-convention enforcement (Epic 3.2), built on packages/core/parser.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { walk } from './fs.mjs';
import { makeViolation } from './diagnostics.mjs';
import { exceptionApplies } from './exceptions.mjs';
import { parseFile, layerContextFor, extractExports, extractJsdoc, lineOf, EXT } from './parser.mjs';
import { loadConfig, readRawRules } from './config.mjs';
import { isNonLayerPath } from './nonLayer.mjs';

// Shaped exactly like DEFAULT_RULES in packages/core/config.mjs, exported for Module 4 (or whoever
// owns config.mjs next) to merge into the shared rule table. Not written into config.mjs
// directly — that file is owned by another workstream while this module was built.
export const READABILITY_RULES = {
  'READ-001': { severity: 'error', name: 'Components/controllers are PascalCase; hooks are use-prefixed camelCase' },
  'READ-002': { severity: 'error', name: 'Files and functions stay under their length threshold' },
  'READ-003': { severity: 'warning', name: 'Public API exports document intent with JSDoc' },
  // #512 -- kept 'off' by default here too, mirroring config.mjs's DEFAULT_RULES entry (see
  // its comment for the full rollout reasoning: every existing fixture in this repo would
  // fail this convention today).
  'READ-004': { severity: 'off', name: 'A unit\'s filename encodes its layer as a suffix (Name.layer.ext)' },
};

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const HOOK_NAME = /^use[A-Z][A-Za-z0-9]*$/;
const DEFAULT_MAX_LOC = 200;
const DEFAULT_MAX_FN_LINES = 40;

// #512 -- READ-004's expected filename suffix per layer, for every layer whose filename
// convention this rule is free to check. The `hook` layer is deliberately absent here: it
// splits further, at check time, into .provider.ts / .state.ts / .hook.ts depending on
// which factory the file actually calls (see expectedHookSuffix below) -- the same
// distinction #499's design draws between a Provider hook (#510) and a tracked-state hook
// (#504), which follow genuinely different rules. `route` is absent because it is exempt
// by design (its filename is framework-dictated, not Construct's to rename) -- moot in
// practice anyway, since validateReadability below only ever walks features/*/**, never a
// route file.
const LAYER_SUFFIX = {
  domain: 'domain',
  service: 'service',
  workflow: 'workflow',
  page: 'page',
  component: 'component',
  controller: 'controller',
  expression: 'expression',
};

// Every suffix READ-004 knows about, layer suffixes plus the hook variants -- used to strip
// an already-present (possibly wrong) suffix before suggesting the correct one, so a
// mis-suffixed file (e.g. "Foo.controller.tsx" sitting in components/) gets a clean
// suggested rename instead of "Foo.controller.component.tsx".
const READ_004_KNOWN_SUFFIXES = new Set([...Object.values(LAYER_SUFFIX), 'provider', 'state', 'hook']);

/** READ-004's expected suffix for a hook-layer file: the same defineProvider(...)/
 * useTrackedState(...) presence check HOOK-002/HOOK-001 already use elsewhere (a real
 * factory call is the deterministic, cheap-to-check proxy for "which kind of hook this
 * really is") -- a plain string match against the source, no tsc/AST pass needed. Neither
 * present falls back to the generic ".hook" suffix. */
function expectedHookSuffix(source) {
  if (/\bdefineProvider\s*\(/.test(source)) return 'provider';
  if (/\buseTrackedState\s*\(/.test(source)) return 'state';
  return 'hook';
}

/** Strip a trailing ".<knownSuffix>" segment from `base` (a filename with its outer
 * extension already removed), if present -- e.g. "Foo.controller" -> "Foo" so a suggested
 * rename never doubles up an existing (possibly wrong) layer suffix. */
function stripKnownSuffix(base) {
  const idx = base.lastIndexOf('.');
  if (idx === -1) return base;
  return READ_004_KNOWN_SUFFIXES.has(base.slice(idx + 1)) ? base.slice(0, idx) : base;
}

function severityFor(config, ruleId) {
  const raw = config.rules?.[ruleId];
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && raw.severity) return raw.severity;
  return READABILITY_RULES[ruleId]?.severity || 'error';
}

function pushViolation(config, out, { rule, file, line, message, why, expected, suggestedFix }) {
  const severity = severityFor(config, rule);
  if (severity === 'off' || exceptionApplies(config, rule, file)) return;
  out.push(makeViolation({ rule, module: 'readability', severity, file, line, message, why, expected, suggestedFix }));
}

function toPascalCase(name) {
  return name.replace(/[-_\s]+([A-Za-z0-9])/g, (_, c) => c.toUpperCase()).replace(/^[a-z]/, (c) => c.toUpperCase());
}

function toHookName(name) {
  const stripped = name.replace(/^use[-_]?/i, '');
  return 'use' + toPascalCase(stripped);
}

function checkNaming(config, out, summary) {
  const ext = path.extname(summary.path);
  const base = path.basename(summary.path, ext);
  const dir = path.dirname(summary.path);

  if (summary.layer === 'component' || summary.layer === 'controller') {
    const kind = summary.layer === 'component' ? 'Component' : 'Controller';
    const matchingExport = summary.exports.find((e) => PASCAL.test(e));
    const ok = PASCAL.test(base) && matchingExport === base;
    if (!ok) {
      const suggestedName = matchingExport || toPascalCase(base);
      const suggestedPath = `${dir}/${suggestedName}${ext}`;
      pushViolation(config, out, {
        rule: 'READ-001',
        file: summary.path,
        line: 1,
        message: `${kind} file "${base}${ext}" does not follow PascalCase naming matching its export.`,
        why: `${kind}s are named after the PascalCase identifier they export so ownership is obvious from the filename alone.`,
        expected: [`${suggestedName}${ext} exporting ${suggestedName}`],
        suggestedFix: `Rename ${summary.path} to ${suggestedPath}${matchingExport ? '' : ` and export a PascalCase identifier named ${suggestedName}`}.`,
      });
    }
  }

  if (summary.layer === 'hook') {
    const matchingExport = summary.exports.find((e) => HOOK_NAME.test(e));
    const ok = HOOK_NAME.test(base) && matchingExport === base;
    if (!ok) {
      const suggestedName = matchingExport || toHookName(base);
      const suggestedPath = `${dir}/${suggestedName}${ext}`;
      pushViolation(config, out, {
        rule: 'READ-001',
        file: summary.path,
        line: 1,
        message: `Hook file "${base}${ext}" does not export a use-prefixed camelCase function matching its filename.`,
        why: 'Hooks must be discoverable by their use-prefixed name; consistent naming signals React hook-rule eligibility to tooling and reviewers.',
        expected: [`${suggestedName}${ext} exporting ${suggestedName}`],
        suggestedFix: `Rename ${summary.path} to ${suggestedPath}${matchingExport ? '' : ` and export a function named ${suggestedName}`}.`,
      });
    }
  }
}

/** READ-004 (#512): a unit's filename should carry its layer as a suffix (Name.layer.ext)
 * matching the folder it actually lives in (classified via `summary.layer`, the same layer
 * graph every other rule already uses) -- a plain string-match check against the filename
 * alone, no tsc/AST pass needed, so it can run live on every keystroke. Off by default (see
 * READABILITY_RULES above); a project opts in via architecture.yml. */
function checkLayerSuffix(config, out, summary, source) {
  const expectedSuffix = summary.layer === 'hook' ? expectedHookSuffix(source) : LAYER_SUFFIX[summary.layer];
  if (!expectedSuffix) return; // route (never reached here), or a layer this rule doesn't cover

  const ext = path.extname(summary.path);
  const base = path.basename(summary.path, ext);
  if (base.endsWith(`.${expectedSuffix}`)) return; // already conforms

  const dir = path.dirname(summary.path);
  const suggestedName = `${stripKnownSuffix(base)}.${expectedSuffix}${ext}`;
  pushViolation(config, out, {
    rule: 'READ-004',
    file: summary.path,
    line: 1,
    message: `File "${base}${ext}" does not encode its layer in its filename (expected a ".${expectedSuffix}" suffix before the extension).`,
    why: 'A filename that encodes its layer (Name.layer.ext) is a cheap, live signal — a plain string match, no tsc pass needed — that the file matches the defineX(...) call inside it, and improves plain file-tree browsability without opening anything.',
    expected: [`${dir}/${suggestedName}`],
    suggestedFix: `Rename ${summary.path} to ${dir}/${suggestedName}.`,
  });
}

/** Brace-depth scan for function bodies over `limit` lines. Heuristic, not scope-accurate:
 * handles `function name(...) {` and `const name = (...) => {` forms (the common cases);
 * class-method shorthand and object-literal methods are a known gap. Nested long functions
 * inside an already-long function are reported separately, which is acceptable here. */
function findLongFunctions(source, limit) {
  const results = [];
  const fnRegex = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
  let m;
  while ((m = fnRegex.exec(source))) {
    const name = m[1] || m[2] || 'anonymous';
    const braceStart = source.indexOf('{', m.index);
    if (braceStart === -1) continue;
    let depth = 0, end = -1;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) continue;
    const bodyLines = source.slice(braceStart, end).split('\n').length;
    if (bodyLines > limit) results.push({ name, startLine: lineOf(source, m.index), length: bodyLines });
  }
  return results;
}

function checkLength(config, out, summary, source, maxLoc) {
  if (summary.loc > maxLoc) {
    pushViolation(config, out, {
      rule: 'READ-002',
      file: summary.path,
      line: 1,
      message: `File is ${summary.loc} lines, exceeding the ${maxLoc}-line threshold.`,
      why: 'Long files bundle multiple responsibilities and are harder to review, test, and hand to an AI agent as context.',
      expected: [`≤ ${maxLoc} lines per file`],
      suggestedFix: `Split ${summary.path} into smaller modules along its distinct exports/responsibilities.`,
    });
  }
  for (const fn of findLongFunctions(source, DEFAULT_MAX_FN_LINES)) {
    pushViolation(config, out, {
      rule: 'READ-002',
      file: summary.path,
      line: fn.startLine,
      message: `Function "${fn.name}" is approximately ${fn.length} lines, exceeding the ${DEFAULT_MAX_FN_LINES}-line guideline.`,
      why: 'Long function bodies mix multiple concerns and are hard to reason about, test, or extract safely.',
      expected: [`≤ ${DEFAULT_MAX_FN_LINES} lines per function`],
      suggestedFix: `Extract part of "${fn.name}" (starting at line ${fn.startLine}) in ${summary.path} into a smaller, named helper function.`,
    });
  }
}

function checkFeatureJsdoc(config, out, root, featureRoot, featureName) {
  const indexRel = `${featureRoot}/${featureName}/index.ts`;
  const indexAbs = path.join(root, indexRel);
  if (!fs.existsSync(indexAbs)) return;
  const source = fs.readFileSync(indexAbs, 'utf8');
  for (const { name, index } of extractExports(source)) {
    if (extractJsdoc(source, index)) continue;
    pushViolation(config, out, {
      rule: 'READ-003',
      file: indexRel,
      line: lineOf(source, index),
      message: `Public API export "${name}" has no JSDoc summary.`,
      why: "index.ts is the feature's contract with the rest of the app; undocumented public exports force consumers (and AI agents) to read implementation to learn intent.",
      expected: [`/** ... */ immediately above export ${name}`],
      suggestedFix: `Add a JSDoc block above "${name}" in ${indexRel}, e.g. /** Describe what ${name} does and when to use it. */`,
    });
  }
}

/** Run all readability checks over `<featureRoot>/*` and return `{violations}`. */
export function validateReadability(root) {
  const config = loadConfig(root);
  const featureRoot = config.features.root;
  // READ-002-max-loc is a threshold override, not a normalized rule id in
  // config.mjs's DEFAULT_RULES table — read via readRawRules (unvalidated) rather
  // than config.rules, since normalizeRules only accepts a severity string or an
  // options object per key, not a bare number like `READ-002-max-loc: 10`.
  const maxLoc = Number(readRawRules(root)['READ-002-max-loc']) || DEFAULT_MAX_LOC;
  const featuresDir = path.join(root, featureRoot);
  const out = [];
  const layerContext = layerContextFor(root);
  if (!fs.existsSync(featuresDir)) return { violations: out };
  const featureNames = fs.readdirSync(featuresDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const featureName of featureNames) {
    const dir = path.join(featuresDir, featureName);
    const files = walk(dir).filter((p) => EXT.has(path.extname(p)) && !isNonLayerPath(root, p, config.nonLayer)); // #348
    for (const file of files) {
      const summary = parseFile(root, file, layerContext);
      const source = fs.readFileSync(file, 'utf8');
      checkNaming(config, out, summary);
      checkLength(config, out, summary, source, maxLoc);
      checkLayerSuffix(config, out, summary, source);
    }
    checkFeatureJsdoc(config, out, root, featureRoot, featureName);
  }
  return { violations: out };
}
