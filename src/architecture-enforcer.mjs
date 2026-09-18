// Epic 1.2 — Layer Boundary Enforcer
//
// Classifies files by path pattern, checks import edges against the layer
// graph (src/architecture-graph.mjs), detects effects inside layers that
// must stay pure/thin, and honors scoped/time-boxed exceptions. All
// violations are produced through diagnostics.mjs's makeViolation with
// module: 'architecture'.
//
// Layer-violation detection (detectLayerViolations, below) is AST-based
// (epic #76 / #89): it reads real import declarations and real call/
// identifier usage from the parsed tree via parseToAst/extractImports
// (src/parser.mjs), not regex/text-pattern matching over the whole file. A
// comment or string literal that happens to contain a banned substring
// (e.g. "workflow/service/domain" or "fetch()") is never part of the
// executable AST, so it can no longer trip a rule the way real code would
// (#74's false-positive class).
import fs from 'node:fs';
import path from 'node:path';
import { walk as walkAst } from 'estree-walker';
import { loadConfig } from './config.mjs';
import { loadLayerGraph, canImport } from './architecture-graph.mjs';
import { makeViolation, ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { walk, rel } from './fs.mjs';
import { parseToAst, extractImports } from './parser.mjs';

export { extractImports };

const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const KNOWN_LAYERS = new Set(['route', 'controller', 'workflow', 'hook', 'service', 'domain', 'page', 'component']);

/** Does this import specifier refer to the "react" package or a "react/" subpath
 * (e.g. "react-dom/client" is NOT matched — mirrors the old REACT_IMPORT_RE's intent
 * of "the react package itself or something nested under a react/ path segment"). */
function isReactSpecifier(specifier) {
  return specifier === 'react' || /(^|\/)react\//.test(specifier);
}

/** Import specifiers from top-level `import ... from '...'` declarations only (not
 * dynamic import()), with each entry's source position — layer-boundary imports in
 * this codebase's conventions are always static, and a position is needed for
 * per-rule line-number reporting (extractImports from parser.mjs returns just the
 * specifier strings, with no position). */
function staticImportEntries(ast) {
  const entries = [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') entries.push({ value: node.source.value, index: node.range[0] });
  }
  return entries;
}

// Node types/keys that don't represent a real "usage" of an identifier, so the walk
// below (via estree-walker, a well-established generic ESTree traversal library — not
// a hand-rolled recursive walk) skips into them: an import statement's bindings (a name
// merely being imported isn't a use of it), a re-export's specifier list, and a
// non-computed member/object/class-key name (`x.fetch` or `{ fetch: 1 }` isn't a
// reference to the global `fetch`).
const KEY_ONLY_TYPES = new Set(['Property', 'PropertyDefinition', 'MethodDefinition', 'TSPropertySignature', 'TSMethodSignature', 'TSAbstractMethodDefinition', 'TSAbstractPropertyDefinition']);

function isNonUsagePosition(node, parent, key) {
  if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return true;
  if (parent?.type === 'ExportNamedDeclaration' && (key === 'specifiers' || key === 'source')) return true;
  if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) return true;
  if (parent && KEY_ONLY_TYPES.has(parent.type) && key === 'key' && !parent.computed) return true;
  return false;
}

/** Shared estree-walker traversal for both collectors below: skips whole subtrees at
 * non-usage positions (see isNonUsagePosition), visits everything else. */
function walkForUsage(ast, visit) {
  walkAst(ast, {
    enter(node, parent, key) {
      if (isNonUsagePosition(node, parent, key)) {
        this.skip();
        return;
      }
      visit(node);
    },
  });
}

/** Every real `name(...)` call (callee is a bare identifier in `names`), sorted by position. */
function collectCalls(ast, names) {
  const hits = [];
  walkForUsage(ast, (node) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && names.has(node.callee.name)) {
      hits.push({ name: node.callee.name, index: node.callee.range[0] });
    }
  });
  return hits.sort((a, b) => a.index - b.index);
}

/** Every real reference to a bare identifier in `names` — called or not — sorted by
 * position; skips property/key positions per isNonUsagePosition, so `{ fetch: 1 }` or
 * `obj.fetch` don't count, but `fetch(...)`, `window.x`, or a bare `localStorage` do. */
function collectBareIdentifierUsages(ast, names) {
  const hits = [];
  walkForUsage(ast, (node) => {
    if (node.type === 'Identifier' && names.has(node.name)) {
      hits.push({ name: node.name, index: node.range[0] });
    }
  });
  return hits.sort((a, b) => a.index - b.index);
}

// Ticket 7.4's CONTROLLER-001 deterministic proxy for "business logic": any of these
// node types appearing anywhere in a controller file's AST.
const CONTROL_FLOW_TYPES = new Set(['IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'TryStatement']);

/** Every control-flow node (see CONTROL_FLOW_TYPES) anywhere in `ast`, sorted by position. */
function collectControlFlowNodes(ast) {
  const hits = [];
  walkForUsage(ast, (node) => {
    if (CONTROL_FLOW_TYPES.has(node.type)) hits.push(node);
  });
  return hits.sort((a, b) => a.range[0] - b.range[0]);
}

function globToRegExp(glob) {
  const escaped = glob.replaceAll('**', ' ').replaceAll('*', '[^/]*').replaceAll(' ', '.*');
  return new RegExp('^' + escaped + '$');
}

/** Classify a project-relative file path into a layer name, or null. */
export function classifyFile(relPath, graph) {
  for (const [layer, def] of Object.entries(graph)) {
    if (def.pattern && globToRegExp(def.pattern).test(relPath)) return layer;
  }
  return null;
}

/** Folder token (e.g. "controllers") a layer's pattern lives under, if any. */
function layerFolder(def) {
  return def.pattern?.match(/features\/\*\/([^/]+)\//)?.[1];
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Pure rule-detection: given a layer name and a file's source text, return
 * the raw violation descriptors (rule/line/message/why/expected) it
 * triggers. No severity/exception/module wrapping — that happens in
 * pushViolation so this stays trivially unit-testable with in-memory
 * source strings.
 */
export function detectLayerViolations(layer, source) {
  const ast = parseToAst(source);
  const importsList = extractImports(source);
  const staticImports = staticImportEntries(ast);
  const firstImportMatch = (re) => staticImports.find((e) => re.test(e.value));
  const out = [];

  if (layer === 'route') {
    if (!importsList.some((x) => /controllers?\//.test(x))) {
      out.push({
        rule: 'ROUTE-001', line: 1,
        message: 'Route does not import a controller.',
        why: 'Routes are navigation entry points and must delegate.',
        expected: ['controller'],
      });
    }
    if (collectBareIdentifierUsages(ast, new Set(['fetch', 'useMachine', 'useActor', 'localStorage', 'sessionStorage'])).length) {
      out.push({
        rule: 'ROUTE-002', line: 1,
        message: 'Route contains application logic or effects.',
        why: 'Routes must remain thin.',
        expected: ['controller'],
      });
    }
  }

  if (layer === 'page') {
    /** @type {[string, RegExp][]} */
    const forbiddenImports = [['PAGE-002', /workflows?\//], ['PAGE-003', /services?\//], ['PAGE-005', /domain\//]];
    for (const [rule, re] of forbiddenImports) {
      const hit = firstImportMatch(re);
      if (hit) out.push({
        rule, line: lineOf(source, hit.index),
        message: 'Page imports a forbidden application layer.',
        why: 'Pages are presentation-only.',
        expected: ['component', 'types'],
      });
    }
    const fetchCall = collectCalls(ast, new Set(['fetch']))[0];
    if (fetchCall) out.push({
      rule: 'PAGE-004', line: lineOf(source, fetchCall.index), message: 'Page calls fetch().',
      why: 'Pages cannot own application flow.',
      expected: ['controller', 'workflow'],
    });
    const stateUsage = collectBareIdentifierUsages(ast, new Set(['useMachine', 'useActor', 'createMachine']))[0];
    if (stateUsage) out.push({
      rule: 'PAGE-006', line: lineOf(source, stateUsage.index), message: 'Page uses workflow/application state.',
      why: 'Pages cannot own application flow.',
      expected: ['controller', 'workflow'],
    });
    // Ticket 7.2 (#112): a page can also reach for application state indirectly, by
    // importing a custom hook (features/*/hooks/**) without ever calling
    // useMachine/useActor/createMachine directly itself -- e.g. `import { useCart }
    // from '../hooks/useCart'`. That's the same class of violation PAGE-006 already
    // exists for (pages owning application flow instead of delegating to a
    // controller/hook wiring), so it's reported under the same rule id rather than a
    // new one (the epic's reconciliation notes explicitly reserve a new PAGE-005 for a
    // different, already-taken meaning).
    const hookImport = firstImportMatch(/hooks?\//);
    if (hookImport) out.push({
      rule: 'PAGE-006', line: lineOf(source, hookImport.index), message: 'Page imports a custom hook.',
      why: 'Pages cannot own application flow — hooks are wired in by a controller, not imported directly by a page.',
      expected: ['controller', 'workflow'],
    });
  }

  if (layer === 'component') {
    const controllerImport = firstImportMatch(/controllers?\//);
    if (controllerImport) out.push({
      rule: 'COMPONENT-002', line: lineOf(source, controllerImport.index),
      message: 'Component imports a controller.',
      why: 'Components are reusable presentation and must not depend on the composition layer.',
      expected: ['props', 'component'],
    });
    const appImport = firstImportMatch(/(?:workflows?|services?|domain)\//);
    if (appImport) out.push({
      rule: 'COMPONENT-003', line: lineOf(source, appImport.index),
      message: 'Component imports application logic.',
      why: 'Components are reusable presentation and local UI state only.',
      expected: ['props', 'component'],
    });
  }

  if (layer === 'workflow' && staticImports.some((e) => isReactSpecifier(e.value))) {
    out.push({
      rule: 'WORKFLOW-001', line: 1,
      message: 'Workflow imports React/UI.',
      why: 'Workflow logic must be UI-independent.',
      expected: ['service', 'domain', 'types'],
    });
  }

  if (layer === 'service' && staticImports.some((e) => isReactSpecifier(e.value))) {
    out.push({
      rule: 'SERVICE-002', line: 1,
      message: 'Service imports React/UI.',
      why: 'Services own external effects, not rendering.',
      expected: ['api', 'domain', 'types'],
    });
  }

  // Ticket 7.4 (#114) -- CONTROLLER-001: a controller composes/wires already-generated
  // layers together and nothing else. Two independent, AST-based checks (same technique
  // as every other rule above): a direct fetch() call (mirrors PAGE-004's detection), and
  // any control-flow construct at all (if/for/while/do-while/switch/try) anywhere in the
  // file, which is the deterministic proxy this codebase uses for "non-trivial business
  // logic" -- a pure import+destructure+return-JSX composition never needs one.
  if (layer === 'controller') {
    const fetchCall = collectCalls(ast, new Set(['fetch']))[0];
    if (fetchCall) out.push({
      rule: 'CONTROLLER-001', line: lineOf(source, fetchCall.index), message: 'Controller calls fetch() directly.',
      why: 'Controllers only compose and wire existing layers together — network calls belong in a service.',
      expected: ['service'],
    });
    const controlFlow = collectControlFlowNodes(ast)[0];
    if (controlFlow) out.push({
      rule: 'CONTROLLER-001', line: lineOf(source, controlFlow.range[0]), message: 'Controller contains non-trivial business logic (control flow).',
      why: 'Controllers only compose and wire existing layers together — conditional/loop/error-handling logic belongs in a hook, workflow, or domain function.',
      expected: ['hook', 'workflow', 'domain'],
    });
  }

  if (layer === 'domain') {
    const hit = collectBareIdentifierUsages(ast, new Set(['fetch', 'window', 'document', 'localStorage', 'sessionStorage', 'navigator']))[0];
    if (hit) out.push({
      rule: 'DOMAIN-001', line: lineOf(source, hit.index),
      message: 'Domain code uses an external effect.',
      why: 'Domain is pure by default.',
      expected: ['pure function'],
    });
  }

  return out;
}

// ---- Exceptions ------------------------------------------------------

/** Convert a Construct glob (`**`, `*`) into an anchored RegExp. */
export function matchGlob(glob, file) {
  const g = glob.replaceAll('**', ' ').replaceAll('*', '[^/]*').replaceAll(' ', '.*');
  return new RegExp('^' + g + '$').test(file);
}

// architecture.yml is YAML: an unquoted date-like scalar (e.g. `expires:
// 2020-01-01`) is parsed by js-yaml's default schema into a real JS `Date`,
// not a string — quoting it (`expires: "2020-01-01"`) yields a string
// instead. Both are legitimate on-disk representations of the same author
// intent, so every place that reads `expires` accepts either.
function isValidExpiry(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function formatExpiry(value) {
  if (!(value instanceof Date)) return value;
  return Number.isNaN(value.getTime()) ? String(value) : value.toISOString().slice(0, 10);
}

/** Throws a ConstructError naming the exact malformed exception entry. */
export function validateExceptionsShape(config) {
  (config.exceptions || []).forEach((e, i) => {
    if (!e || typeof e.path !== 'string' || !e.path) {
      throw new ConstructError(
        `Invalid exception at architecture.yml exceptions[${i}]: missing required "path" glob.`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
    const rules = e.rule ? [e.rule] : e.rules;
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new ConstructError(
        `Invalid exception at architecture.yml exceptions[${i}] (path: "${e.path}"): must declare "rule" or a non-empty "rules" array.`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
    if (e.expires !== undefined && !isValidExpiry(e.expires)) {
      throw new ConstructError(
        `Invalid exception at architecture.yml exceptions[${i}] (path: "${e.path}"): "expires" is not a valid ISO date ("${formatExpiry(e.expires)}").`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
  });
  return true;
}

/** Does a (non-expired) exception cover this rule + file? */
export function exceptionApplies(config, rule, file) {
  const now = Date.now();
  return (config.exceptions || []).some((e) => {
    const rules = e.rule ? [e.rule] : e.rules || [];
    return rules.includes(rule) && matchGlob(e.path, file) && (!e.expires || new Date(e.expires).getTime() >= now);
  });
}

/** Warning-severity diagnostics flagging exceptions that have gone stale. */
export function expiredExceptionViolations(config) {
  const now = Date.now();
  return (config.exceptions || [])
    .filter((e) => e.expires && new Date(e.expires).getTime() < now)
    .map((e) => makeViolation({
      rule: 'EXCEPTION-EXPIRED',
      module: 'architecture',
      severity: 'warning',
      file: e.path,
      line: 1,
      message: `Exception for ${(e.rule ? [e.rule] : e.rules || []).join(', ')} on "${e.path}" expired on ${formatExpiry(e.expires)}.`,
      why: 'Time-boxed exceptions must be renewed or removed once they expire; an expired exception no longer suppresses violations.',
      expected: ['renew the exception', 'remove the exception'],
      suggestedFix: `Update or delete the exception entry for "${e.path}" in architecture.yml.`,
    }));
}

// ---- Core enforcement --------------------------------------------------

/** @param {{rule: string, file: string, line: number, message: string, why: string, expected?: string[], suggestedFix?: string}} desc */
function pushViolation(config, out, desc) {
  const { rule, file, line, message, why, expected = [], suggestedFix } = desc;
  const severity = config.rules[rule]?.severity || 'error';
  if (severity === 'off') return;
  if (exceptionApplies(config, rule, file)) return;
  out.push(makeViolation({
    rule,
    module: 'architecture',
    severity,
    file,
    line,
    message,
    why,
    expected,
    suggestedFix: suggestedFix || (expected.length ? `Move the responsibility to ${expected.join(' or ')}.` : undefined),
  }));
}

function knownFolders(graph) {
  return new Set(Object.values(graph).map(layerFolder).filter(Boolean));
}

function checkUnclassified(config, graph, r, out) {
  const m = r.match(/^features\/[^/]+\/([^/]+)\//);
  if (!m) return;
  const folders = knownFolders(graph);
  if (folders.has(m[1])) return;
  pushViolation(config, out, {
    rule: 'SOC-001',
    file: r,
    line: 1,
    message: `File "${r}" is inside a feature but its folder ("${m[1]}") is not a recognized architecture layer.`,
    why: 'Every responsibility must have an architectural owner (a designated layer folder).',
    expected: [...folders].map((f) => `features/<feature>/${f}/`),
    suggestedFix: `Move this file into one of: ${[...folders].join(', ')}.`,
  });
}

/** Resolve a relative import specifier from `fromAbsFile` to an absolute file
 * on disk, trying the bare path plus the usual extension/index fallbacks.
 * Returns null for an external/bare specifier, or if nothing on disk matches
 * any candidate — the caller decides what that means (unclassifiable vs.
 * IMPORT-001's "this doesn't exist yet"). */
export function resolveRelativeImport(fromAbsFile, importPath) {
  if (!importPath.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromAbsFile), importPath);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

function resolveImportLayer(root, fromAbsFile, importPath, graph) {
  const hit = resolveRelativeImport(fromAbsFile, importPath);
  if (!hit) return null;
  return classifyFile(rel(root, hit), graph);
}

// IMPORT-001 — a relative import that resolves to nothing is either a typo or
// a reference to a file a later build step hasn't generated yet (e.g. a
// controller's stub template imports a same-named page before that page has
// been created). Checked regardless of whether the target sits inside or
// outside the project root — a controller that wraps an externally-authored
// file may legitimately reach far outside root via a long relative path.
function checkDanglingImports(config, absFile, source, r, out) {
  for (const importPath of extractImports(source)) {
    if (!importPath.startsWith('.')) continue;
    if (resolveRelativeImport(absFile, importPath)) continue;
    pushViolation(config, out, {
      rule: 'IMPORT-001',
      file: r,
      line: 1,
      message: `Import "${importPath}" does not resolve to an existing file.`,
      why: 'A relative import that resolves to nothing points at a typo, or at a file from a later step in the build order that has not been generated yet — this is how Construct enforces generation order.',
      expected: ['a file that exists at the resolved path'],
      suggestedFix: `Create the missing file (check the recommended layer order: domain -> service -> workflow -> hook -> component -> page -> controller), or fix the import path in "${r}".`,
    });
  }
}

// For layers outside the hardcoded rule set above (i.e. custom/project-defined
// layers), fall back to a generic graph-edge check so custom layers still get
// enforcement, using SOC-001 ("every responsibility has an architectural
// owner") as the catch-all rule id.
function checkGenericEdges(config, graph, root, absFile, r, layer, out) {
  const source = fs.readFileSync(absFile, 'utf8');
  for (const importPath of extractImports(source)) {
    const targetLayer = resolveImportLayer(root, absFile, importPath, graph);
    if (!targetLayer || targetLayer === layer) continue;
    if (!canImport(graph, layer, targetLayer)) {
      pushViolation(config, out, {
        rule: 'SOC-001',
        file: r,
        line: 1,
        message: `Layer "${layer}" imports layer "${targetLayer}" ("${importPath}"), which is not an allowed dependency.`,
        why: `The architecture graph does not permit ${layer} -> ${targetLayer}.`,
        expected: graph[layer]?.canImport || [],
      });
    }
  }
}

/**
 * Validate architecture boundaries for a project (or a scoped subset of its
 * files). Entry point for other modules to compose into an aggregate
 * `construct validate` command.
 *
 * @param {string} root - project root.
 * @param {{files?: string[]}} [opts] - restrict checking to these files
 *   (relative to root, or absolute) instead of walking the whole project;
 *   used by the composer's post-generation self-check.
 * @returns {{violations: object[], ok: boolean}}
 */
export function validateArchitecture(root, opts = {}) {
  const config = loadConfig(root);
  const graph = loadLayerGraph(root); // throws ConstructError on a malformed custom graph
  validateExceptionsShape(config); // throws ConstructError on a malformed exception

  const files = (opts.files && opts.files.length)
    ? opts.files.map((f) => (path.isAbsolute(f) ? f : path.join(root, f)))
    : walk(root).filter((p) => FILE_EXTENSIONS.has(path.extname(p)));

  const out = [];
  for (const abs of files) {
    if (!FILE_EXTENSIONS.has(path.extname(abs)) || !fs.existsSync(abs)) continue;
    const r = rel(root, abs);
    const layer = classifyFile(r, graph);
    if (!layer) {
      checkUnclassified(config, graph, r, out);
      continue;
    }
    const source = fs.readFileSync(abs, 'utf8');
    for (const desc of detectLayerViolations(layer, source)) {
      pushViolation(config, out, { ...desc, file: r });
    }
    checkDanglingImports(config, abs, source, r, out);
    if (!KNOWN_LAYERS.has(layer)) {
      checkGenericEdges(config, graph, root, abs, r, layer, out);
    }
  }

  out.push(...expiredExceptionViolations(config));

  return { violations: out, ok: !out.some((v) => v.severity === 'error') };
}
