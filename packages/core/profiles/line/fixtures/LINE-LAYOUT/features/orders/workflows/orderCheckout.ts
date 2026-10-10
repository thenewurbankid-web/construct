// @line-base workflows/checkout
import { next, type CheckoutState } from '../../../library/workflows/checkout';

export function advance(state: CheckoutState): CheckoutState {
  return next(state);
}
