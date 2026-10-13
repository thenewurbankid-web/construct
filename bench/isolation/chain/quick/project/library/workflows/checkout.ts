// Checkout: review the cart, fill in the details, then the order is confirmed.
import { setup } from 'xstate';

/** The pages this workflow needs: a feature fills each role with one of its own pages. */
export const roles = {
  cart: 'The page that shows what will be bought',
  details: 'The page with the checkout form',
  confirmation: 'The page that confirms the order',
};

export const checkout = setup({
  actions: {
    callService: (_: unknown, _params: { service: string }) => {},
    setPartState: (_: unknown, _params: { part: string; state: string }) => {},
  },
}).createMachine({
  id: 'checkout',
  initial: 'cart',
  states: {
    cart: { on: { CHECKOUT: 'details' } },
    details: { on: { PLACE_ORDER: 'confirmation', BACK: 'cart' } },
    confirmation: { type: 'final' },
  },
});
