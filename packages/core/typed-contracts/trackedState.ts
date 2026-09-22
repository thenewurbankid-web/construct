// #504 (part of #500's Phase 1) -- useTrackedState<T>(name, initial): the sanctioned way a
// hook declares local, tracked state, per #499's "Tracked local state" design. Same factory
// family as every other defineX (factories.ts) in spirit -- a required `name` that IS the
// state's identity, not inferred/guessed from a variable name -- but shaped like React's own
// `useState` (a tuple return, called unconditionally inside a component/hook's body) rather
// than a `defineX(name, fn)` unit, because tracked state is not itself a JSX-returning or
// composable "unit" the way a layer's other units are: it is consumed inline, inside whatever
// hook declares it, never passed around as a typed Props slot the way a Component/Page/Service
// unit is (see units.ts's own doc comment on why `defineHook` was deliberately never built as
// one of the 7 layer factories).
//
// `HOOK-001` (packages/core/architecture-enforcer.mjs) is what makes the `use<Name>State`
// naming convention trustworthy -- a hook named that way must really call `useTrackedState(...)`
// and contain nothing else unrelated -- which in turn is what lets `PAGE-006` allow a page to
// import one directly (#504 narrows the same allowance #510 already added for Provider hooks).
//
// Calls `React.useState` internally, so -- exactly like `defineProvider`'s own `useProvider()`
// (provider.ts's module doc comment) -- this can only ever be exercised for real inside an
// active React render pass; a plain `node:test` process has no such thing, so its *runtime*
// behavior is proven only at the type level (examples/tracked-state.ts,
// test/typed-contracts-tsc.test.mjs) plus a same-identity/signature smoke test in
// test/typed-contracts.test.mjs, never by calling it directly at module scope.
import * as React from 'react';

/** The `[value, setValue]` pair `useTrackedState` returns -- structurally identical to
 * `React.useState`'s own return shape, so a hook built on this composes exactly like one built
 * on bare `useState` would, with the one difference HOOK-001 actually enforces: it must be
 * reached through this factory, under a real, given `name`. */
export type TrackedState<T> = readonly [T, React.Dispatch<React.SetStateAction<T>>];

/**
 * `useTrackedState<T>(name, initial)` -- a typed, named wrapper over `React.useState`. `name`
 * is required and is attached as the state's React DevTools debug label (`useDebugValue`), the
 * same "the name is simply given, not inferred" idiom every other `defineX` factory uses
 * (factories.ts's own module doc comment) -- so a tracked-state hook's state is identifiable in
 * DevTools even though, unlike every other layer's unit, nothing here can attach an
 * introspectable `unitName`/`unitLayer` property to a return value that is a plain state tuple,
 * not an object.
 *
 * @example
 * // features/cart/hooks/useCartState.ts
 * export function useCartState() {
 *   const [total, setTotal] = useTrackedState('total', 0);
 *   return { total, setTotal }; // a directly-coupled setter -- HOOK-001 allows this
 * }
 */
export function useTrackedState<T>(name: string, initial: T): TrackedState<T> {
  const state = React.useState<T>(initial);
  React.useDebugValue(name);
  return state;
}
