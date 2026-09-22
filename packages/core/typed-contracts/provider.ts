// #510 (part of #500's Phase 1) -- defineProvider<Props, Value>(name, fn): the sanctioned way a
// component/page reaches shared context/store or service-backed data, per #499's "Components,
// Providers and feature boundaries" design. Same factory family as factories.ts's defineX (a
// required `name`, typed params as the real import-boundary enforcement), but Providers are not a
// single tagged function the way every other unit is -- a Provider is a PAIR (a wrapping component
// + a consuming hook) built on React's OWN Context mechanism, not a custom registry/lookup (owner
// decision, 2026-09-22, mid-task on #510): this is the same idea as Angular's DI -- a value provided
// once, consumed anywhere below without threading it through every intermediate component's props --
// but native to React, so no new dependency is needed. Concretely:
//   - `ProviderComponent` wraps a subtree in `<Context.Provider value={fn(props)}>` ONCE.
//   - `useProvider()` reads that value via `useContext` from ANYWHERE below, with zero prop-drilling.
//
// Two legitimate usage patterns (#499's "Components, Providers and feature boundaries" comment),
// both proven for real (compiled and type-checked, not just asserted) in examples/providers.ts:
//   (a) a component wires its OWN Provider internally -- a fully self-contained, reusable "package"
//       that always means the same thing wherever it's used (it renders `ProviderComponent` around
//       its own returned JSX, then calls `useProvider()` in a child of that same subtree).
//   (b) the SAME Provider is imported by a DIFFERENT feature's own presentational component and
//       wired around THAT feature's tree instead -- same API shape (`useProvider()`'s Value type),
//       different data source per call site (different `fn`, e.g. mock vs. real service, injected
//       via `Props` at each `ProviderComponent` call).
// Which pattern to use is a design choice, not a technical constraint -- both compile against the
// exact same `ProviderUnit<Props, Value>` shape.
//
// Not added to units.ts's `AnyUnit`/`Forbid<>` machinery deliberately: that mechanism governs what
// TYPE a unit's Props may reference (compile-time composition), but a Provider is consumed by a
// component/page IMPORTING and CALLING `useProvider()` directly inside its own function body, not by
// receiving it as a typed prop -- an import-graph concern, not a Props-shape concern. That side is
// enforced separately, deterministically, by HOOK-002/PAGE-006 in architecture-enforcer.mjs (a hook
// exported as `use<Name>Provider` must really be built via `defineProvider`, and that exact naming
// convention is what lets a page import it without tripping PAGE-006's hook-import ban).
import * as React from 'react';
import type { Template } from './template.ts';
import type { Brand } from './brand.ts';
import type { Forbid, WorkflowUnit, ServiceUnitAny, DomainUnitAny, LayerTag } from './units.ts';

// Mirrors DEFAULT_LAYERS.hook.canImport = ['workflow', 'service', 'domain', 'types']
// (packages/core/config.mjs) -- a Provider's own construction may only reference
// workflow/service/domain units, exactly like any other hook. This is real enforcement, not
// decoration: `defineProvider<Props extends Forbid<Props, ProviderAllowed>>` rejects a `Props` that
// smuggles in a ComponentUnit/PageUnit at the `defineProvider(...)` call site itself, the same
// "composition prevents" guarantee every other defineX factory gives (see factories.ts).
type ProviderAllowed = WorkflowUnit | ServiceUnitAny | DomainUnitAny;

/** Sentinel distinguishing "useProvider() called outside its ProviderComponent" from "the computed
 * value legitimately IS undefined" -- a plain `undefined` default would conflate the two. Never
 * exposed outside this module. */
const NOT_PROVIDED: unique symbol = Symbol('typed-contracts.provider.not-provided');

/** The pair `defineProvider` returns. Branded (via `Brand<..., 'hook'>`, same channel as
 * `HookUnit`/units.ts) as belonging to the `hooks/` layer -- structurally a `{ ProviderComponent,
 * useProvider }` bag, nominally a distinct type `tsc` will not confuse with a bare `HookUnit` or any
 * other layer's unit even where shapes might coincide. */
export type ProviderUnit<Props, Value> = Brand<
  {
    /** Render this ONCE around the subtree that will call `useProvider()` -- pattern (a): the
     * component that defines the Provider wraps its OWN return value; pattern (b): a different
     * feature's component wraps ITS tree instead, with its own `Props` (its own data source). A
     * `Template`, so it composes exactly like any other JSX-returning unit. */
    readonly ProviderComponent: Template<Props & { children?: React.ReactNode }>;
    /** Reads the computed value from context -- callable from ANY descendant of
     * `ProviderComponent`, arbitrarily deep, with no prop threaded through the components in
     * between (the actual prop-drilling fix). Throws a clear error if called outside that subtree,
     * rather than silently returning `undefined`. */
    readonly useProvider: () => Value;
  },
  'hook'
> &
  LayerTag<'hook'>;

/**
 * `defineProvider<Props, Value>(name, fn)` -- builds a `ProviderUnit<Props, Value>` on React
 * Context. `fn(props)` computes the shared value once per `ProviderComponent` render (e.g. calling
 * a mock or real service unit, per the existing "mock | real per service" switch -- CLAUDE.md -- so
 * a Provider-using component stays safe to preview on the visual canvas without any new
 * infrastructure).
 *
 * @example
 * // features/cart/hooks/useCartProvider.ts
 * const CartProvider = defineProvider<{ fetchTotal: typeof fetchCartTotal }, { total: number }>(
 *   'Cart',
 *   ({ fetchTotal }) => ({ total: fetchTotal() }),
 * );
 * export const CartProviderRoot = CartProvider.ProviderComponent;
 * export const useCartProvider = CartProvider.useProvider; // naming convention HOOK-002 checks for
 */
export function defineProvider<Props extends Forbid<Props, ProviderAllowed>, Value>(
  name: string,
  fn: (props: Props) => Value,
): ProviderUnit<Props, Value> {
  const Context = React.createContext<{ value: Value } | typeof NOT_PROVIDED>(NOT_PROVIDED);
  Context.displayName = name;

  function ProviderComponent(props: Props & { children?: React.ReactNode }): JSX.Element {
    const { children, ...rest } = props;
    const value = fn(rest as Props);
    return React.createElement(Context.Provider, { value: { value } }, children as React.ReactNode);
  }
  Object.defineProperty(ProviderComponent, 'name', { value: `${name}ProviderComponent`, configurable: true });

  function useProvider(): Value {
    const ctx = React.useContext(Context);
    if (ctx === NOT_PROVIDED) {
      throw new Error(
        `${name}: useProvider() was called outside its ProviderComponent's subtree -- render ` +
          `${name}ProviderComponent somewhere above the component calling useProvider().`,
      );
    }
    return (ctx as { value: Value }).value;
  }
  Object.defineProperty(useProvider, 'name', { value: `use${name}Provider`, configurable: true });

  return { ProviderComponent, useProvider, unitName: name, unitLayer: 'hook' } as unknown as ProviderUnit<Props, Value>;
}
