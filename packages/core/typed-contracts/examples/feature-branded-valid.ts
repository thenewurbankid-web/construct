// #511 step 5(a) -- a real, valid feature-branded composition, proving:
// (1) it compiles clean under this directory's own tsconfig.json;
// (2) a unit tagged with withFeature() keeps working like an ordinary unit
//     wherever a feature tag isn't required -- the brand is additive, never
//     narrows what #501/#502 already proved about plain unit composition;
// (3) the SLICE-004 "release point" idea (#509 -- not yet built; checked
//     via `gh issue view 509` before writing this, per the brief. This is a
//     minimal, example-only SIMULATION of that idea for #511's proof, not
//     #509's actual implementation, which would live in
//     packages/core/soc-enforcer.mjs and is out of scope here): a
//     feature-branded unit passed through a distinct wrapper function
//     (what a feature's real index.ts would export) widens back to the
//     plain, un-feature-tagged unit type, so a DIFFERENT feature can
//     consume it.
// Authored with React.createElement rather than JSX syntax deliberately
// (see ../jsx-global.d.ts's doc comment), same as examples/valid.ts.
import * as React from 'react';
import {
  defineComponent,
  defineController,
  withFeature,
  propRef,
  type ComponentUnit,
  type FeatureBrand,
  type PropRef,
} from '../index.ts';

// ---- checkout feature: features/checkout/components/TotalBadge.tsx -----
// Simulates exactly what `construct create component TotalBadge --feature
// checkout` would emit (the CLI itself is out of scope for #511 -- not
// modified here). The literal 'checkout' string below is what only that
// command would ever write; a developer hand-building this file would
// never type it as an explicit generic argument, only ever receive it
// already baked in by withFeature()'s inference (see feature.ts).
interface TotalBadgeProps { amount: number }
const TotalBadge = withFeature(
  defineComponent<TotalBadgeProps>('TotalBadge', (props) => React.createElement('span', null, `$${props.amount}`)),
  'checkout',
);

// ---- proof (2): the feature brand takes nothing away --------------------
// FeatureBrand<ComponentUnit<Props>, F> is still, structurally, a real
// ComponentUnit<Props> (an intersection type is always assignable to each
// of its members) -- no cast needed.
const _stillAComponentUnit: ComponentUnit<TotalBadgeProps> = TotalBadge;
void _stillAComponentUnit;

// ---- the literal feature tag is really inferred, not widened to `string`
type InferredFeature = typeof TotalBadge extends FeatureBrand<unknown, infer F> ? F : never;
const _featureCheck: InferredFeature extends 'checkout' ? true : false = true;
void _featureCheck;

// ---- same-feature composition: wiring TotalBadge directly, no widening -
// A checkout controller may require the badge to specifically be a
// 'checkout'-feature unit (a feature-scoped slot) and wire the same-feature
// TotalBadge straight in -- contrast examples/feature-branded-invalid.ts,
// where a DIFFERENT feature's unit is illegally wired into this same slot.
interface CheckoutControllerProps {
  badge: PropRef<FeatureBrand<ComponentUnit<TotalBadgeProps>, 'checkout'>>;
  amount: number;
}
const CheckoutController = defineController<CheckoutControllerProps>('CheckoutController', (props) =>
  React.createElement(props.badge as unknown as FeatureBrand<ComponentUnit<TotalBadgeProps>, 'checkout'>, { amount: props.amount }),
);
void React.createElement(CheckoutController, { badge: propRef(TotalBadge), amount: 20 });

// ---- proof (3): the SLICE-004 release point (#509 minimal simulation) --
// features/checkout/index.ts's public API re-exports a DISTINCT wrapper,
// never the raw internal unit -- the wrapper's declared return type
// (`ComponentUnit<TotalBadgeProps>`, no feature tag) is where the
// feature-branded value gets deliberately widened for cross-feature
// consumption. No cast needed, same reasoning as proof (2) above.
function releaseTotalBadge(): ComponentUnit<TotalBadgeProps> {
  return TotalBadge;
}

// ---- a DIFFERENT feature (cart) consumes the released badge ------------
// features/cart/controllers/CartController.tsx imports the WRAPPER
// (releaseTotalBadge), never TotalBadge itself -- and it compiles, because
// what it receives back is a plain, un-feature-branded ComponentUnit.
interface CartControllerProps {
  badge: PropRef<ComponentUnit<TotalBadgeProps>>;
  amount: number;
}
const CartController = defineController<CartControllerProps>('CartController', (props) =>
  React.createElement(props.badge as unknown as ComponentUnit<TotalBadgeProps>, { amount: props.amount }),
);
void React.createElement(CartController, { badge: propRef(releaseTotalBadge()), amount: 20 });

export { TotalBadge, CheckoutController, releaseTotalBadge, CartController };
