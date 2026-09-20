// Readability/naming-convention enforcement (Epic 3.2), built on src/parser.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { walk } from './fs.mjs';
import { makeViolation } from './diagnostics.mjs';
import { exceptionApplies } from './exceptions.mjs';
import { parseFile, layerContextFor, extractExports, extractJsdoc, lineOf, EXT } from './parser.mjs';
import { loadConfig, readRawRules } from './config.mjs';
import { isNonLayerPath } from './nonLayer.mjs';

// Shaped exactly like DEFAULT_RULES in src/config.mjs, exported for Module 4 (or whoever
// owns config.mjs next) to merge into the shared rule table. Not written into config.mjs
// directly — that file is owned by another workstream while this module was built.
export const READABILITY_RULES = {
  'READ-001': { severity: 'error', name: 'Components/controllers are PascalCase; hooks are use-prefixed camelCase' },
  'READ-002': { severity: 'error', name: 'Files and functions stay under their length threshold' },
  'READ-003': { severity: 'warning', name: 'Public API exports document intent with JSDoc' },
};

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const HOOK_NAME = /^use[A-Z][A-Za-z0-9]*$/;
const DEFAULT_MAX_LOC = 200;
const DEFAULT_MAX_FN_LINES = 40;

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
    }
    checkFeatureJsdoc(config, out, root, featureRoot, featureName);
  }
  return { violations: out };
}
