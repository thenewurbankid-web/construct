// #511 step 5(b) -- deliberately illegal cross-feature wiring: two units of
// the SAME layer and SAME prop shape, built for DIFFERENT features, are NOT
// mutually assignable. Excluded from this directory's own tsconfig.json (it
// must NOT compile); compiled on its own by
// test/typed-contracts-feature-tsc.test.mjs, which asserts on the actual
// `tsc` diagnostics produced (not just "some error happened") -- same rigor
// as examples/invalid-wiring.ts.
import * as React from 'react';
import { defineComponent, defineController, withFeature, propRef, type ComponentUnit, type FeatureBrand, type PropRef } from '../index.ts';

interface BadgeProps { amount: number }
const CheckoutBadge = withFeature(defineComponent<BadgeProps>('CheckoutBadge', (p) => React.createElement('span', null, `$${p.amount}`)), 'checkout');
const CartBadge = withFeature(defineComponent<BadgeProps>('CartBadge', (p) => React.createElement('span', null, `$${p.amount}`)), 'cart');
void CheckoutBadge;

// Illegal #1: a direct assignment across features, same layer, same shape --
// the textbook case #511 asks to prove: "two same-layer units from
// different features are NOT mutually assignable".
const wrongFeature: FeatureBrand<ComponentUnit<BadgeProps>, 'checkout'> = CartBadge;
void wrongFeature;

// Illegal #2: a realistic composition -- a checkout controller's props
// require a 'checkout'-feature badge (PropRef<FeatureBrand<..., 'checkout'>>);
// wiring in the 'cart'-feature badge instead, WITHOUT going through a
// SLICE-004-style release wrapper (contrast
// examples/feature-branded-valid.ts's releaseTotalBadge()), is rejected at
// the composition call site.
interface CheckoutControllerProps {
  badge: PropRef<FeatureBrand<ComponentUnit<BadgeProps>, 'checkout'>>;
  amount: number;
}
const CheckoutController = defineController<CheckoutControllerProps>('CheckoutController', (props) =>
  React.createElement(props.badge as unknown as FeatureBrand<ComponentUnit<BadgeProps>, 'checkout'>, { amount: props.amount }),
);
void React.createElement(CheckoutController, { badge: propRef(CartBadge), amount: 20 });
