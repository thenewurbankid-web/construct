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
import { parseToAst, extractImports, extractExports, staticImportEntries, lineOf, collectCalls, collectBareIdentifierUsages, collectControlFlowNodes, collectInlineJsxLogic, computeJsxComplexity, walkAst, collectImpureDomainReferences, collectBagOfFlagsStates } from '../../packages/ast/index.mjs';
import { extractMachines } from '../../packages/engine/workflowExtractor.mjs';
import { findHealthIssues } from '../../packages/engine/workflowScenarios.mjs';
import { exceptionApplies, validateExceptionsShape, expiredExceptionViolations } from './exceptions.mjs';
import { matchFrozen } from './frozen.mjs';
import { isNonLayerPath } from './nonLayer.mjs';
import { buildFrozenIndex, detectFrozenViolations, FROZEN_RULE_BY_LAYER } from './frozen-detector.mjs';
import { runTypeCheckDetailed } from './type-check.mjs';

export { extractImports };

const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const KNOWN_LAYERS = new Set(['route', 'controller', 'workflow', 'hook', 'service', 'domain', 'page', 'component']);

// #508 -- COMPONENT-006's default JSX complexity budget (overridable via
// architecture.yml's 'COMPONENT-006-max-depth'/'COMPONENT-006-max-branches',
// same numeric-override mechanism as 'READ-002-max-loc'). Illustrative
// defaults, not a load-bearing constant sourced from anywhere else.
const DEFAULT_COMPONENT_MAX_JSX_DEPTH = 6;
const DEFAULT_COMPONENT_MAX_JSX_BRANCHES = 3;

// #505 -- PAGE-009's budget, mirroring COMPONENT-006's defaults exactly (same numeric-override
// mechanism, via 'PAGE-009-max-depth'/'PAGE-009-max-branches' in architecture.yml). A page's own
// composing JSX is held to the same illustrative budget as a component's.
const DEFAULT_PAGE_MAX_JSX_DEPTH = 6;
const DEFAULT_PAGE_MAX_JSX_BRANCHES = 3;

// #503 -- EXPR-002's default budget (overridable via architecture.yml's
// 'EXPR-002-max-depth'/'EXPR-002-max-branches', same mechanism as COMPONENT-006's above).
// Deliberately tighter than COMPONENT-006's: an Expression is meant to stay one small, focused
// decision, not a whole composed screen.
const DEFAULT_EXPRESSION_MAX_JSX_DEPTH = 4;
const DEFAULT_EXPRESSION_MAX_JSX_BRANCHES = 2;

// EXPR-003 -- generic/ambiguous names a real Expression unit must not be published under
// (case-insensitive): the bare name of the control-flow *kind* itself (If/Switch/ForEach/
// Show/Hide, #499's own vocabulary) or another catch-all word that says nothing about WHAT is
// being decided. "No exception for a single-return case" per the design -- a trivial
// single-branch Expression still needs a real, specific name.
const EXPR_GENERIC_NAMES = new Set([
  'if', 'switch', 'foreach', 'show', 'hide', 'when', 'cond', 'conditional', 'loop', 'map',
  'expr', 'expression', 'component', 'unit',
]);

/** Every native (lowercase-tag) JSXElement in `ast`, e.g. `<div>` -- EXPR-004's "hand-authored
 * JSX beyond wrapping/passthrough" detector: an Expression unit decides which already-built
 * piece to render (its own `children`, or another capitalized component/expression reference),
 * it never authors real markup itself (that is COMPONENT-001's job, one layer over). A
 * JSXFragment (`<>...</>`) carries no element identity of its own, so it is exempt -- it can
 * only ever be structural wrapping, never "authored markup". */
function findNativeJsxElement(ast) {
  let hit = null;
  walkAst(ast, {
    enter(node) {
      if (hit) return;
      if (
        node.type === 'JSXElement'
        && node.openingElement.name.type === 'JSXIdentifier'
        && /^[a-z]/.test(node.openingElement.name.name)
      ) {
        hit = node;
      }
    },
  });
  return hit;
}

/** Whether `ast` references the identifier `children` anywhere at all -- destructured from a
 * parameter (`{ children }`), a member access (`props.children`), or a JSX prop
 * (`<X children={...}/>`). Deliberately a raw, unfiltered `walkAst` (not walkForUsage's
 * collectors, which intentionally treat a member/object-key *name* as a non-usage position --
 * exactly the position `props.children` needs to be found in here) -- EXPR-005's "accepts
 * children" half. */
function referencesChildren(ast) {
  let found = false;
  walkAst(ast, {
    enter(node) {
      if (found) return;
      if ((node.type === 'Identifier' || node.type === 'JSXIdentifier') && node.name === 'children') found = true;
    },
  });
  return found;
}

/** Does this import specifier refer to the "react" package or a "react/" subpath
 * (e.g. "react-dom/client" is NOT matched — mirrors the old REACT_IMPORT_RE's intent
 * of "the react package itself or something nested under a react/ path segment"). */
function isReactSpecifier(specifier) {
  return specifier === 'react' || /(^|\/)react\//.test(specifier);
}

/**
 * Whether `source` contains a call to the factory `name` -- EXPR-006/HOOK-002/HOOK-001's shared
 * "factory call present" detection (#521): tolerates an optional explicit generic type argument
 * between the name and the opening paren (e.g. `defineExpression<FooProps>(...)`), the canonical
 * call shape this repo's own `packages/core/typed-contracts/examples/` already use, alongside the
 * plain `defineExpression(...)` shape. A single shared helper so all three checks recognize
 * exactly the same call shapes, rather than three separately-maintained regexes. Exported (#531)
 * so readability-enforcer.mjs's READ-004 suffix detection and packages/engine/palette.mjs's
 * Provider detection reuse this exact check instead of each carrying its own plain-`(`-only regex
 * with the same generic-argument gap.
 *
 * @param {string} name The factory's exported identifier (e.g. `"defineProvider"`).
 * @param {string} source The file's full source text to search.
 * @returns {boolean} `true` when `source` calls `name(...)` or `name<...>(...)`.
 */
export function hasFactoryCall(name, source) {
  return new RegExp(`\\b${name}\\s*(<[^(]*>)?\\s*\\(`).test(source);
}

// #510 -- the naming convention PAGE-006 (below) and HOOK-002 rely on together: a Provider hook
// (built through defineProvider, packages/core/typed-contracts/provider.ts) is exported as
// `use<Name>Provider`. HOOK-002 is what makes that convention trustworthy (a hook named this way
// must really be built through defineProvider), which is what lets PAGE-006 allow a page to import
// one by name alone, without needing to open and re-analyze the target hook file itself.
const PROVIDER_HOOK_NAME_RE = /^use[A-Z]\w*Provider$/;

/**
 * Whether `name` is shaped like a sanctioned Provider hook export (`use<Name>Provider`, #510) --
 * exported (additive, same behavior) so packages/engine/scopeLinks.mjs can reuse the exact same
 * reachability convention for its own Provider-scope-source detection (#528), rather than
 * re-implementing PAGE-006/HOOK-002's naming rule a second time.
 *
 * @param {unknown} name The candidate export name.
 * @returns {boolean} `true` when `name` matches the `use<Name>Provider` convention.
 */
export function isProviderHookName(name) {
  return typeof name === 'string' && PROVIDER_HOOK_NAME_RE.test(name);
}

// #504 -- the second sanctioned hook-import shape PAGE-006 allows, alongside Provider hooks: a
// tracked-state hook (built through useTrackedState(...), packages/core/typed-contracts/
// trackedState.ts), exported as `use<Name>State`. HOOK-001 (below) is what makes this naming
// convention trustworthy, the same way HOOK-002 backs PROVIDER_HOOK_NAME_RE above.
const TRACKED_STATE_HOOK_NAME_RE = /^use[A-Z]\w*State$/;

/**
 * Whether `name` is shaped like a sanctioned tracked-state hook export (`use<Name>State`, #504) --
 * exported alongside `isProviderHookName`, same reason: scopeLinks.mjs's unit-output scope source
 * (#528) reuses this exact convention instead of re-implementing it.
 *
 * @param {unknown} name The candidate export name.
 * @returns {boolean} `true` when `name` matches the `use<Name>State` convention.
 */
export function isTrackedStateHookName(name) {
  return typeof name === 'string' && TRACKED_STATE_HOOK_NAME_RE.test(name);
}

/** Either of PAGE-006's two sanctioned hook-import naming conventions (#510's Provider hook,
 * #504's tracked-state hook) -- the two kinds a page may import directly without tripping
 * PAGE-006's ban on arbitrary hook imports. */
function isSanctionedPageHookName(name) {
  return isProviderHookName(name) || isTrackedStateHookName(name);
}

/** Names bound by an ImportDeclaration's specifiers — the imported (not local/aliased) name for a
 * named/default specifier, or null for a namespace import (`import * as x`), whose individual bound
 * names can't be verified without following every property access, so it is treated conservatively
 * (its one entry is `null`, which never matches a naming convention). */
function importedSpecifierNames(specifiers) {
  return specifiers.map((s) => {
    if (s.type === 'ImportSpecifier') return s.imported?.name ?? s.imported?.value ?? s.local?.name ?? null;
    if (s.type === 'ImportDefaultSpecifier') return s.local?.name ?? null;
    return null; // ImportNamespaceSpecifier
  });
}

// Single layer classifier lives in architecture-graph.mjs (#174); re-exported for callers.
export { classifyFile };

/** Folder token (e.g. "controllers") a layer's pattern lives under, if any. */
function layerFolder(def) {
  return def.pattern?.match(/features\/\*\/([^/]+)\//)?.[1];
}

/**
 * WORKFLOW-004 core: the (state, event) pairs of one extracted workflow machine where an event
 * the machine handles somewhere has no decision. An "event" is any name in an `on:` map of any
 * state; a state decides an event when it (or an ancestor, since XState bubbles events up)
 * lists it in `on:`. The one explicit ignore form is a targetless, action-less, guard-less
 * transition, `EVENT: {}`, which the extractor sees as an `on` edge and so counts as a decision.
 * Only atomic non-final states are checked (a compound/parallel state is decided by its children).
 * Reuses the WORKFLOW-002/003 parse (`extractMachines`); adds no parser.
 *
 * @param {{states:object[], transitions:object[]}} machine A machine from `extractMachines`.
 * @returns {{state:string, event:string, line:number}[]} One entry per hole, ordered by state then event.
 */
export function findTransitionHoles(machine) {
  const on = machine.transitions.filter((t) => t.kind === 'on');
  const events = [...new Set(on.map((t) => t.event))].sort();
  const holes = [];
  for (const st of machine.states) {
    if (st.final || st.type !== 'atomic') continue;
    const decided = new Set();
    for (let p = st.path; p; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '') {
      for (const t of on) if (t.from === p) decided.add(t.event);
    }
    for (const event of events) if (!decided.has(event)) holes.push({ state: st.path, event, line: st.line ?? machine.line ?? 1 });
  }
  return holes;
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
 * @param {{maxJsxDepth?: number, maxJsxBranches?: number, domainPurityAllowlist?: boolean, workflowTransitionTable?: boolean, stateUnion?: boolean}} [opts]
 *   COMPONENT-006/PAGE-009's complexity budget overrides (#508/#505), DOMAIN-002's opt-in
 *   flag (#506), WORKFLOW-004's opt-in flag (#578) and STATE-001's opt-in flag (#581) --
 *   additive, optional; every existing call site that omits them keeps the built-in defaults
 *   (and DOMAIN-002/WORKFLOW-004/STATE-001 off).
 */
export function detectLayerViolations(layer, source, opts = {}) {
  const ast = parseToAst(source);
  const importsList = extractImports(source);
  const staticImports = staticImportEntries(ast);
  const firstImportMatch = (re) => staticImports.find((e) => re.test(e.value));
  const out = [];

  // #581 -- STATE-001 (part of #573), flag-gated like DOMAIN-002/WORKFLOW-004: in the two
  // layers that own application state (workflow, hook), a state shape that is a bag of
  // co-occurring status flags. Detection is packages/ast/stateShape.mjs's
  // collectBagOfFlagsStates (interface / object-literal type alias / useState-useReducer
  // initial object or inline type argument / XState `context`), which also spells out the
  // concrete discriminated-union rewrite carried in `suggestedFix`.
  if (opts.stateUnion && (layer === 'workflow' || layer === 'hook')) {
    for (const s of collectBagOfFlagsStates(ast, source)) out.push({
      rule: 'STATE-001', line: lineOf(source, s.index),
      message: `${s.kind === 'interface' || s.kind === 'type' ? `${s.kind} "${s.name}"` : s.kind === 'initial' ? `initial state "${s.name}"` : `${s.kind} state`} is a bag of flags: ${s.fields.join(', ')} (${s.contradiction}).`,
      why: 'Independent status flags let the object express states that cannot happen (loading and failed at once, data next to an error); one discriminated `status` field makes each state carry only the fields that exist in it, and an exhaustive switch over it is checked by the compiler.',
      suggestedFix: `replace the fields with a discriminated union: ${s.suggestion}${
        s.kind === 'useState' ? `, then useState<${s.typeName}>({ status: 'idle' })`
          : s.kind === 'useReducer' ? `, type the reducer's state as ${s.typeName} and start from { status: 'idle' }`
            : s.kind === 'context' ? `, and type the machine's context as ${s.typeName}` : ''}`,
      expected: ['a discriminated union on one `status` field'],
    });
  }

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
    //
    // #510 -- narrowed: a Provider hook (named `use<Name>Provider`, the sanctioned way a page
    // reaches shared context/store or service-backed data per #499) is allowed through; every
    // other hook import is still banned exactly as before. detectLayerViolations stays pure
    // (source text only, as every other check here does) -- the naming convention itself is what
    // HOOK-002 (below, for the `hook` layer) holds accountable, not a re-read of the target
    // file from here. An import whose specifiers can't all be verified by name (e.g. `import *
    // as hooks from '../hooks/useCart'`) is conservatively still banned.
    //
    // #504 -- narrowed FURTHER: a tracked-state hook (named `use<Name>State`, built through
    // useTrackedState(...) and held accountable by HOOK-001 below, exactly the way HOOK-002
    // backs the Provider naming convention) is now ALSO allowed through, alongside a Provider
    // hook -- isSanctionedPageHookName covers both; every other hook import is still banned
    // exactly as before.
    const bannedHookImport = ast.body.find(
      (n) => n.type === 'ImportDeclaration'
        && /hooks?\//.test(n.source.value)
        && !(n.specifiers.length > 0 && importedSpecifierNames(n.specifiers).every(isSanctionedPageHookName)),
    );
    if (bannedHookImport) out.push({
      rule: 'PAGE-006', line: lineOf(source, bannedHookImport.range[0]), message: 'Page imports a custom hook.',
      why: 'Pages cannot own application flow — hooks are wired in by a controller, not imported directly by a page (a Provider hook, named use<Name>Provider, or a tracked-state hook, named use<Name>State, are the two sanctioned exceptions).',
      expected: ['controller', 'workflow', 'a Provider hook (use<Name>Provider)', 'a tracked-state hook (use<Name>State)'],
    });

    // #505 -- PAGE-008: no inline conditional/loop logic in a page's JSX, mirroring
    // COMPONENT-005 exactly (same detection helper, packages/ast/jsxComplexity.mjs's
    // collectInlineJsxLogic -- reused verbatim, not reimplemented).
    const inlinePageLogic = collectInlineJsxLogic(ast);
    if (inlinePageLogic.length) out.push({
      rule: 'PAGE-008', line: lineOf(source, inlinePageLogic[0].node.range[0]),
      message: `Page contains inline ${inlinePageLogic[0].kind === 'loop' ? 'loop' : 'conditional'} logic in its JSX.`,
      why: 'Conditional/loop rendering is control flow, not presentation — extract it into a named @expression unit so it stays visible, testable and reusable on its own.',
      expected: ['@expression'],
    });

    // #505 -- PAGE-009: a page-level JSX complexity budget, mirroring COMPONENT-006
    // exactly (same detection helper, computeJsxComplexity), separate from any one
    // Expression's own cap.
    const pageComplexity = computeJsxComplexity(ast);
    const maxPageJsxDepth = opts.maxJsxDepth ?? DEFAULT_PAGE_MAX_JSX_DEPTH;
    const maxPageJsxBranches = opts.maxJsxBranches ?? DEFAULT_PAGE_MAX_JSX_BRANCHES;
    if (pageComplexity.maxDepth > maxPageJsxDepth || pageComplexity.branchCount > maxPageJsxBranches) out.push({
      rule: 'PAGE-009', line: 1,
      message: `Page's JSX is too complex (nesting depth ${pageComplexity.maxDepth}, ${pageComplexity.branchCount} inline conditional/loop branch${pageComplexity.branchCount === 1 ? '' : 'es'}; budget is depth ${maxPageJsxDepth}, ${maxPageJsxBranches} branches).`,
      why: "A page-level complexity budget, separate from any one Expression's own cap, keeps a single page from growing into an unreviewable JSX tree.",
      expected: ['smaller, composed components and/or @expression units'],
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
    //
    // #503 -- "@expression unit" is no longer aspirational: `expected` below now names the real
    // factory (defineExpression, packages/core/typed-contracts/factories.ts) an extracted unit
    // is actually built through, so this message is accurate now that the `expression` layer +
    // EXPR-001..006 exist. Detection itself (collectInlineJsxLogic) is unchanged.
    const inlineLogic = collectInlineJsxLogic(ast);
    if (inlineLogic.length) out.push({
      rule: 'COMPONENT-005', line: lineOf(source, inlineLogic[0].node.range[0]),
      message: `Component contains inline ${inlineLogic[0].kind === 'loop' ? 'loop' : 'conditional'} logic in its JSX.`,
      why: 'Conditional/loop rendering is control flow, not presentation — extract it into a named @expression unit so it stays visible, testable and reusable on its own.',
      expected: ['@expression (defineExpression)'],
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
      // #578 -- WORKFLOW-004, flag-gated like DOMAIN-002 (off unless the project opts in).
      if (opts.workflowTransitionTable) {
        for (const h of findTransitionHoles(machine)) out.push({
          rule: 'WORKFLOW-004', line: h.line,
          message: `State "${h.state}" has no decision for event "${h.event}" (handled in other states of "${machine.id}")`,
          why: 'an event with no decision for this state does nothing, and nobody chose that',
          suggestedFix: `add a transition for ${h.event} in ${h.state}, or mark it ignored`,
          expected: [`a transition for ${h.event} in ${h.state}, or \`${h.event}: {}\` to ignore it on purpose`],
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

    // #506 -- DOMAIN-002: an allowlist alternative to DOMAIN-001's name-based denylist above,
    // additive alongside it for now (#500 phase 1 -- removing DOMAIN-001 is phase 4 work, not
    // this ticket). #492 showed the denylist false-positives on a parameter/local variable
    // merely *named* document/window/fetch/etc, since it does no scope analysis; this check
    // (packages/ast/domainPurity.mjs's collectImpureDomainReferences) instead allows only the
    // function's own parameters/local bindings, type-only imports, and a small set of JS
    // built-in globals -- anything else referenced as a real value is flagged regardless of
    // its name, including effects DOMAIN-001's fixed name list can't see (a value import, an
    // arbitrary undeclared global).
    //
    // Flag-gated (opts.domainPurityAllowlist, wired from config.rules['DOMAIN-002'] not being
    // 'off' in validateArchitecture below) rather than unconditional: DOMAIN-002 is stricter
    // than DOMAIN-001 in a way that already shows up on this repo's own DOMAIN-001 fixture (a
    // genuine `fetch(...)` legitimately trips both rules at once), and detectLayerViolations is
    // called directly, bypassing config/severity, by existing unit tests that assert an exact
    // rule list for DOMAIN-001 -- gating inside detectLayerViolations itself (not only via
    // pushViolation's severity check) is what keeps every one of those call sites byte-for-byte
    // unchanged unless a project opts in.
    if (opts.domainPurityAllowlist) {
      const impureRef = collectImpureDomainReferences(ast)[0];
      if (impureRef) out.push({
        rule: 'DOMAIN-002', line: lineOf(source, impureRef.index),
        message: `Domain code references "${impureRef.name}", which is not one of its own parameters/local bindings, a type-only import, or a built-in.`,
        why: 'Domain is pure by default — an allowlist (own parameters/local bindings, type-only imports, a small set of JS built-ins) catches any external reference regardless of its name, unlike a fixed denylist of banned names.',
        expected: ['pure function'],
      });
    }
  }

  // HOOK-002 (#510) -- the first real rule the `hook` layer has (see the module doc comment
  // near PAGE-006 above): a hook exported under the `use<Name>Provider` naming convention is
  // exactly the convention that lets a page import it directly without tripping PAGE-006's
  // hook-import ban. That only holds if every hook named that way really is one -- built through
  // `defineProvider` (packages/core/typed-contracts/provider.ts), not an arbitrary hook that
  // merely opted itself out of PAGE-006 by naming alone.
  if (layer === 'hook') {
    const providerNamedExport = extractExports(source).find((e) => isProviderHookName(e.name));
    if (providerNamedExport && !hasFactoryCall('defineProvider', source)) {
      out.push({
        rule: 'HOOK-002', line: lineOf(source, providerNamedExport.index),
        message: `Hook "${providerNamedExport.name}" is named like a Provider but is not built through defineProvider(...).`,
        why: 'Provider hooks are the sanctioned way a page/component reaches shared context/store or service-backed data — the use<Name>Provider naming convention that lets PAGE-006 allow importing one directly only holds if every hook named that way really is one.',
        expected: ['defineProvider(...)'],
      });
    }

    // HOOK-001 (#504) -- the hooks/ layer's other real rule, alongside HOOK-002: a hook
    // exported under the `use<Name>State` naming convention (the second convention PAGE-006
    // narrows to allow, above) must really be built through `useTrackedState(...)`
    // (packages/core/typed-contracts/trackedState.ts), and may contain ONLY that state
    // declaration plus its directly-coupled setters/derivations -- nothing unrelated. Two
    // independent checks, same "deterministic proxy" idiom as CONTROLLER-001's own
    // control-flow/fetch detection: (1) the factory call itself must be present (mirrors
    // HOOK-002's defineProvider check exactly), (2) no control-flow node and no
    // fetch/useEffect/useRef reference anywhere in the file -- the concrete fix for the
    // dogfood-found (#490) useCanvasEditor.tsx failure class, where an unrelated HTML5
    // canvas-drawing effect (refs, DOM event math) was filled into a hook with nothing to
    // stop it.
    const trackedStateNamedExport = extractExports(source).find((e) => isTrackedStateHookName(e.name));
    if (trackedStateNamedExport) {
      if (!hasFactoryCall('useTrackedState', source)) {
        out.push({
          rule: 'HOOK-001', line: lineOf(source, trackedStateNamedExport.index),
          message: `Hook "${trackedStateNamedExport.name}" is named like tracked state but is not built through useTrackedState(...).`,
          why: 'Tracked-state hooks are the sanctioned way a page reaches local application state — the use<Name>State naming convention that lets PAGE-006 allow importing one directly only holds if every hook named that way really is one.',
          expected: ['useTrackedState(...)'],
        });
      } else {
        const unrelatedControlFlow = collectControlFlowNodes(ast)[0];
        const unrelatedEffect = collectBareIdentifierUsages(ast, new Set(['fetch', 'useEffect', 'useRef']))[0];
        const unrelated = unrelatedControlFlow
          ? { index: unrelatedControlFlow.range[0] }
          : unrelatedEffect;
        if (unrelated) out.push({
          rule: 'HOOK-001', line: lineOf(source, unrelated.index),
          message: `Hook "${trackedStateNamedExport.name}" contains logic beyond its tracked state declaration and directly-coupled setters/derivations.`,
          why: 'A hook named use<Name>State may contain only its useTrackedState(...) declaration plus directly-coupled setters/derivations — nothing unrelated (control flow, effects, refs, fetches). This is the concrete fix for the dogfood-found (#490) useCanvasEditor.tsx failure class, where unrelated business logic was filled into a hook with nothing to stop it.',
          expected: ['useTrackedState(...) plus directly-coupled setters/derivations only'],
        });
      }
    }
  }

  if (layer === 'expression') {
    // EXPR-001 -- pure: no side effects. Same external-effect identifier set DOMAIN-001
    // already uses -- an Expression decides what to render from its own props/children alone,
    // exactly like a domain function decides a value from its own arguments alone.
    const effect = collectBareIdentifierUsages(ast, new Set(['fetch', 'window', 'document', 'localStorage', 'sessionStorage', 'navigator']))[0];
    if (effect) out.push({
      rule: 'EXPR-001', line: lineOf(source, effect.index),
      message: `Expression uses an external effect ("${effect.name}").`,
      why: 'An Expression is pure control-flow over its own props/children — it must have no side effects, exactly like a domain function.',
      expected: ['a pure function of props/children'],
    });

    // EXPR-002 -- bounded complexity, reusing the exact shape detector COMPONENT-006 already
    // uses (packages/ast/jsxComplexity.mjs's computeJsxComplexity, which itself calls
    // collectInlineJsxLogic) rather than reimplementing it, per #503's own brief. Its own
    // (tighter) default budget: an Expression is meant to stay one small, focused piece of
    // control flow, not grow into its own unreviewable tree.
    const complexity = computeJsxComplexity(ast);
    const maxJsxDepth = opts.exprMaxJsxDepth ?? DEFAULT_EXPRESSION_MAX_JSX_DEPTH;
    const maxJsxBranches = opts.exprMaxJsxBranches ?? DEFAULT_EXPRESSION_MAX_JSX_BRANCHES;
    if (complexity.maxDepth > maxJsxDepth || complexity.branchCount > maxJsxBranches) out.push({
      rule: 'EXPR-002', line: 1,
      message: `Expression's JSX is too complex (nesting depth ${complexity.maxDepth}, ${complexity.branchCount} inline conditional/loop branch${complexity.branchCount === 1 ? '' : 'es'}; budget is depth ${maxJsxDepth}, ${maxJsxBranches} branches).`,
      why: "An Expression is meant to stay a small, focused decision — a complexity budget of its own, separate from any composing component/page's own cap, keeps one from growing into an unreviewable tree.",
      expected: ['smaller, composed Expression units'],
    });

    // EXPR-003 -- unambiguous, non-trivial naming: no exception for a single-return case.
    const genericExport = extractExports(source).find((e) => EXPR_GENERIC_NAMES.has((e.name || '').toLowerCase()));
    if (genericExport) out.push({
      rule: 'EXPR-003', line: lineOf(source, genericExport.index),
      message: `Expression "${genericExport.name}" is named after its control-flow kind, not what it decides.`,
      why: 'A generic name like "If"/"Show"/"Switch" says nothing beyond the mechanism every Expression already uses — even a single-branch Expression needs a real, specific name so it stays unambiguous in the Pages tree.',
      expected: ['a specific, descriptive name (e.g. "ShowDiscountBadge", not "If")'],
    });

    // EXPR-004 -- no hand-authored JSX beyond wrapping/passthrough: an Expression decides, a
    // component renders. Any native (lowercase-tag) JSXElement is real authored markup, which
    // belongs one layer over (a component); a bare JSXFragment wrapping children/another
    // component/expression element is the sanctioned shape.
    const nativeJsx = findNativeJsxElement(ast);
    if (nativeJsx) out.push({
      rule: 'EXPR-004', line: lineOf(source, nativeJsx.range[0]),
      message: `Expression contains hand-authored markup ("<${nativeJsx.openingElement.name.name}>").`,
      why: "An Expression decides which already-built piece to render (children, or another named component/expression) — it must never author real markup itself; that is a component's job.",
      expected: ['children', 'an existing @expression or component unit'],
    });

    // EXPR-005 -- must accept `children` and return JSX: guarantees visibility in the Pages
    // tree by construction (a real, checkable shape), not a separate visibility check.
    // `computeJsxComplexity(ast).maxDepth === 0` is reused as "returns no JSX at all" (its walk
    // counts every JSXElement/JSXFragment it descends into).
    if (!referencesChildren(ast) || complexity.maxDepth === 0) out.push({
      rule: 'EXPR-005', line: 1,
      message: 'Expression does not accept children and/or does not return JSX.',
      why: 'Every Expression wraps a JSX node it was handed (children) and returns JSX of its own — this is what keeps it visible in the Pages tree by construction.',
      expected: ['a children prop', 'a JSX return value'],
    });

    // EXPR-006 -- must satisfy the shared Template<Props> type. The type-level guarantee
    // (packages/core/typed-contracts/units.ts's ExpressionUnit<Props>) only applies to a unit
    // actually built through defineExpression(...) -- the same deterministic proxy HOOK-002
    // already uses for defineProvider(...): presence of the real factory call, checked here so
    // `construct validate` can flag it without needing a full type pass of its own.
    if (!hasFactoryCall('defineExpression', source)) out.push({
      rule: 'EXPR-006', line: 1,
      message: 'Expression is not built through defineExpression(...).',
      why: 'defineExpression(...) is what actually ties a unit to the shared Template<Props> type tsc enforces — an Expression not built through it has no compile-time guarantee of returning JSX on every path.',
      expected: ['defineExpression(...)'],
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
  // #503 -- EXPR-002's own budget overrides, same mechanism, passed alongside
  // COMPONENT-006's in the same opts object (detectLayerViolations only reads the
  // exprMaxJsxDepth/exprMaxJsxBranches keys for the `expression` layer).
  const componentComplexityOpts = {
    maxJsxDepth: config.rules['COMPONENT-006-max-depth']?.value,
    maxJsxBranches: config.rules['COMPONENT-006-max-branches']?.value,
    exprMaxJsxDepth: config.rules['EXPR-002-max-depth']?.value,
    exprMaxJsxBranches: config.rules['EXPR-002-max-branches']?.value,
  };
  // #505 -- PAGE-009's budget override, mirroring COMPONENT-006's above exactly.
  const pageComplexityOpts = {
    maxJsxDepth: config.rules['PAGE-009-max-depth']?.value,
    maxJsxBranches: config.rules['PAGE-009-max-branches']?.value,
  };
  // #506 -- DOMAIN-002 only runs once a project opts in (severity isn't the DEFAULT_RULES
  // 'off') -- see the flag-gating note on DOMAIN-002 in detectLayerViolations above.
  const domainPurityAllowlist = config.rules['DOMAIN-002']?.severity !== 'off';
  // #578 -- WORKFLOW-004 opts in the same way.
  const workflowTransitionTable = config.rules['WORKFLOW-004']?.severity !== 'off';
  // #581 -- STATE-001 opts in the same way.
  const stateUnion = config.rules['STATE-001']?.severity !== 'off';
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
    const complexityOpts = layer === 'page' ? pageComplexityOpts : componentComplexityOpts;
    const layerOpts = { ...complexityOpts, domainPurityAllowlist, workflowTransitionTable, stateUnion };
    for (const desc of detectLayerViolations(layer, source, layerOpts)) {
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

  // #495 -- TYPE-001 only runs once a project opts in (severity isn't the DEFAULT_RULES 'off').
  // Whole-program tsc run; when `opts.files` scopes this call, only errors in those files count.
  const typeRule = config.rules['TYPE-001'];
  let typeCheck;
  if (typeRule && typeRule.severity !== 'off') {
    // #579: a solution-style tsconfig is expanded to its referenced projects; `checked` lists the configs really checked.
    const { violations: found, checked } = runTypeCheckDetailed(root, { severity: typeRule.severity, tsconfig: typeRule.tsconfig, timeoutMs: typeRule.timeoutMs, files: opts.files });
    typeCheck = { checked };
    out.push(...found.filter((v) => v.message.startsWith('TYPE-001 could not run') || !exceptionApplies(config, 'TYPE-001', v.file)));
  }

  out.push(...expiredExceptionViolations(config));

  return { violations: out, ok: !out.some((v) => v.severity === 'error'), ...(typeCheck ? { typeCheck } : {}) };
}
