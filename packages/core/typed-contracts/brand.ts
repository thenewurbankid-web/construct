// #501/#502 (part of #500's Phase 1) -- the nominal-typing primitive every
// branded per-layer type and PropRef<T> is built from.
//
// TypeScript has no true nominal typing: two structurally-identical types are
// interchangeable by default. The standard workaround (used by libraries like
// type-fest's Opaque/Tagged, and here) is to intersect a real type with an
// object type keyed by a `unique symbol` that only ever exists at the type
// level. `declare const` produces no runtime value or emitted JS at all --
// the symbol is purely a compile-time tag `tsc` uses to tell two otherwise-
// identical shapes apart. A value is "constructed" as a branded type with an
// explicit `as unknown as Branded<...>` cast (see factories.ts); nothing
// about the brand is ever read back at runtime by symbol key. Runtime
// introspection (what layer is this unit, what is it named) is a plain,
// ordinary string property attached separately -- see units.ts's
// `LayerTag`/`unitName` -- deliberately NOT the same mechanism as the brand,
// so the two concerns (compile-time nominal typing vs. runtime
// introspection) stay independent.
//
// Three independent tag channels (`layerBrand`, `propRefBrand`,
// `featureBrand`) are declared, not one shared symbol, because a value can
// legitimately need more than one brand at once (e.g.
// `PropRef<ComponentUnit<Props>>` — "a reference to a component unit
// already in scope"; or, per #511, `FeatureBrand<ComponentUnit<Props>,
// 'checkout'>` — "this specific component unit, as generated inside the
// checkout feature", which itself can ALSO be wrapped in a PropRef). Sharing
// one symbol key would make the intersection's brand property require two
// different literal values at once (e.g. `'component' & 'ref'`, which
// collapses to `never`), silently making every such type uninhabitable. See
// units.ts / propRef.ts / #511's FeatureBrand below.
declare const layerBrand: unique symbol;
declare const propRefBrand: unique symbol;
declare const featureBrand: unique symbol;

/** Tags `T` with a literal value `V` under the private symbol channel `S`,
 * without disturbing any other brand `T` may already carry (see the module
 * doc comment above for why this needs to be its own symbol per channel,
 * not one shared symbol). Not exported -- callers use `Brand`/`PropRef`. */
type Tag<T, S extends symbol, V extends string> = T & { readonly [K in S]: V };

/** Brand `T` as belonging to layer `Layer` (e.g. `'domain'`, `'page'`). This
 * is the mechanism every `*Unit<...>` type in units.ts is built from: it is
 * what makes `tsc` refuse a `WorkflowUnit` where a `DomainUnit` is expected
 * even though both may structurally be, say, `(x: string) => number` --  a
 * real compile error, not an AST-based guess (closes the bug *class* #491
 * lives in: path-glob layer matching, not just its one instance). */
export type Brand<T, Layer extends string> = Tag<T, typeof layerBrand, Layer>;

/** Brand `T` as "a PropRef", independent of any layer brand `T` may already
 * carry. See propRef.ts for the public `PropRef<T>` type built from this. */
export type RefBrand<T> = Tag<T, typeof propRefBrand, 'ref'>;

/**
 * #511 — brand `T` (normally an already layer-branded unit, e.g.
 * `ComponentUnit<Props>`) as belonging to feature `Feature` (e.g.
 * `'checkout'`), independent of any layer/PropRef brand `T` may already
 * carry — the literal "`Brand<T, Layer, Feature>`" mechanism #511 asks for,
 * built as its own symbol channel (see this file's module doc comment)
 * rather than as a third type parameter grafted onto `Brand<T, Layer>`
 * itself: every existing `Brand<T, Layer>` call site throughout
 * units.ts/factories.ts stays byte-for-byte unchanged (#500 phase 1's
 * additive-only constraint) because `Brand`'s own definition is never
 * touched — `FeatureBrand` is a full sibling of `RefBrand`, layered on
 * top of an already-built unit type, not a modification of `Brand`.
 *
 * The feature tag is meant to be framework-generated, never hand-typed by a
 * developer: `withFeature()` (feature.ts) is the only place that produces a
 * `FeatureBrand`, and it infers `Feature` from the literal string VALUE
 * passed at the call site (the same way `propRef()` infers its `T` from a
 * value, not from an explicit type argument) — see feature.ts's doc comment
 * and examples/feature-branded-valid.ts for what a generated call site
 * looks like.
 */
export type FeatureBrand<T, Feature extends string> = Tag<T, typeof featureBrand, Feature>;
