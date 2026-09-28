// #553 (part of #542's rule-catalog epic, "Rules 4") -- project-local rules referenced from
// architecture.yml's `localRules:` list, using the SAME catalog shape #542's design settles on
// for the (not-yet-built, #545 "Rules 2") built-in rule catalog:
//   { id, module, layers, scope, defaultSeverity, why, expected, detect }
//
// #545 has not landed yet (no built-in rule lives in this shape today; every existing rule is
// still an imperative branch in architecture-enforcer.mjs/soc-enforcer.mjs/readability-enforcer.mjs).
// This module does not wait on that migration: a project-local rule is a NEW, independent surface
// (a project's own rule, not one of Construct's ~80 built-ins), so it only needs the catalog SHAPE
// to already be settled (#542's design doc), not the internal migration of existing rules into it.
// #545, when it lands, can point at this same shape for the built-ins without this module changing.
//
// Security (#553's own brief): loading local CODE during `construct validate` is a real decision
// (arbitrary project JS running on every validate needs owner sign-off, Notice Board #224). So
// `detect` here is DATA, never a function: a rule file is plain YAML, parsed (js-yaml, no `!!js/
// function` tag support) and interpreted by the small, closed set of detector kinds below. A
// project cannot smuggle in `eval`-equivalent behavior through a rule file -- only ever one of
// the kinds this module already knows how to run.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadConfig } from './config.mjs';
import { loadLayerGraph, classifyFile } from './architecture-graph.mjs';
import { makeViolation, VALID_MODULES, ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { walk, rel, write } from './fs.mjs';
import { lineOf } from '../ast/extract.mjs';

const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const VALID_SCOPES = new Set(['buffer', 'project']);
const VALID_SEVERITIES = new Set(['error', 'warning', 'info', 'off']);

/** Detector kinds this module knows how to run, declarative-only (no code execution). Each
 * validator checks the `detect` object carries exactly the fields its kind needs. */
const DETECTOR_SHAPES = {
  forbiddenImport: (d) => typeof d.module === 'string' && d.module.trim(),
  forbiddenPattern: (d) => typeof d.regex === 'string' && d.regex.trim(),
  requiredPattern: (d) => typeof d.regex === 'string' && d.regex.trim(),
};

function usageError(message) {
  return new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
}

/**
 * Validate one project-local rule object against the catalog shape. Throws a ConstructError
 * (USAGE_ERROR) naming the exact field and the file it came from, so a malformed rule fails
 * `construct validate` with an actionable message instead of a silent no-op or a stack trace.
 *
 * @param {unknown} rule Parsed YAML content of one rule file.
 * @param {string} sourcePath The rule file's path, for error messages only.
 * @returns {{id:string, module:string, layers:string[], scope:string, defaultSeverity:string, why:string, expected:string[], detect:{kind:string,[k:string]:unknown}}}
 */
export function validateRuleShape(rule, sourcePath) {
  const fail = (msg) => { throw usageError(`Invalid local rule (${sourcePath}): ${msg}`); };
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) fail('must be a YAML mapping.');
  const { id, module, layers, scope, defaultSeverity, why, expected, detect } = rule;
  if (typeof id !== 'string' || !id.trim()) fail('"id" must be a non-empty string.');
  if (!VALID_MODULES.has(module)) fail(`"module" must be one of ${[...VALID_MODULES].join(', ')}.`);
  if (!Array.isArray(layers) || !layers.length || layers.some((l) => typeof l !== 'string')) fail('"layers" must be a non-empty array of layer names.');
  if (!VALID_SCOPES.has(scope)) fail(`"scope" must be one of ${[...VALID_SCOPES].join(', ')}.`);
  if (!VALID_SEVERITIES.has(defaultSeverity)) fail(`"defaultSeverity" must be one of ${[...VALID_SEVERITIES].join(', ')}.`);
  if (typeof why !== 'string' || !why.trim()) fail('"why" must be a non-empty string.');
  if (!Array.isArray(expected) || expected.some((e) => typeof e !== 'string')) fail('"expected" must be an array of strings.');
  if (!detect || typeof detect !== 'object' || typeof detect.kind !== 'string') fail('"detect.kind" is required.');
  const shapeOk = DETECTOR_SHAPES[detect.kind];
  if (!shapeOk) fail(`"detect.kind" must be one of ${Object.keys(DETECTOR_SHAPES).join(', ')} (declarative detectors only -- see the security note in local-rules.mjs).`);
  if (!shapeOk(detect)) fail(`"detect" is missing the fields "${detect.kind}" needs.`);
  return { id, module, layers, scope, defaultSeverity, why, expected, detect };
}

/**
 * Load and validate every rule `architecture.yml`'s `localRules:` list points at.
 *
 * @param {string} root Project root.
 * @returns {{id:string, module:string, layers:string[], scope:string, defaultSeverity:string, why:string, expected:string[], detect:object, sourcePath:string}[]}
 * @throws {Error} A usage error when a referenced file is missing, not valid YAML, or fails `validateRuleShape`.
 */
export function loadLocalRules(root) {
  const config = loadConfig(root);
  return (config.localRules || []).map((relPath) => {
    const abs = path.isAbsolute(relPath) ? relPath : path.join(root, relPath);
    if (!fs.existsSync(abs)) throw usageError(`localRules entry "${relPath}" does not resolve to a file.`);
    let parsed;
    try {
      parsed = yaml.load(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      throw usageError(`Failed to parse local rule "${relPath}": ${e.message}`);
    }
    return { ...validateRuleShape(parsed, relPath), sourcePath: relPath };
  });
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run one rule's declarative `detect` against a single file's source, returning `{line, message}`
 * hits (never throws on file content -- an invalid `detect.regex` is caught by `validateRuleShape`
 * / scaffold generation instead, so this stays a pure, total function over already-validated rules).
 *
 * @param {{detect: {kind:string,[k:string]:unknown}}} rule A rule from `loadLocalRules`.
 * @param {string} source The file's source text.
 * @returns {{line:number, message:string}[]}
 */
export function runDetector(rule, source) {
  const { detect } = rule;
  if (detect.kind === 'forbiddenImport') {
    const re = new RegExp(`(['"])${escapeRegExp(detect.module)}\\1`);
    const m = re.exec(source);
    return m ? [{ line: lineOf(source, m.index), message: detect.message || `Forbidden import "${detect.module}".` }] : [];
  }
  if (detect.kind === 'forbiddenPattern') {
    const re = new RegExp(detect.regex, detect.flags || '');
    const m = re.exec(source);
    return m ? [{ line: lineOf(source, m.index), message: detect.message || `Matches forbidden pattern /${detect.regex}/.` }] : [];
  }
  if (detect.kind === 'requiredPattern') {
    const re = new RegExp(detect.regex, detect.flags || '');
    return re.test(source) ? [] : [{ line: 1, message: detect.message || `Missing required pattern /${detect.regex}/.` }];
  }
  return [];
}

/**
 * The `construct validate` enforcer entry for project-local rules (registered in
 * `packages/engine/defaultEnforcers.mjs` alongside architecture/soc/readability/public-api-drift).
 * A rule's `layers` list is resolved against the project's real layer graph (`classifyFile`, the
 * same classifier architecture-enforcer.mjs uses) so "layers: [domain]" means exactly the files
 * `construct validate` itself already calls the domain layer -- no separate glob dialect to learn.
 *
 * @param {string} root Project root.
 * @returns {{violations: object[]}}
 */
export function validateLocalRules(root) {
  // 'off' rules are still loaded (so a malformed one still fails loudly) but never run -- same
  // convention as DEFAULT_RULES' own 'off' entries (config.mjs), and there is no per-project
  // severity override for a local rule id yet (normalizeRules validates ids against the built-in
  // DEFAULT_RULES table only): a project that wants a local rule at a different severity edits
  // its `defaultSeverity` field directly.
  const rules = loadLocalRules(root).filter((rule) => rule.defaultSeverity !== 'off');
  if (!rules.length) return { violations: [] };
  const graph = loadLayerGraph(root);
  const files = walk(root).filter((p) => FILE_EXTENSIONS.has(path.extname(p)));
  const violations = [];
  for (const abs of files) {
    const r = rel(root, abs);
    const layer = classifyFile(r, graph);
    if (!layer) continue;
    const applicable = rules.filter((rule) => rule.layers.includes(layer));
    if (!applicable.length) continue;
    const source = fs.readFileSync(abs, 'utf8');
    for (const rule of applicable) {
      for (const hit of runDetector(rule, source)) {
        violations.push(makeViolation({
          rule: rule.id,
          module: rule.module,
          severity: rule.defaultSeverity,
          file: r,
          line: hit.line,
          message: hit.message,
          why: rule.why,
          expected: rule.expected,
        }));
      }
    }
  }
  return { violations };
}

const RULE_ID_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/**
 * `construct add-rule <id>` (#553): scaffold a project-local rule at `local-rules/<id>/rule.yml`,
 * plus a `violates.ts` / `passes.ts` fixture pair the rule's own `forbiddenPattern` detector agrees
 * with out of the box (a `FORBIDDEN_<ID>` marker each fixture does or doesn't contain) -- runnable,
 * self-consistent evidence for `construct validate` and for Fill-with-AI to edit toward a real rule
 * (the Vision mantra: hand the next layer a concrete example, not an abstract spec), not a stub that
 * merely parses.
 *
 * Never touches `architecture.yml`: wiring a new rule into `localRules:` is a project decision
 * (which rules apply, in what order) left to the caller/human, same as `construct create` never
 * auto-adds a generated layer to an unrelated config list.
 *
 * @param {string} root Project root.
 * @param {string} id Rule id (letters, digits, hyphens; must start with a letter).
 * @param {{module?:string, layers?:string[], scope?:string, severity?:string, why?:string, expected?:string[]}} [opts]
 * @returns {{ruleFile:string, violatesFile:string, passesFile:string, rule:object}} Project-relative paths and the rule object written.
 * @throws {Error} A usage error when `id` is missing/malformed, or `module`/`scope`/`severity` (when given) are not one of the valid values.
 */
export function scaffoldRule(root, id, opts = {}) {
  if (typeof id !== 'string' || !RULE_ID_RE.test(id)) {
    throw usageError('add-rule requires a rule id starting with a letter, containing only letters, digits and hyphens.');
  }
  const module = opts.module ?? 'architecture';
  if (!VALID_MODULES.has(module)) throw usageError(`add-rule --module must be one of ${[...VALID_MODULES].join(', ')}.`);
  const layers = opts.layers && opts.layers.length ? opts.layers : ['domain'];
  const scope = opts.scope ?? 'project';
  if (!VALID_SCOPES.has(scope)) throw usageError(`add-rule --scope must be one of ${[...VALID_SCOPES].join(', ')}.`);
  const defaultSeverity = opts.severity ?? 'warning';
  if (!VALID_SEVERITIES.has(defaultSeverity)) throw usageError(`add-rule --severity must be one of ${[...VALID_SEVERITIES].join(', ')}.`);
  const why = opts.why?.trim() || `Explain, for whoever hits this rule, why "${id}" matters in this project.`;
  const expected = opts.expected && opts.expected.length ? opts.expected : ['Describe the pattern this project expects instead.'];

  const marker = `FORBIDDEN_${id.toUpperCase().replace(/-/g, '_')}`;
  const rule = {
    id,
    module,
    layers,
    scope,
    defaultSeverity,
    why,
    expected,
    detect: {
      kind: 'forbiddenPattern',
      regex: marker,
      message: `Found the placeholder marker "${marker}" -- edit local-rules/${id}/rule.yml's "detect" (and this message) to describe the real pattern, then update the fixtures to match.`,
    },
  };

  const dir = `local-rules/${id}`;
  const ruleFile = `${dir}/rule.yml`;
  const violatesFile = `${dir}/violates.ts`;
  const passesFile = `${dir}/passes.ts`;
  write(path.join(root, ruleFile), yaml.dump(rule));
  write(path.join(root, violatesFile), `// ${marker} -- this fixture is expected to trip the "${id}" rule.\nexport const example = 'replace with real code that violates the rule';\n`);
  write(path.join(root, passesFile), `export const example = 'replace with real code that satisfies the rule';\n`);
  return { ruleFile, violatesFile, passesFile, rule };
}
