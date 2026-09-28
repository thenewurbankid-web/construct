# Architecture rules, by layer

Reference for what `construct validate` actually enforces today, verified against
`packages/core/config.mjs` (`DEFAULT_LAYERS`, `DEFAULT_RULES`) rather than from memory. Every
rule below carries its **current** default severity (`error` | `warning` | `off` | `info`); an
`off` default is a real, implemented rule a project opts into via
`rules: { RULE-ID: warning }` (or `error`) in `architecture.yml` — see each rule's comment in
`config.mjs` for why it ships off (almost always: a real existing fixture would go red without
the project opting in first).

For the layer contracts themselves (what each layer conceptually owns) see
`docs/ARCHITECTURE.md`. This document is the rule table underneath that.

Originally filed as issue #499 to record a proposed design; every item that was proposed there
has since shipped (issues #503–#512, #495, #506, #644, among others). This document reflects
current, on-`main` behavior, not the original proposal — see "History" at the bottom for the
mapping from the old proposal to what actually landed.

## Import graph

`DEFAULT_LAYERS` (`packages/core/config.mjs`):

```
route → controller → { workflow, hook, service, page, component, domain, expression } → ... → types
```

- `controller` can import: `workflow`, `hook`, `service`, `page`, `component`, `domain`, `types`
- `workflow` can import: `service`, `domain`, `types`
- `hook` can import: `workflow`, `service`, `domain`, `types`
- `service` can import: `domain`, `types`
- `domain` can import: `types` only
- `page` can import: `component`, `types` only
- `component` can import: `component`, `types` only
- `expression` can import: `component`, `types` only (deliberately identical to `component`'s own
  edge — an Expression may compose other component units but can never reach into
  workflow/service/domain/controller)

A React-SPA target (`project.framework: react-spa`) swaps only the `route` layer's pattern
(`src/App.tsx` instead of `app/**/page.tsx`, since routing is centralized in one file rather than
the filesystem); every other layer is identical across frameworks (`REACT_SPA_LAYERS` in
`config.mjs`).

## route (`app/**/page.tsx`, or `src/App.tsx` on react-spa)

| Rule | Severity | What it checks |
|---|---|---|
| `ROUTE-001` | error | Routes delegate to controllers |
| `ROUTE-002` | error | Routes cannot own business logic or effects |
| `ROUTE-003` | off | A route forwards params/searchParams whole instead of reading them, so a raw URL string never travels inward (staleness-by-layer, part of #577) |

## controller (`features/*/controllers/**`)

| Rule | Severity | What it checks |
|---|---|---|
| `CONTROLLER-001` | error | Controllers must compose (import + wire only) — no business logic or raw `fetch()` |
| `CONTROLLER-002` | warning | Controllers wrap frozen (externally-authored) markup instead of reimplementing it |
| `CONTROLLER-003` | off | A controller holds no state of its own (no `useState`/`useRef`/`useEffect`/`useMemo`/`useCallback`), so it binds the hook's live value, never a stale copy (staleness-by-layer, part of #577) |

## workflow (`features/*/workflows/**`)

| Rule | Severity | What it checks |
|---|---|---|
| `WORKFLOW-001` | error | Workflows cannot import React/UI |
| `WORKFLOW-002` | warning | Workflow states must be reachable from the initial state |
| `WORKFLOW-003` | warning | Non-final workflow states must have a way out |
| `WORKFLOW-004` | off | Every non-final workflow state must decide every event the machine handles (transition or explicit ignore) |

## hook (`features/*/hooks/**`)

The gap noted in the original #499 proposal — no dedicated `HOOK-*` rules, only the import graph
and `READ-001`'s naming convention — is closed:

| Rule | Severity | What it checks |
|---|---|---|
| `HOOK-001` | error | A hook named `use<Name>State` must be built through `useTrackedState(...)` (`packages/core/typed-contracts/trackedState.ts`), with nothing unrelated alongside it — the concrete fix for the dogfood-found `useCanvasEditor.tsx` failure class (unrelated canvas-drawing logic filled into a hook with nothing to stop it) |
| `HOOK-002` | error | A hook named `use<Name>Provider` must really be built through `defineProvider(...)` |
| `HOOK-003` | off | A `useEffect` that starts a listener, timer, subscription or request must return its cleanup, so it never outlives its hook (staleness-by-layer, part of #577) |

## service (`features/*/services/**`)

| Rule | Severity | What it checks |
|---|---|---|
| `SERVICE-001` | error | Services own external effects |
| `SERVICE-002` | error | Services cannot import React/UI |
| `SERVICE-003` | off | Services forward the caller's `AbortSignal` to `fetch()` so a superseded request never lands (staleness-by-layer, part of #577) |

## domain (`features/*/domain/**`)

| Rule | Severity | What it checks |
|---|---|---|
| `DOMAIN-001` | error | Domain is pure (denylist: flags `fetch`/`document`/`window`/etc by name — has a known false-positive on a local var merely *named* one of these, no scope analysis: [#492](https://github.com/thenewurbankid-web/construct/issues/492)) |
| `DOMAIN-002` | off | Domain code may only reference its own parameters/local bindings, type-only imports, and a small allowlist of JS built-ins — an allowlist alternative to `DOMAIN-001`'s denylist, additive for now (removing `DOMAIN-001` is phase 4 of #500) |
| `PURE-001` | warning | Domain functions should be deterministic (no `Math.random`, `Date.now`, `new Date()`, `performance.now`, crypto id) |

## page (`features/*/pages/**`)

| Rule | Severity | What it checks |
|---|---|---|
| `PAGE-001` | warning | Pages hold no state or effect of their own (presentation-only) |
| `PAGE-002` | error | Pages cannot import workflows |
| `PAGE-003` | error | Pages cannot import services |
| `PAGE-004` | error | Pages cannot call `fetch` |
| `PAGE-005` | error | Pages cannot import domain logic |
| `PAGE-006` | error | Pages cannot use application state/machines |
| `PAGE-007` | warning | Pages wrap frozen (externally-authored) markup instead of reimplementing it |
| `PAGE-008` | warning | Pages cannot contain inline conditional/loop logic in JSX — must be a named `@expression` unit (sharpens `PAGE-001`'s "presentation-only" into something checkable) |
| `PAGE-009` | warning | Page-level JSX complexity budget (nesting depth / inline conditional-or-loop branch count), separate from any one Expression's own cap; overridable via `PAGE-009-max-depth` / `PAGE-009-max-branches` |

`PAGE-008`/`PAGE-009` default to `warning`, not `error`: a real existing fixture
(`fixtures/frozen-presentation/project-bad/features/cpo/pages/CpoHome.tsx`, a `.map()` render)
already has inline loop logic, so an `error` default would have broken it without the project
opting in — the "not yet decided" question from the original #499 proposal resolved to `warning`.

## component (`features/*/components/**`)

| Rule | Severity | What it checks |
|---|---|---|
| `COMPONENT-001` | warning | Components own no application state machine (presentation-only) |
| `COMPONENT-002` | error | Components cannot import controllers |
| `COMPONENT-003` | error | Components cannot import workflows/services/domain |
| `COMPONENT-004` | warning | Components wrap frozen (externally-authored) markup instead of reimplementing it |
| `COMPONENT-005` | warning | Components cannot contain inline conditional/loop logic in JSX — must be a named `@expression` unit |
| `COMPONENT-006` | warning | Component-level JSX complexity budget, separate from any one Expression's own cap; overridable via `COMPONENT-006-max-depth` / `COMPONENT-006-max-branches` |

## expression (`features/*/expressions/**`) — the new layer

Control-flow units that wrap JSX nodes (If, Switch, ForEach, Show/Hide). `canImport` mirrors
`component`'s own (`['component', 'types']`) — an Expression may compose other component units but
never reach workflow/service/domain/controller. Purely additive: no existing project has a
`features/*/expressions/**` file, so introducing this layer reclassifies zero pre-existing files.

| Rule | Severity | What it checks |
|---|---|---|
| `EXPR-001` | error | Expressions are pure (no side effects) |
| `EXPR-002` | warning | An Expression's own JSX complexity budget (nesting depth / branch count); overridable via `EXPR-002-max-depth` / `EXPR-002-max-branches` |
| `EXPR-003` | warning | Expressions need an unambiguous, non-trivial name — not the bare name of their control-flow kind |
| `EXPR-004` | error | Expressions cannot contain hand-authored JSX beyond wrapping/passthrough — an Expression decides, a component renders |
| `EXPR-005` | error | Expressions must accept `children` and return JSX — guarantees visibility in the Pages tree by construction |
| `EXPR-006` | error | Expressions must be built through `defineExpression(...)` (the shared `Template<Props>` type — see below) |

`EXPR-001/004/005/006` default to `error` (structural, no legacy-code false-positive risk since no
project has this layer yet); `EXPR-002/003` stay `warning` (a numeric budget and a naming
heuristic are guidance, the same category `COMPONENT-006`/`READ-001` already use). This resolves
the original proposal's open question about `EXPR-00x` numbering: no renumbering was needed.

## Cross-cutting (not layer-specific)

| Rule | Severity | What it checks |
|---|---|---|
| `SLICE-001` | error | Feature internals are isolated |
| `SLICE-002` | error | Cross-feature imports use public `index.ts` |
| `SLICE-003` | warning | Public API (`index.ts`) stays in sync with actual feature exports |
| `SLICE-004` | error | A component/Provider re-exported cross-feature must be a distinct wrapper, not a raw re-export/alias of the internal unit — the release point for sharing |
| `MODULE-001` | error | One primary module per file |
| `DRY-001` | warning | Business knowledge has one source of truth |
| `SOC-001` | error | Every responsibility has an architectural owner |
| `READ-001` | error | Components/controllers are PascalCase; hooks are use-prefixed camelCase (known bug: picks a type/interface export over the real component export, suggesting a nonsensical rename — [#493](https://github.com/thenewurbankid-web/construct/issues/493)) |
| `READ-002` | error | Files and functions stay under their length threshold; override via `READ-002-max-loc` |
| `READ-003` | warning | Public API exports document intent with JSDoc |
| `READ-004` | off | A unit's filename encodes its layer as a suffix (`Name.layer.ext`, e.g. `AddWidget.domain.ts`; the hook layer splits further into `.provider.ts`/`.state.ts`/`.hook.ts` per which factory the file calls) |
| `TYPE-001` | off | Code must type-check — a real `tsc --noEmit` run with the project's own TypeScript ([#495](https://github.com/thenewurbankid-web/construct/issues/495)) |
| `IMPORT-001` | error | Relative imports must resolve to a file that exists (known bug: never checks the root `app/page.tsx` — [#491](https://github.com/thenewurbankid-web/construct/issues/491)) |
| `CLIENT-001` | off (error on new projects) | A `'use client'` file cannot import server-only code (a `service`-layer module, `server-only`, a DB/SDK adapter, or a module reading a non-public `process.env` var) |
| `STATE-001` | off | Workflow/hook state is a discriminated union on one status field, not a bag of co-occurring loading/error/data flags |
| `EXCEPTION-EXPIRED` | warning | Time-boxed exceptions must be renewed or removed once they expire |
| `PROP-LINK` | info | A required prop is never passed at some call site, or a call site passes an undeclared prop |

`DOMAIN-002`, `READ-004`, `TYPE-001`, `STATE-001`, `SERVICE-003`, `CONTROLLER-003`, `HOOK-003`,
`ROUTE-003` all default to `off` for the same reason: each is additive and would turn an existing
project (or this repo's own fixtures) red without it opting in first — `NEW_PROJECT_RULE_SEVERITIES`
in `config.mjs` lists the one exception (`CLIENT-001: error`) that `construct init` scaffolds at a
real severity for brand-new projects only.

## The Expression-layer design (typed templates, tracked state, composable units)

This is the mechanism behind the `expression` layer and the `HOOK-001`/`PAGE-008`/`COMPONENT-005`
rules above, all implemented in `packages/core/typed-contracts/`.

### Shared template type

```ts
// packages/core/typed-contracts/template.ts
type Template<Props> = (props: Props) => JSX.Element
```

Every JSX-returning function (Expression, component, page) is written as this type. This moves a
large share of enforcement (return completeness, shape) into `tsc` itself rather than a
hand-written AST rule.

### Typed, pluggable params

Every unit's parameters are a typed interface, including `PropRef<T>`
(`packages/core/typed-contracts/propRef.ts`) — "pick something already in scope of the right
type" rather than a literal value. `propRef(value)` brands a value so a bare `T` is a genuine
compile-time type error where a `PropRef<T>` is expected. This reuses the existing
`describeComponent`/react-docgen introspection (already built for the Components screen) to
auto-generate Cockpit's fill-form per unit — built-in or user-authored — with no bespoke
integration per unit type.

### Factories (`packages/core/typed-contracts/factories.ts`, `provider.ts`)

`defineRoute`, `defineController`, `defineWorkflow`, `defineService`, `defineDomain`,
`definePage`, `defineComponent`, `defineExpression`, `defineProvider` — one factory per layer with
a factory. Each brands its return type to the layer (`packages/core/typed-contracts/brand.ts`,
`units.ts`) and forbids importing another layer's branded unit type where the graph forbids it
(the `Forbid<Props, ...>` type parameter), so the import-graph boundary is enforced by `tsc` at
the call site, not only by the AST-based architecture enforcer.

### Tracked local state (`packages/core/typed-contracts/trackedState.ts`)

`useTrackedState<T>(name, initial)` replaces bare `useState` for any hook that owns tracked local
state. `HOOK-001` requires a hook named `use<Name>State` to be built through it, and to contain
only that state declaration plus its directly-coupled setters/derivations — nothing unrelated.
This is the concrete fix for the `useCanvasEditor.tsx` failure class found during dogfooding
(#490): unrelated business logic (there, HTML5 canvas drawing code) filled into a hook with
nothing in the rule engine to stop it.

## Enforcement model

Two layers, not a replacement of one by the other:

1. **Composition prevents** — units built through the typed-contracts factories can't produce
   most violations, because the generation path only ever produces valid shapes (typed params
   limit what a unit can reach; `Template<Props>` limits what it can return).
2. **Validation catches what slips through** — anything hand-edited afterward, or imported from
   outside, still needs `construct validate` as the safety net, including a real `tsc --noEmit`
   pass once a project opts into `TYPE-001` ([#495](https://github.com/thenewurbankid-web/construct/issues/495)).

## History: proposal → what shipped

The original #499 proposal marked the `expression` layer, the shared template type, typed
pluggable params, `PAGE-008`/`PAGE-009`, and tracked local state as **(proposed)**. All of it has
since shipped on `main`:

| Proposed in #499 | Shipped as |
|---|---|
| `expression` layer + `EXPR-001..006` | #503, `DEFAULT_LAYERS.expression`, `EXPR-*` in `DEFAULT_RULES` |
| Shared `Template<Props>` type | `packages/core/typed-contracts/template.ts` |
| Typed, pluggable params + `PropRef<T>` | #502, `packages/core/typed-contracts/propRef.ts` |
| `PAGE-008`/`PAGE-009` | #505 |
| Component mirror of the same (not originally proposed, added for symmetry) | `COMPONENT-005`/`COMPONENT-006` |
| Tracked local state / `HOOK-001` | #504, `packages/core/typed-contracts/trackedState.ts` |
| `TYPE-001` (`tsc` as a validate rule) | #495 |
| Cross-feature re-export rule (not originally proposed) | #509, `SLICE-004` |
| Filename-encodes-layer convention | #512, `READ-004` |

The one item from the original proposal not reflected above as a distinct rule is the Cockpit
"Wrap with…" context-menu UI — still a design-pass item per the standing instruction that Cockpit
UI changes go through the `designer` agent first; not tracked in this document since it is UI, not
an architecture rule.
