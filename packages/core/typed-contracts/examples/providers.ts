// #510 -- real, compiling usage examples for both legitimate Provider patterns from #499's
// "Components, Providers and feature boundaries" design comment. Included in this directory's own
// tsconfig.json (must compile clean -- proven by test/typed-contracts-tsc.test.mjs, the same "capture
// the actual tsc output" bar as examples/valid.ts). Authored with React.createElement rather than
// JSX syntax deliberately (see jsx-global.d.ts's doc comment / examples/valid.ts) -- nothing here
// depends on that choice; a real project would author these as .tsx with real JSX.
import * as React from 'react';
import { defineProvider, defineComponent, defineService, defineDomain, type ProviderUnit } from '../index.ts';

// ---- the shared value + service/domain deps a Cart Provider computes from --------------
interface CartValue { total: number }

const calculateTotal = defineDomain<{ items: { price: number; quantity: number }[] }, number>(
  'calculateTotal',
  ({ items }) => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
);

// A "real" service and a "mock" one -- the exact same Props shape (both take none), per
// CLAUDE.md's existing "mock | real per service" switch. Nothing new is needed here: the Provider
// is what makes a Provider-using component safe to preview against the mock without ever touching
// real data. (The real one closes over calculateTotal directly -- Forbid<> restricts what TYPE a
// unit's Props may carry, not what a unit's own function body may call; see units.ts's doc comment.)
const realCartService = defineService<Record<string, never>, number>('realCartTotal', () =>
  calculateTotal({ items: [{ price: 25, quantity: 2 }] }),
);
const mockCartService = defineService<Record<string, never>, number>('mockCartTotal', () => 42);

// ---- the Provider itself: ONE definition, reused by BOTH patterns below ----------------
interface CartProviderProps { total: typeof realCartService | typeof mockCartService }
const CartProvider: ProviderUnit<CartProviderProps, CartValue> = defineProvider<CartProviderProps, CartValue>(
  'Cart',
  ({ total }) => ({ total: total({}) }),
);

// A small presentational component that reads the Provider's value via useProvider() -- it neither
// knows nor cares whether it ends up rendered under pattern (a) or (b) below; it only knows
// CartProvider's public useProvider() shape (CartValue).
const CartAmount = defineComponent<Record<string, never>>('CartAmount', () => {
  const { total } = CartProvider.useProvider();
  return React.createElement('span', null, `$${total}`);
});

// ---- pattern (a): a component wires its OWN Provider internally ------------------------
// Fully self-contained -- CartBadge means the same thing (the REAL cart total) wherever it is
// used, because it wires realCartService itself, every time, with nothing left for a caller to
// configure or get wrong.
const CartBadge = defineComponent<Record<string, never>>('CartBadge', () =>
  React.createElement(
    CartProvider.ProviderComponent,
    { total: realCartService },
    React.createElement(CartAmount, null),
  ),
);

// ---- pattern (b): the SAME Provider imported and wired into a DIFFERENT feature's own --
// presentational component, with a DIFFERENT data source at this call site (the mock service --
// e.g. a preview/Storybook-style screen in another feature) -- same API shape (CartValue), a
// different wiring per site. In a real project this Provider would be imported from
// features/cart/index.ts's public API (its SLICE-004 distinct-wrapper export, #509) rather than
// reused in the same file, as it is here purely so this stays one compiling example.
const CartPreviewCard = defineComponent<Record<string, never>>('CartPreviewCard', () =>
  React.createElement(
    CartProvider.ProviderComponent,
    { total: mockCartService },
    React.createElement(CartAmount, null),
  ),
);

// ---- prove the branded type is really inferred, not widened to `any` -------------------
type InferredValue = typeof CartProvider extends ProviderUnit<CartProviderProps, infer V> ? V : never;
const _valueCheck: InferredValue extends CartValue ? true : false = true;
void _valueCheck;

const _name: string = CartProvider.unitName;
const _layer: 'hook' = CartProvider.unitLayer;
void _name;
void _layer;

export { CartProvider, CartAmount, CartBadge, CartPreviewCard };
