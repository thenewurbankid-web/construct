export type CheckoutState = 'cart' | 'paying' | 'done';

export function next(state: CheckoutState): CheckoutState {
  return state === 'cart' ? 'paying' : 'done';
}
