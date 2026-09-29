// #549 (part of #542's epic, "Rules 3") -- a read-only metadata catalog of every rule
// `construct validate` can report: id, owning module, the layer(s) it applies to, whether it
// only needs one file's own source (`scope: 'buffer'`) or the whole project graph
// (`scope: 'project'`), its default severity, why it exists, what a passing file looks like
// (`expected`), and a fix hint. This is the data source for `construct rules list` and the
// `GET /api/rules` endpoint (docs/RULES.md), which in turn feed #395's Cockpit Rules screen and
// any generated rules doc.
//
// Deliberately NOT #545 ("[Rules 2] Per-rule catalog: uniform rule contract, one file plus
// fixture pair per rule, migrated rule by rule"): #545 is a careful, gated migration of each
// rule's actual *detection* logic out of architecture-enforcer.mjs/soc-enforcer.mjs/
// readability-enforcer.mjs into one file + fixture pair per rule, byte-identical to the existing
// golden output. This module changes none of that: every `why`/`expected`/`fix` string below is
// copied verbatim from where the real enforcers already emit it (or, where a rule fires from more
// than one call site with different text, summarizes them together -- each such rule is noted
// below). Detection stays exactly where it is; this is read-only, additive metadata for LISTING a
// rule, not for enforcing it. Until #545 lands (at which point this table likely becomes
// generated from the per-rule files instead of hand-maintained), a new rule or a changed
// why/expected/fix string must be kept in sync here by hand.
import { DEFAULT_RULES, loadConfig } from './config.mjs';

/** The three `module` values `packages/core/diagnostics.mjs`'s `VALID_MODULES` accepts on a real
 * violation. SOC-001 is a documented exception: soc-enforcer.mjs's own `checkOwnership` is its
 * primary/canonical detector (module 'separation-of-concerns', matching the rule's name and
 * intent), but architecture-enforcer.mjs's `checkGenericEdges`/`checkUnclassified` fallback path
 * (for a custom, project-defined layer with no hardcoded rule set) also emits a SOC-001 violation,
 * tagged 'architecture' there since every violation `pushViolation` in that file produces carries
 * that module unconditionally. This catalog lists SOC-001 under its canonical
 * 'separation-of-concerns' module; a real violation from the fallback path may still say
 * 'architecture'. Fixing that inconsistency is detection-logic work, out of scope here. */
const MODULES = Object.freeze({ ARCHITECTURE: 'architecture', SOC: 'separation-of-concerns', READABILITY: 'readability' });

/** `scope: 'buffer'` rules need only the one file's own source text to decide (the same input a
 * live editor buffer already has, per #550's future lintBuffer). `scope: 'project'` rules need the
 * whole project graph, multiple files, or an external process (tsc). The buffer/project split for
 * PAGE-004/006/008/009, COMPONENT-002/003/005/006, ROUTE-001/002, CONTROLLER-001, DOMAIN-001/002,
 * EXPR-*, HOOK-001/002, WORKFLOW-001/002/003, SERVICE-002 (buffer) and IMPORT-001, SOC-001,
 * DRY-001, SLICE-001/002/004, MODULE-001, READ-* (project) is copied verbatim from issue #545's
 * own classification. Every other id below was classified here from its real detector: PAGE-001/
 * 002/003/005/007, COMPONENT-001/004, CONTROLLER-002/003, ROUTE-003, SERVICE-001/003, HOOK-003,
 * WORKFLOW-004, STATE-001 read only their own file's source/AST, same as their #545-classified
 * siblings, so they are 'buffer'; PAGE-007/COMPONENT-004/CONTROLLER-002 additionally need a
 * project-wide frozen-file index (`buildFrozenIndex`) to compare against, so they are 'project';
 * CLIENT-001 (its own source comment: "Project-scope -- the client set is a walk over the import
 * graph"), TYPE-001 (a whole-program tsc run), SLICE-003 (compares index.ts's exports against
 * every real file/call site in the feature), PROP-LINK (cross-file call-site analysis) and
 * EXCEPTION-EXPIRED (checked once over the whole config, not any one file) are 'project'. */
const SCOPE = Object.freeze({ BUFFER: 'buffer', PROJECT: 'project' });

const NO_LAYERS = [];

/**
 * The static per-rule metadata table: `id -> {module, layers, scope, defaultSeverity, why,
 * expected, fix}`. `defaultSeverity`/`name` mirror `DEFAULT_RULES` (`packages/core/config.mjs`);
 * `why`/`expected`/`fix` (`fix` is the rule's `suggestedFix` text where a real one exists at its
 * call site(s), else `null`) are copied from the enforcer that actually emits each rule.
 * @type {Record<string, {module: string, layers: string[], scope: 'buffer'|'project', why: string, expected: string[], fix: string|null}>}
 */
export const RULE_METADATA = {
  'ROUTE-001': {
    module: MODULES.ARCHITECTURE, layers: ['route'], scope: SCOPE.BUFFER,
    why: 'Routes are navigation entry points and must delegate.',
    expected: ['controller'], fix: null,
  },
  'ROUTE-002': {
    module: MODULES.ARCHITECTURE, layers: ['route'], scope: SCOPE.BUFFER,
    why: 'Routes must remain thin.',
    expected: ['controller'], fix: null,
  },
  'ROUTE-003': {
    module: MODULES.ARCHITECTURE, layers: ['route'], scope: SCOPE.BUFFER,
    why: 'a URL param that no longer names anything must become a typed not-found state once, in a domain parser; a route that reads the raw string lets it travel inward and go stale',
    expected: ['return <OrderController params={params} />; // forward params whole; parse<Name>Route in a domain unit turns them into found / not-found'],
    fix: 'return <OrderController params={params} />; // forward params whole; parse<Name>Route in a domain unit turns them into found / not-found',
  },
  'PAGE-001': {
    module: MODULES.ARCHITECTURE, layers: ['page'], scope: SCOPE.BUFFER,
    why: 'Pages are presentation-only: they compose components. State and effects belong in a hook, controller or workflow (a component may hold local UI state, a page may not).',
    expected: ['controller', 'hook', 'component'],
    fix: 'Move the state/effect into a hook (features/<feature>/hooks/use<Name>State.ts, built through useTrackedState) or the controller, and pass the result down as props.',
  },
  'PAGE-002': {
    module: MODULES.ARCHITECTURE, layers: ['page'], scope: SCOPE.BUFFER,
    why: 'Pages are presentation-only.',
    expected: ['component', 'types'], fix: null,
  },
  'PAGE-003': {
    module: MODULES.ARCHITECTURE, layers: ['page'], scope: SCOPE.BUFFER,
    why: 'Pages are presentation-only.',
    expected: ['component', 'types'], fix: null,
  },
  'PAGE-004': {
    module: MODULES.ARCHITECTURE, layers: ['page'], scope: SCOPE.BUFFER,
    why: 'Pages cannot own application flow.',
    expected: ['controller', 'workflow'], fix: null,
  },
  'PAGE-005': {
    module: MODULES.ARCHITECTURE, layers: ['page'], scope: SCOPE.BUFFER,
    why: 'Pages are presentation-only.',
    expected: ['component', 'types'], fix: null,
  },
  'PAGE-006': {
    module: MODULES.ARCHITECTURE, layers: ['page'], scope: SCOPE.BUFFER,
    why: 'Pages cannot own application flow — hooks are wired in by a controller, not imported directly by a page (a Provider hook, named use<Name>Provider, or a tracked-state hook, named use<Name>State, are the two sanctioned exceptions).',
    expected: ['controller', 'workflow', 'a Provider hook (use<Name>Provider)', 'a tracked-state hook (use<Name>State)'],
    fix: null,
  },
  'PAGE-007': {
    module: MODULES.ARCHITECTURE, layers: ['page'], scope: SCOPE.PROJECT,
    why: 'Frozen files are the single source of truth for their markup; a same-named copy, a structural duplicate, or a non-thin wrapper in this layer is a fork that will drift. Wrap the frozen component instead.',
    expected: ['import the frozen component and forward props'],
    fix: 'Delete the duplicated markup and import the frozen source instead: render it from a controller and forward props (`<Frozen {...props} />`); put data/gating in hooks/workflows/domain.',
  },
  'PAGE-008': {
    module: MODULES.ARCHITECTURE, layers: ['page'], scope: SCOPE.BUFFER,
    why: 'Conditional/loop rendering is control flow, not presentation — extract it into a named @expression unit so it stays visible, testable and reusable on its own.',
    expected: ['@expression'], fix: null,
  },
  'PAGE-009': {
    module: MODULES.ARCHITECTURE, layers: ['page'], scope: SCOPE.BUFFER,
    why: "A page-level complexity budget, separate from any one Expression's own cap, keeps a single page from growing into an unreviewable JSX tree.",
    expected: ['smaller, composed components and/or @expression units'], fix: null,
  },
  'HOOK-001': {
    module: MODULES.ARCHITECTURE, layers: ['hook'], scope: SCOPE.BUFFER,
    why: 'A hook named use<Name>State may contain only its useTrackedState(...) declaration plus directly-coupled setters/derivations — nothing unrelated (control flow, effects, refs, fetches). This is the concrete fix for the dogfood-found (#490) useCanvasEditor.tsx failure class, where unrelated business logic was filled into a hook with nothing to stop it.',
    expected: ['useTrackedState(...)', 'useTrackedState(...) plus directly-coupled setters/derivations only'],
    fix: null,
  },
  'HOOK-002': {
    module: MODULES.ARCHITECTURE, layers: ['hook'], scope: SCOPE.BUFFER,
    why: 'Provider hooks are the sanctioned way a page/component reaches shared context/store or service-backed data — the use<Name>Provider naming convention that lets PAGE-006 allow importing one directly only holds if every hook named that way really is one.',
    expected: ['defineProvider(...)'], fix: null,
  },
  'HOOK-003': {
    module: MODULES.ARCHITECTURE, layers: ['hook'], scope: SCOPE.BUFFER,
    why: 'an effect that starts a listener, timer, subscription or request and never stops it outlives the hook that owns it, and keeps writing into state that has moved on',
    expected: ["useEffect(() => { const controller = new AbortController(); window.addEventListener('resize', onResize, { signal: controller.signal }); return () => controller.abort(); }, [onResize]);"],
    fix: "useEffect(() => { const controller = new AbortController(); window.addEventListener('resize', onResize, { signal: controller.signal }); return () => controller.abort(); }, [onResize]);",
  },
  'COMPONENT-001': {
    module: MODULES.ARCHITECTURE, layers: ['component'], scope: SCOPE.BUFFER,
    why: 'Components are presentation-only (props plus local UI state); a state machine is application flow, which belongs in a workflow bound by a controller or hook.',
    expected: ['props', 'workflow'],
    fix: 'Move the machine into features/<feature>/workflows/ and pass its state and send-handlers to the component as props.',
  },
  'COMPONENT-002': {
    module: MODULES.ARCHITECTURE, layers: ['component'], scope: SCOPE.BUFFER,
    why: 'Components are reusable presentation and must not depend on the composition layer.',
    expected: ['props', 'component'], fix: null,
  },
  'COMPONENT-003': {
    module: MODULES.ARCHITECTURE, layers: ['component'], scope: SCOPE.BUFFER,
    why: 'Components are reusable presentation and local UI state only.',
    expected: ['props', 'component'], fix: null,
  },
  'COMPONENT-004': {
    module: MODULES.ARCHITECTURE, layers: ['component'], scope: SCOPE.PROJECT,
    why: 'Frozen files are the single source of truth for their markup; a same-named copy, a structural duplicate, or a non-thin wrapper in this layer is a fork that will drift. Wrap the frozen component instead.',
    expected: ['import the frozen component and forward props'],
    fix: 'Delete the duplicated markup and import the frozen source instead: render it from a controller and forward props (`<Frozen {...props} />`); put data/gating in hooks/workflows/domain.',
  },
  'COMPONENT-005': {
    module: MODULES.ARCHITECTURE, layers: ['component'], scope: SCOPE.BUFFER,
    why: 'Conditional/loop rendering is control flow, not presentation — extract it into a named @expression unit so it stays visible, testable and reusable on its own.',
    expected: ['@expression (defineExpression)'], fix: null,
  },
  'COMPONENT-006': {
    module: MODULES.ARCHITECTURE, layers: ['component'], scope: SCOPE.BUFFER,
    why: "A component-level complexity budget, separate from any one Expression's own cap, keeps a single component from growing into an unreviewable JSX tree.",
    expected: ['smaller, composed components and/or @expression units'], fix: null,
  },
  'EXPR-001': {
    module: MODULES.ARCHITECTURE, layers: ['expression'], scope: SCOPE.BUFFER,
    why: 'An Expression is pure control-flow over its own props/children — it must have no side effects, exactly like a domain function.',
    expected: ['a pure function of props/children'], fix: null,
  },
  'EXPR-002': {
    module: MODULES.ARCHITECTURE, layers: ['expression'], scope: SCOPE.BUFFER,
    why: "An Expression is meant to stay a small, focused decision — a complexity budget of its own, separate from any composing component/page's own cap, keeps one from growing into an unreviewable tree.",
    expected: ['smaller, composed Expression units'], fix: null,
  },
  'EXPR-003': {
    module: MODULES.ARCHITECTURE, layers: ['expression'], scope: SCOPE.BUFFER,
    why: 'A generic name like "If"/"Show"/"Switch" says nothing beyond the mechanism every Expression already uses — even a single-branch Expression needs a real, specific name so it stays unambiguous in the Pages tree.',
    expected: ['a specific, descriptive name (e.g. "ShowDiscountBadge", not "If")'], fix: null,
  },
  'EXPR-004': {
    module: MODULES.ARCHITECTURE, layers: ['expression'], scope: SCOPE.BUFFER,
    why: "An Expression decides which already-built piece to render (children, or another named component/expression) — it must never author real markup itself; that is a component's job.",
    expected: ['children', 'an existing @expression or component unit'], fix: null,
  },
  'EXPR-005': {
    module: MODULES.ARCHITECTURE, layers: ['expression'], scope: SCOPE.BUFFER,
    why: 'Every Expression wraps a JSX node it was handed (children) and returns JSX of its own — this is what keeps it visible in the Pages tree by construction.',
    expected: ['a children prop', 'a JSX return value'], fix: null,
  },
  'EXPR-006': {
    module: MODULES.ARCHITECTURE, layers: ['expression'], scope: SCOPE.BUFFER,
    why: 'defineExpression(...) is what actually ties a unit to the shared Template<Props> type tsc enforces — an Expression not built through it has no compile-time guarantee of returning JSX on every path.',
    expected: ['defineExpression(...)'], fix: null,
  },
  'WORKFLOW-001': {
    module: MODULES.ARCHITECTURE, layers: ['workflow'], scope: SCOPE.BUFFER,
    why: 'Workflow logic must be UI-independent.',
    expected: ['service', 'domain', 'types'], fix: null,
  },
  'WORKFLOW-002': {
    module: MODULES.ARCHITECTURE, layers: ['workflow'], scope: SCOPE.BUFFER,
    why: 'A state with no path from the start is dead code: the flow can never be in it.',
    expected: ['a transition into the state, or remove it'], fix: null,
  },
  'WORKFLOW-003': {
    module: MODULES.ARCHITECTURE, layers: ['workflow'], scope: SCOPE.BUFFER,
    why: 'A non-final state with no way out traps the flow; either add a transition out or mark it final.',
    expected: ['a transition out of the state, or type: "final"'], fix: null,
  },
  'WORKFLOW-004': {
    module: MODULES.ARCHITECTURE, layers: ['workflow'], scope: SCOPE.BUFFER,
    why: 'an event with no decision for this state does nothing, and nobody chose that',
    expected: ['a transition for the event in the state, or `EVENT: {}` to ignore it on purpose'],
    fix: 'add a transition for the event in the state, or mark it ignored',
  },
  'STATE-001': {
    module: MODULES.ARCHITECTURE, layers: ['workflow', 'hook'], scope: SCOPE.BUFFER,
    why: 'Independent status flags let the object express states that cannot happen (loading and failed at once, data next to an error); one discriminated `status` field makes each state carry only the fields that exist in it, and an exhaustive switch over it is checked by the compiler.',
    expected: ['a discriminated union on one `status` field'],
    fix: 'replace the fields with a discriminated union on one `status` field',
  },
  'CONTROLLER-001': {
    module: MODULES.ARCHITECTURE, layers: ['controller'], scope: SCOPE.BUFFER,
    why: 'Controllers only compose and wire existing layers together — network calls belong in a service, and conditional/loop/error-handling logic belongs in a hook, workflow, or domain function.',
    expected: ['service', 'hook', 'workflow', 'domain'], fix: null,
  },
  'CONTROLLER-002': {
    module: MODULES.ARCHITECTURE, layers: ['controller'], scope: SCOPE.PROJECT,
    why: 'Frozen files are the single source of truth for their markup; a same-named copy, a structural duplicate, or a non-thin wrapper in this layer is a fork that will drift. Wrap the frozen component instead.',
    expected: ['import the frozen component and forward props'],
    fix: 'Delete the duplicated markup and import the frozen source instead: render it from a controller and forward props (`<Frozen {...props} />`); put data/gating in hooks/workflows/domain.',
  },
  'CONTROLLER-003': {
    module: MODULES.ARCHITECTURE, layers: ['controller'], scope: SCOPE.BUFFER,
    why: 'a controller that stores or memoizes what a hook returned binds a copy taken at an earlier render; reading the hook live on every render is what keeps it from going stale',
    expected: ['const { state, select } = useOrder(); // read the hook live every render; move useState/useRef/useMemo into the hook or workflow'],
    fix: 'const { state, select } = useOrder(); // read the hook live every render; move useState/useRef/useMemo into the hook or workflow',
  },
  'SERVICE-001': {
    module: MODULES.ARCHITECTURE, layers: ['component', 'hook', 'page', 'controller'], scope: SCOPE.BUFFER,
    why: 'Services own external effects (network calls, browser storage, polling timers) -- every other layer must delegate to one so the effect stays mockable, testable and swappable from a single place.',
    expected: ['service'],
    fix: 'Extract the effect call into a service (e.g. features/<feature>/services/<Name>Service.ts) and call it from here through a controller or hook.',
  },
  'SERVICE-002': {
    module: MODULES.ARCHITECTURE, layers: ['service'], scope: SCOPE.BUFFER,
    why: 'Services own external effects, not rendering.',
    expected: ['api', 'domain', 'types'], fix: null,
  },
  'SERVICE-003': {
    module: MODULES.ARCHITECTURE, layers: ['service'], scope: SCOPE.BUFFER,
    why: "a response that arrives after its request was superseded must not land — XState's fromPromise hands the invoked function a signal, aborted when the invoking state exits, and a service that forwards it to fetch is cancelled for free",
    expected: ['({ signal }: { signal: AbortSignal }) => fetch(url, { signal })'],
    fix: '({ signal }: { signal: AbortSignal }) => fetch(url, { signal })',
  },
  'DOMAIN-001': {
    module: MODULES.ARCHITECTURE, layers: ['domain'], scope: SCOPE.BUFFER,
    why: 'Domain is pure by default.',
    expected: ['pure function'], fix: null,
  },
  'DOMAIN-002': {
    module: MODULES.ARCHITECTURE, layers: ['domain'], scope: SCOPE.BUFFER,
    why: 'Domain is pure by default — an allowlist (own parameters/local bindings, type-only imports, a small set of JS built-ins) catches any external reference regardless of its name, unlike a fixed denylist of banned names.',
    expected: ['pure function'], fix: null,
  },
  'PURE-001': {
    module: MODULES.ARCHITECTURE, layers: ['domain'], scope: SCOPE.BUFFER,
    why: 'Domain functions should be deterministic: a clock, a random number or a generated id is an input, not something to reach for, so the function stays testable and replayable.',
    expected: ['pure function'],
    fix: 'Take the value as a parameter (now: number, id: string, rand: () => number) and let the caller supply it.',
  },
  'CLIENT-001': {
    module: MODULES.ARCHITECTURE, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: "A module marked 'use client' (and every module only it pulls in) is bundled and shipped to the browser. Server-only code there leaks secrets and credentials, or breaks the build, because a browser cannot run a database driver or Node's fs.",
    expected: ["a server action ('use server') or a service called from a server component"],
    fix: null,
  },
  'TYPE-001': {
    module: MODULES.ARCHITECTURE, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'the file does not type-check',
    expected: [],
    fix: 'fix the type error or the missing import',
  },
  'IMPORT-001': {
    module: MODULES.ARCHITECTURE, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'A relative import that resolves to nothing points at a typo, or at a file from a later step in the build order that has not been generated yet — this is how Construct enforces generation order.',
    expected: ['a file that exists at the resolved path'],
    fix: 'Create the missing file (check the recommended layer order: domain -> service -> workflow -> hook -> component -> page -> controller), or fix the import path.',
  },
  'EXCEPTION-EXPIRED': {
    module: MODULES.ARCHITECTURE, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'Time-boxed exceptions must be renewed or removed once they expire; an expired exception no longer suppresses violations.',
    expected: ['renew the exception', 'remove the exception'], fix: null,
  },
  'PROP-LINK': {
    module: MODULES.ARCHITECTURE, layers: ['component'], scope: SCOPE.PROJECT,
    why: 'A required prop with no value at a call site silently does nothing there; an attribute a component never reads is either dead or meant for a different element -- react-docgen and the JSX call graph agree neither is a rendering choice.',
    expected: [], fix: null,
  },
  'PARSE-ERROR': {
    module: MODULES.ARCHITECTURE, layers: NO_LAYERS, scope: SCOPE.BUFFER,
    why: 'A file with a syntax error cannot be checked against any layer rule, and could not build if it reached the compiler.',
    expected: ['syntactically valid TypeScript/JSX'],
    fix: 'Fix the syntax error.',
  },
  'SOC-001': {
    module: MODULES.SOC, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'Every responsibility needs an architectural owner (a known layer folder or an explicit shared/).',
    expected: [], fix: null,
  },
  'SLICE-001': {
    module: MODULES.SOC, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'A feature slice must expose a full, predictable set of layer folders (feature slices are mandatory for isolation and ownership) so ownership stays unambiguous.',
    expected: [], fix: 'Run: construct feature create <name>',
  },
  'SLICE-002': {
    module: MODULES.SOC, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'Features may only consume another feature through its public index API.',
    expected: [], fix: null,
  },
  'SLICE-003': {
    module: MODULES.SOC, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: "A stale export in the public API misleads consumers and breaks at import time; the public API should stay in sync with what the feature actually exposes.",
    expected: [], fix: null,
  },
  'SLICE-004': {
    module: MODULES.SOC, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'A component or provider shared across features must go through a distinct wrapper at the public boundary, so the internal unit stays free to change without breaking outside consumers.',
    expected: ['export const Name = (props) => <Internal {...props} /> // a real wrapping function'],
    fix: null,
  },
  'MODULE-001': {
    module: MODULES.SOC, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'One primary module per file keeps files single-purpose and easy to navigate.',
    expected: [], fix: null,
  },
  'DRY-001': {
    module: MODULES.SOC, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'Duplicated logic drifts silently and breaks single-source-of-truth for business rules.',
    expected: ['shared/', 'a common domain/service module'], fix: null,
  },
  'READ-001': {
    module: MODULES.READABILITY, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'Files are named after the PascalCase identifier they export (hooks use-prefixed camelCase) so ownership is obvious from the filename alone, and consistent naming signals React hook-rule eligibility to tooling and reviewers.',
    expected: [], fix: null,
  },
  'READ-002': {
    module: MODULES.READABILITY, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'Long files and functions bundle multiple responsibilities and are harder to review, test, and hand to an AI agent as context.',
    expected: [], fix: null,
  },
  'READ-003': {
    module: MODULES.READABILITY, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: "index.ts is the feature's contract with the rest of the app; undocumented public exports force consumers (and AI agents) to read implementation to learn intent.",
    expected: [], fix: null,
  },
  'READ-004': {
    module: MODULES.READABILITY, layers: NO_LAYERS, scope: SCOPE.PROJECT,
    why: 'A filename that encodes its layer (Name.layer.ext) is a cheap, live signal — a plain string match, no tsc pass needed — that the file matches the defineX(...) call inside it, and improves plain file-tree browsability without opening anything. The route layer is exempt (its filename is framework-dictated).',
    expected: [], fix: null,
  },
};

/**
 * Every rule this catalog knows about, `defaultSeverity`/`name` sourced from `DEFAULT_RULES`
 * (`packages/core/config.mjs`) merged with this file's own `RULE_METADATA`, with no project's
 * `architecture.yml` applied -- see `listRules(root)` for the effective, per-project severity.
 *
 * @returns {{id: string, module: string, layers: string[], scope: 'buffer'|'project', defaultSeverity: string, severity: string, why: string, expected: string[], fix: string|null}[]}
 *   Sorted by `id`.
 * @since 0.11
 *
 * @example
 * catalogRules().find((r) => r.id === 'PAGE-001').defaultSeverity; // => 'warning'
 */
export function catalogRules() {
  return Object.keys(RULE_METADATA)
    .sort()
    .map((id) => {
      const { severity, name } = DEFAULT_RULES[id] ?? {};
      const meta = RULE_METADATA[id];
      return {
        id,
        module: meta.module,
        layers: meta.layers,
        scope: meta.scope,
        defaultSeverity: severity ?? 'error',
        severity: severity ?? 'error',
        why: meta.why || name || id,
        expected: meta.expected,
        fix: meta.fix,
      };
    });
}

/**
 * Every rule `construct validate` can report, with `severity` resolved against `root`'s effective
 * `architecture.yml` (an override there wins over the built-in default). Call with no `root` (or a
 * root with no `architecture.yml`) to get every rule at its built-in default severity.
 *
 * @param {string} [root] Project root that contains (or should contain) `architecture.yml`.
 * @returns {ReturnType<typeof catalogRules>} Sorted by `id`.
 * @since 0.11
 *
 * @example
 * const rules = listRules(root);
 * rules.find((r) => r.id === 'CLIENT-001').severity; // => 'off' unless architecture.yml overrides it
 */
export function listRules(root) {
  const base = catalogRules();
  if (!root) return base;
  const { rules } = loadConfig(root);
  return base.map((r) => ({ ...r, severity: rules[r.id]?.severity ?? r.defaultSeverity }));
}
