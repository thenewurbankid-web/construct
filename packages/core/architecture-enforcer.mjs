// Epic 1.2 — Layer Boundary Enforcer
//
// Classifies files by path pattern, checks import edges against the layer
// graph (packages/core/architecture-graph.mjs), detects effects inside layers that
// must stay pure/thin, and honors scoped/time-boxed exceptions. All
// violations are produced through diagnostics.mjs's makeViolation with
// module: 'architecture'.
//
// Layer-violation detection (detectLayerViolations, below) is AST-based
// (epic #76 / #89): it reads real import declarations and real call/
// identifier usage from the parsed tree via parseToAst/extractImports
// (packages/core/parser.mjs), not regex/text-pattern matching over the whole file. A
// comment or string literal that happens to contain a banned substring
// (e.g. "workflow/service/domain" or "fetch()") is never part of the
// executable AST, so it can no longer trip a rule the way real code would
// (#74's false-positive class).
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { loadLayerGraph, canImport, classifyFile } from './architecture-graph.mjs';
import { makeViolation, ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { walk, rel } from './fs.mjs';
import { globToRegExp, matchGlob } from './glob.mjs';
import { parseToAst, extractImports, staticImportEntries, lineOf, collectCalls, collectBareIdentifierUsages, collectControlFlowNodes, collectInlineJsxLogic, computeJsxComplexity } from '../../packages/ast/index.mjs';
import { extractMachines } from '../../packages/engine/workflowExtractor.mjs';
import { findHealthIssues } from '../../packages/engine/workflowScenarios.mjs';
import { exceptionApplies, validateExceptionsShape, expiredExceptionViolations } from './exceptions.mjs';
import { matchFrozen } from './frozen.mjs';
import { isNonLayerPath } from './nonLayer.mjs';
import { buildFrozenIndex, detectFrozenViolations, FROZEN_RULE_BY_LAYER } from './frozen-detector.mjs';

export { extractImports };

const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const KNOWN_LAYERS = new Set(['route', 'controller', 'workflow', 'hook', 'service', 'domain', 'page', 'component']);

// #508 -- COMPONENT-006's default JSX complexity budget (overridable via
// architecture.yml's 'COMPONENT-006-max-depth'/'COMPONENT-006-max-branches',
// same numeric-override mechanism as 'READ-002-max-loc'). Illustrative
// defaults, not a load-bearing constant sourced from anywhere else.
const DEFAULT_COMPONENT_MAX_JSX_DEPTH = 6;
const DEFAULT_COMPONENT_MAX_JSX_BRANCHES = 3;

/** Does this import specifier refer to the "react" package or a "react/" subpath
 * (e.g. "react-dom/client" is NOT matched — mirrors the old REACT_IMPORT_RE's intent
 * of "the react package itself or something nested under a react/ path segment"). */
function isReactSpecifier(specifier) {
  return specifier === 'react' || /(^|\/)react\//.test(specifier);
}

// Single layer classifier lives in architecture-graph.mjs (#174); re-exported for callers.
export { classifyFile };

/** Folder token (e.g. "controllers") a layer's pattern lives under, if any. */
function layerFolder(def) {
  return def.pattern?.match(/features\/\*\/([^/]+)\//)?.[1];
}

/**
 * Pure rule-detection: given a layer name and a file's source text, return
 * the raw violation descriptors (rule/line/message/why/expected) it
 * triggers. No severity/exception/module wrapping — that happens in
 * pushViolation so this stays trivially unit-testable with in-memory
 * source strings.
 *
 * @param {string} layer One of the known layer names.
 * @param {string} source The file's source text.
 * @param {{maxJsxDepth?: number, maxJsxBranches?: number}} [opts] COMPONENT-006's
 *   complexity budget overrides (#508) -- additive, optional; every existing
 *   call site that omits it keeps the built-in defaults.
 */
export function detectLayerViolations(layer, source, opts = {}) {
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

    // #508 -- COMPONENT-005: no inline conditional/loop logic in a
    // component's JSX (mirrors the still-unbuilt PAGE-008, #505, applied to
    // defineComponent instead of definePage). Shape detection lives in
    // packages/ast/jsxComplexity.mjs so a future PAGE-008 can reuse it
    // verbatim; deliberately independent of the `expressions` layer's own
    // types (#503, also not yet built) -- purely syntactic.
    const inlineLogic = collectInlineJsxLogic(ast);
    if (inlineLogic.length) out.push({
      rule: 'COMPONENT-005', line: lineOf(source, inlineLogic[0].node.range[0]),
      message: `Component contains inline ${inlineLogic[0].kind === 'loop' ? 'loop' : 'conditional'} logic in its JSX.`,
      why: 'Conditional/loop rendering is control flow, not presentation — extract it into a named @expression unit so it stays visible, testable and reusable on its own.',
      expected: ['@expression'],
    });

    // #508 -- COMPONENT-006: a component-level JSX complexity budget
    // (nesting depth / inline-branch count), separate from any one
    // Expression's own cap (EXPR-002, #503) -- this measures the composing
    // component's own JSX tree, not any one piece already extracted out of
    // it.
    const complexity = computeJsxComplexity(ast);
    const maxJsxDepth = opts.maxJsxDepth ?? DEFAULT_COMPONENT_MAX_JSX_DEPTH;
    const maxJsxBranches = opts.maxJsxBranches ?? DEFAULT_COMPONENT_MAX_JSX_BRANCHES;
    if (complexity.maxDepth > maxJsxDepth || complexity.branchCount > maxJsxBranches) out.push({
      rule: 'COMPONENT-006', line: 1,
      message: `Component's JSX is too complex (nesting depth ${complexity.maxDepth}, ${complexity.branchCount} inline conditional/loop branch${complexity.branchCount === 1 ? '' : 'es'}; budget is depth ${maxJsxDepth}, ${maxJsxBranches} branches).`,
      why: "A component-level complexity budget, separate from any one Expression's own cap, keeps a single component from growing into an unreviewable JSX tree.",
      expected: ['smaller, composed components and/or @expression units'],
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

  // Epic #185 (#190): structural problems the workflow narrator already knows
  // how to spot, surfaced as default WARNINGS -- a state nothing can ever reach
  // (WORKFLOW-002) and a non-final state nothing can leave (WORKFLOW-003). Only
  // machines the extractor can read are checked; anything it cannot analyze is
  // skipped silently (the Workflows screen already says "can't visualize").
  if (layer === 'workflow') {
    for (const machine of extractMachines(source).machines) {
      // Construct's own scaffold is a one-state machine with no transitions
      // (`states: { idle: {} }`): a placeholder to be filled in, not a flow
      // that traps anything -- so it is exempt from the guardrails.
      if (machine.states.length <= 1 && machine.transitions.length === 0) continue;
      const lineOfState = (statePath) => machine.states.find((st) => st.path === statePath)?.line ?? machine.line ?? 1;
      for (const f of findHealthIssues(machine)) {
        if (f.kind === 'unreachable') out.push({
          rule: 'WORKFLOW-002', line: lineOfState(f.state),
          message: f.message.replace(/\*/g, '"'),
          why: 'A state with no path from the start is dead code: the flow can never be in it.',
          expected: ['a transition into the state, or remove it'],
        });
        else if (f.kind === 'dead-end') out.push({
          rule: 'WORKFLOW-003', line: lineOfState(f.state),
          message: f.message.replace(/\*/g, '"'),
          why: 'A non-final state with no way out traps the flow; either add a transition out or mark it final.',
          expected: ['a transition out of the state, or type: "final"'],
        });
      }
    }
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

export { matchGlob };
export { validateExceptionsShape, exceptionApplies, expiredExceptionViolations } from './exceptions.mjs';

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
  // #23: only when `frozen:` is configured. The index (read-only parse of the
  // frozen sources) is built lazily on the first page/component/controller.
  const frozenGlobs = config.frozen || [];
  const nonLayerGlobs = config.nonLayer || [];
  // #508 -- COMPONENT-006's budget, read from the normalized config (numeric
  // 'value' fields per the 'READ-002-max-loc' shape) once per run, not once
  // per file; undefined when not overridden, so detectLayerViolations falls
  // back to its own built-in defaults.
  const componentComplexityOpts = {
    maxJsxDepth: config.rules['COMPONENT-006-max-depth']?.value,
    maxJsxBranches: config.rules['COMPONENT-006-max-branches']?.value,
  };
  let frozenIndex = null;
  for (const abs of files) {
    if (!FILE_EXTENSIONS.has(path.extname(abs)) || !fs.existsSync(abs)) continue;
    // A frozen file that happens to live inside the project is externally
    // authored: Construct's layer rules don't apply to it.
    if (frozenGlobs.length && matchFrozen(root, abs, frozenGlobs)) continue;
    // #348: declared non-layer paths (e.g. features/*/tests/**) sit outside the layer graph.
    if (nonLayerGlobs.length && isNonLayerPath(root, abs, nonLayerGlobs)) continue;
    const r = rel(root, abs);
    const layer = classifyFile(r, graph);
    if (!layer) {
      checkUnclassified(config, graph, r, out);
      continue;
    }
    const source = fs.readFileSync(abs, 'utf8');
    for (const desc of detectLayerViolations(layer, source, componentComplexityOpts)) {
      pushViolation(config, out, { ...desc, file: r });
    }
    if (frozenGlobs.length && FROZEN_RULE_BY_LAYER[layer]) {
      frozenIndex ||= buildFrozenIndex(root, frozenGlobs);
      const options = config.rules[FROZEN_RULE_BY_LAYER[layer]] || {};
      for (const desc of detectFrozenViolations(layer, source, abs, frozenIndex, { resolveImport: resolveRelativeImport, options })) {
        pushViolation(config, out, { ...desc, file: r });
      }
    }
    checkDanglingImports(config, abs, source, r, out);
    if (!KNOWN_LAYERS.has(layer)) {
      checkGenericEdges(config, graph, root, abs, r, layer, out);
    }
  }

  out.push(...expiredExceptionViolations(config));

  return { violations: out, ok: !out.some((v) => v.severity === 'error') };
}
