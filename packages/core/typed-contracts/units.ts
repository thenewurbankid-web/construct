// #501 -- branded per-layer types. Each `*Unit<...>` is `Brand<Shape,
// 'layer'>` (see brand.ts): structurally it is whatever a unit of that
// layer actually looks like at runtime (a JSX-returning function for the
// four presentation layers, a plain function for the three logic layers),
// nominally it is a distinct type `tsc` will never silently confuse with
// another layer's unit even when the underlying shapes coincide.
//
// This is a hand-written mirror of packages/core/config.mjs's
// `DEFAULT_LAYERS[<layer>].canImport` graph, expressed at the type level
// instead of as a runtime array of strings walked by the import-graph
// checker (architecture-graph.mjs). The two are NOT wired together (this
// phase is additive-only and does not touch config.mjs/architecture-
// enforcer.mjs) -- each `Forbid<Props, Allowed>` use below carries a
// comment citing the exact `canImport` line it mirrors, so the two stay
// auditable against each other by inspection until a later phase (#500
// phase 4) decides whether/how to unify them.
import type { Brand } from './brand.ts';
import type { Template } from './template.ts';

/** Layer names a unit factory can attach `unitLayer` as. */
export type LayerName =
  | 'route' | 'controller' | 'workflow' | 'hook' | 'service' | 'domain' | 'page' | 'component';

/** Every unit factory attaches this alongside the compile-time brand, as a
 * plain, ordinary (non-branded) runtime property -- so tooling (Cockpit,
 * `--llm`, a future registry) can introspect "what layer is this, what is
 * it named" without needing to know anything about the type-level brand,
 * which by design has zero runtime footprint (see brand.ts). Parameterized
 * by the specific layer (not the full `LayerName` union) so e.g. a
 * `ComponentUnit`'s own `unitLayer` is pinned to the literal `'component'`,
 * not merely "some layer or other". */
export interface LayerTag<Layer extends LayerName> {
  readonly unitName: string;
  readonly unitLayer: Layer;
}

// ---- JSX-returning layers (route, controller, page, component) ---------
// Each of these units IS a Template<Props>: a named, callable function that
// takes props and returns JSX.Element on every path.

export type ComponentUnit<Props> = Brand<Template<Props>, 'component'> & LayerTag<'component'>;
export type PageUnit<Props> = Brand<Template<Props>, 'page'> & LayerTag<'page'>;
export type ControllerUnit<Props> = Brand<Template<Props>, 'controller'> & LayerTag<'controller'>;

/** A route's own props (Next.js `params`/`searchParams`-shaped, or nothing
 * for a react-spa route) are deliberately NOT carried in `RouteUnit`'s own
 * type parameter -- per #501's design, `RouteUnit` has no generic, unlike
 * every other unit type. Nothing downstream composes "into" a route (it is
 * the leaf of the import graph — `route.canImport = ['controller']` and
 * nothing imports a route), so there is no call site that would ever need
 * to recover a specific route's exact prop shape from its branded type. */
export type RouteProps = Record<string, unknown>;
export type RouteUnit = Brand<Template<RouteProps>, 'route'> & LayerTag<'route'>;

// ---- Non-JSX layers (workflow, hook, service, domain) -------------------
// These units are plain functions (or, for workflow, a machine-shaped
// value) -- never JSX-returning. Hooks in particular are NOT a Template:
// `useX()` returns whatever local state/handlers it manages, never markup
// (a hook that returned JSX would just be a component with an odd name).

export type DomainUnit<Fn extends (...args: any[]) => any> = Brand<Fn, 'domain'> & LayerTag<'domain'>;
export type ServiceUnit<Fn extends (...args: any[]) => any> = Brand<Fn, 'service'> & LayerTag<'service'>;
export type HookUnit<Fn extends (...args: any[]) => any> = Brand<Fn, 'hook'> & LayerTag<'hook'>;

/** A workflow unit brands a machine-shaped configuration value, not a
 * function -- this mirrors what `extractMachines`
 * (packages/engine/workflowExtractor.mjs) already looks for: a
 * `createMachine({ id, initial, states })`-shaped object literal.
 * `defineWorkflow` (factories.ts) is one of #502's 7 factories
 * (route/controller/workflow/service/domain/page/component); `defineHook`
 * is intentionally NOT among them -- `HookUnit` exists as a branded type
 * (this wave), but its factory (`useTrackedState<T>`/`HOOK-001`) is
 * separate, out-of-scope future work tracked under #500 phase 1. */
export interface WorkflowConfig {
  readonly id: string;
  readonly initial: string;
  readonly states: Record<string, unknown>;
}
export type WorkflowUnit = Brand<WorkflowConfig, 'workflow'> & LayerTag<'workflow'>;

// ---- "any instance of this layer" wildcards, for the Forbid<> checks ----
//
// IMPORTANT: these must NOT be spelled with a literal `any` type argument
// (e.g. `DomainUnit<any>`). `Brand<any, 'x'>` collapses to plain `any`
// (intersecting `any` with anything absorbs into `any`), which would then
// poison every union it appears in -- `X extends (A | any | B)` is always
// true, silently making `Forbid<>` forbid nothing at all. `unknown` does
// not have this problem (`unknown & X` stays `X`), so every wildcard below
// uses `unknown` (or a permissive-but-concrete function shape) instead.
// This was caught empirically while prototyping this file (see the
// invalid-wiring compile-error proof in test/typed-contracts-tsc.test.mjs,
// which would otherwise silently pass with no error at all) -- not a
// theoretical concern.
export type ComponentUnitAny = ComponentUnit<unknown>;
export type PageUnitAny = PageUnit<unknown>;
export type ControllerUnitAny = ControllerUnit<unknown>;
export type DomainUnitAny = DomainUnit<(...args: any[]) => unknown>;
export type ServiceUnitAny = ServiceUnit<(...args: any[]) => unknown>;
export type HookUnitAny = HookUnit<(...args: any[]) => unknown>;

export type AnyUnit =
  | ComponentUnitAny
  | PageUnitAny
  | ControllerUnitAny
  | RouteUnit
  | DomainUnitAny
  | ServiceUnitAny
  | HookUnitAny
  | WorkflowUnit;

/**
 * The mechanism behind step 3's "no type slot that accepts a WorkflowUnit"
 * requirement. `Forbid<Props, Allowed>` maps every property of `Props` to
 * itself, UNLESS that property's type is one of the unit kinds NOT in
 * `Allowed` (i.e. is in `Exclude<AnyUnit, Allowed>`), in which case it maps
 * to `never`. A factory declares its own generic as
 * `<Props extends Forbid<Props, Allowed>>` (F-bounded/self-referential) --
 * `tsc` then rejects any concrete `Props` that has a forbidden-layer-typed
 * property, because that property's real type (e.g. `WorkflowUnit`) can
 * never satisfy `never`. See factories.ts for the per-layer `Allowed` sets
 * (each cites the exact `DEFAULT_LAYERS[...].canImport` line it mirrors),
 * and examples/invalid-wiring.ts for the real `tsc` error this produces.
 */
export type Forbid<Props, Allowed extends AnyUnit> = {
  [K in keyof Props]: Props[K] extends Exclude<AnyUnit, Allowed> ? never : Props[K];
};
