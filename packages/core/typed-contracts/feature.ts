// #511 -- the feature-identity mechanism: framework-generated feature
// tagging, layered as a second, independent brand on top of any
// already-layer-branded unit (see brand.ts's module doc comment for why
// this is its own symbol channel, not folded into the existing layer
// brand). Upgrades SLICE-001/SLICE-002 (feature isolation) from
// AST/path-string matching (today's real mechanism,
// packages/core/soc-enforcer.mjs's checkCrossFeatureImports) towards a real
// `tsc` error -- the same denylist -> allowlist, path-matching ->
// type-checking upgrade #501/#502 already applied to layer boundaries, now
// covering feature boundaries too. This file does NOT touch
// soc-enforcer.mjs or wire this into `construct validate` -- per #500's
// explicit phase-1 scope, SLICE-001/SLICE-002 keep running completely
// unchanged.
//
// The feature tag is meant to be framework-generated, never hand-typed by a
// developer: `withFeature(unit, feature)` infers its `Feature` type
// parameter from the LITERAL STRING VALUE passed as `feature` (the same way
// propRef.ts's `propRef(value)` infers `T` from `value`), never from an
// explicit `withFeature<U, 'checkout'>(...)` type argument a developer
// could mistype or copy from a different feature by accident. The only
// thing that is meant to ever write that literal string is `construct
// create <layer> <Name> --feature <name>` (the CLI itself is out of scope
// for this ticket -- not modified here); examples/feature-branded-valid.ts
// simulates exactly what that generated call site looks like.
import type { LayerName, LayerTag } from './units.ts';
import type { FeatureBrand } from './brand.ts';

/**
 * Tag an already-defined unit (any layer) with the feature it was generated
 * inside, as a brand independent of its layer brand — `defineComponent(...)`
 * still produces a plain `ComponentUnit<Props>`; `withFeature(unit,
 * 'checkout')` layers `FeatureBrand<ComponentUnit<Props>, 'checkout'>` on
 * top of that value. Zero runtime cost, exactly like `propRef()` — an
 * ordinary identity function; nothing about the brand is ever read back by
 * symbol key at runtime (see brand.ts).
 *
 * Bounded by `LayerTag<LayerName>`, not `AnyUnit` — see `FeatureUnit`'s doc
 * comment in units.ts for why: `AnyUnit`'s member types use wildcard
 * (`unknown`) `Props`, and TypeScript's function-parameter contravariance
 * means a concretely-typed unit like `ComponentUnit<TotalBadgeProps>`
 * returned by `defineComponent<TotalBadgeProps>(...)` does not structurally
 * satisfy `U extends AnyUnit` at this call site, which would silently
 * infer `U` as the wildcard `AnyUnit` itself (discarding the real `Props`)
 * or fail outright, instead of preserving the caller's actual unit type.
 *
 * @example
 * const TotalBadge = withFeature(defineComponent<Props>('TotalBadge', fn), 'checkout');
 * // TotalBadge: FeatureBrand<ComponentUnit<Props>, 'checkout'>
 */
export function withFeature<U extends LayerTag<LayerName>, Feature extends string>(unit: U, feature: Feature): FeatureBrand<U, Feature> {
  return unit as FeatureBrand<U, Feature>;
}
