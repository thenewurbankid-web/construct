// #502 -- PropRef<T>: "reference something already in scope of type T",
// as opposed to a literal value. This is the mechanism the Cockpit
// fill-form generator (future work, not this wave) will key off: a prop
// typed `PropRef<ComponentUnit<HeaderProps>>` means "let the user PICK an
// already-defined component unit from this scope", where a prop typed
// plainly `ComponentUnit<HeaderProps>` (or `string`, `number`, etc.) means
// "let the user TYPE a value in". The existing `describeComponent`/
// react-docgen introspection (already built for the Components screen) can
// read a unit's declared prop types and, per-prop, ask "is this a PropRef"
// to decide which control to render -- reused, not reinvented, per #502.
import type { RefBrand } from './brand.ts';

/**
 * `PropRef<T>` is `T`, branded, so it is a genuine compile-time type error
 * to pass a bare `T` (or an unrelated literal) where a `PropRef<T>` is
 * expected, and vice versa -- exactly the same nominal-typing idiom as
 * every `*Unit<...>` type in units.ts (see brand.ts's module doc comment
 * for why `PropRef` needs its OWN symbol channel, not the layer brand's).
 * Constructed only through `propRef()` below, so "this came from
 * `propRef()`" is a real, checkable fact, not a convention.
 */
export type PropRef<T> = RefBrand<T>;

/**
 * Wrap an already-in-scope value of type `T` as a `PropRef<T>` -- the
 * runtime identity function behind the type-level distinction above. A
 * plain value of type `T` does not satisfy a `PropRef<T>`-typed slot
 * without going through this (see
 * test/typed-contracts-tsc.test.mjs / examples/invalid-wiring.ts for the
 * compile-error proof).
 *
 * @example
 * const headerRef: PropRef<ComponentUnit<HeaderProps>> = propRef(Header);
 */
export function propRef<T>(value: T): PropRef<T> {
  return value as PropRef<T>;
}
