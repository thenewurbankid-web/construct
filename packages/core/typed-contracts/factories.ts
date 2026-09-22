// #502 -- one defineX<Props>(name, fn) factory per layer. `name` is
// required and IS the unit's name -- this removes the READ-001
// naming-by-guessing problem for anything built through this pattern (no
// AST inference from a variable/export name needed; the name is simply
// given). Each factory's own generic constraint on `Props` is the real
// import-boundary enforcement described in units.ts's `Forbid<>` doc
// comment: a `Props` type with a forbidden-layer-typed property is a
// genuine `tsc` error AT THE `defineX(...)` CALL SITE, before the unit is
// ever composed into anything else -- "composition prevents" (#499's
// enforcement model), not a pattern match run after the fact.
//
// This file does NOT touch architecture-enforcer.mjs or config.mjs, and
// nothing here is wired into `construct validate` yet -- per #500's
// explicit phase-1 scope, the existing denylist rules (ROUTE-002,
// CONTROLLER-001, WORKFLOW-001, SERVICE-002, PAGE-004, DOMAIN-001, ...)
// keep running completely unchanged, whether or not a project uses any of
// this.
import type { Template } from './template.ts';
import type {
  AnyUnit,
  ComponentUnit,
  ComponentUnitAny,
  ControllerUnit,
  ControllerUnitAny,
  DomainUnit,
  DomainUnitAny,
  Forbid,
  HookUnitAny,
  PageUnit,
  PageUnitAny,
  RouteProps,
  RouteUnit,
  ServiceUnit,
  ServiceUnitAny,
  WorkflowConfig,
  WorkflowUnit,
} from './units.ts';

/** Shared by every factory below: wrap `fn` in a fresh delegating function
 * carrying the given name (both as a plain, introspectable `unitName`
 * property, and as the function's own real `.name`, since an arrow
 * function passed in is otherwise anonymous or carries whatever name its
 * call-site variable happened to have) and the fixed `unitLayer`
 * discriminator, then brand the result.
 *
 * Wraps rather than mutating `fn` in place -- an earlier version of this
 * function used `Object.assign(fn, {...})` directly on the caller's `fn`,
 * which meant passing the SAME function reference through two different
 * `defineX` calls (e.g. `defineDomain('a', f)` then `defineService('b',
 * f)`) let the second call's tag silently overwrite the first, since both
 * calls returned the one shared, mutated object. Caught by
 * test/typed-contracts.test.mjs's "two units of different layers built
 * from structurally identical functions stay runtime-distinguishable"
 * case. Wrapping also avoids mutating a `fn` the caller may have frozen or
 * still holds their own reference to.
 *
 * The brand cast goes through `unknown` because the runtime object (`unit`
 * plus `{ unitName, unitLayer }`) and the branded type do not structurally
 * overlap (the brand's tag property does not exist at runtime -- see
 * brand.ts) -- this is the one, deliberate escape hatch every factory uses
 * exactly once. */
function tagUnit<Fn extends (...args: any[]) => any, Branded>(
  name: string,
  fn: Fn,
  unitLayer: string,
): Branded {
  function unit(...args: any[]) {
    return fn(...args);
  }
  Object.defineProperty(unit, 'name', { value: name, configurable: true });
  return Object.assign(unit, { unitName: name, unitLayer }) as unknown as Branded;
}

// ---- component / page -----------------------------------------------
// Mirrors DEFAULT_LAYERS.component.canImport = ['component', 'types'] and
// DEFAULT_LAYERS.page.canImport = ['component', 'types'] (config.mjs) --
// both may only reference other component units (`types` is a type-only
// import, not a unit kind, so it has no slot here at all).

export function defineComponent<Props extends Forbid<Props, ComponentUnitAny>>(
  name: string,
  fn: Template<Props>,
): ComponentUnit<Props> {
  return tagUnit(name, fn, 'component');
}

export function definePage<Props extends Forbid<Props, ComponentUnitAny>>(
  name: string,
  fn: Template<Props>,
): PageUnit<Props> {
  return tagUnit(name, fn, 'page');
}

// ---- controller --------------------------------------------------------
// Mirrors DEFAULT_LAYERS.controller.canImport =
// ['workflow', 'hook', 'service', 'page', 'component', 'domain', 'types']
// -- the widest composition slot of any layer, matching CONTROLLER-001's
// "controllers compose (import + wire only)".

type ControllerAllowed = WorkflowUnit | HookUnitAny | ServiceUnitAny | PageUnitAny | ComponentUnitAny | DomainUnitAny;

export function defineController<Props extends Forbid<Props, ControllerAllowed>>(
  name: string,
  fn: Template<Props>,
): ControllerUnit<Props> {
  return tagUnit(name, fn, 'controller');
}

// ---- route ---------------------------------------------------------
// Mirrors DEFAULT_LAYERS.route.canImport = ['controller'] -- a route's
// props may only reference a controller unit. `RouteUnit` itself has no
// generic (see units.ts), so a route's specific Props type is checked at
// the `defineRoute` call site but not preserved in the returned type.

export function defineRoute<Props extends Forbid<Props, ControllerUnitAny>>(
  name: string,
  fn: Template<Props>,
): RouteUnit {
  return tagUnit(name, fn as unknown as Template<RouteProps>, 'route');
}

// ---- workflow ------------------------------------------------------
// Mirrors DEFAULT_LAYERS.workflow.canImport = ['service', 'domain',
// 'types']. A workflow is not JSX-returning -- `fn` builds a
// `WorkflowConfig` (a `createMachine({...})`-shaped value; see units.ts)
// from its props, not markup.

type WorkflowAllowed = ServiceUnitAny | DomainUnitAny;

export function defineWorkflow<Props extends Forbid<Props, WorkflowAllowed>>(
  name: string,
  fn: (props: Props) => WorkflowConfig,
): WorkflowUnit {
  return tagUnit(name, fn, 'workflow');
}

// ---- service ---------------------------------------------------------
// Mirrors DEFAULT_LAYERS.service.canImport = ['domain', 'types'].

export function defineService<Props extends Forbid<Props, DomainUnitAny>, Return>(
  name: string,
  fn: (props: Props) => Return,
): ServiceUnit<(props: Props) => Return> {
  return tagUnit(name, fn, 'service');
}

// ---- domain ------------------------------------------------------------
// Mirrors DEFAULT_LAYERS.domain.canImport = ['types'] -- domain has NO
// unit-kind dependency at all. `Allowed` is `never` below, so
// `Forbid<Props, never>` forbids every unit kind (`Exclude<AnyUnit,
// never>` is the full `AnyUnit` union) in a domain function's props.
// This is purity enforced structurally, by construction, for anything
// wired through `defineDomain` -- distinct from (and additive alongside)
// the existing runtime DOMAIN-001 AST check in architecture-enforcer.mjs,
// which is untouched and still catches a smuggled `fetch`/`window`/etc.
// reference that never went through this factory at all.

export function defineDomain<Props extends Forbid<Props, never>, Return>(
  name: string,
  fn: (props: Props) => Return,
): DomainUnit<(props: Props) => Return> {
  return tagUnit(name, fn, 'domain');
}

export type { AnyUnit };
