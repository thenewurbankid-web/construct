// Renders an amount of money. Used by every feature that shows a price.
import type { Money } from '../types';

type CurrencyLabelProps = { value: Money; bold?: boolean };

export function CurrencyLabel({ value, bold }: CurrencyLabelProps) {
  return <span data-bold={bold}>{value.currency} {value.amount}</span>;
}
