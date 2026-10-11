export type Tier = 'free' | 'pro' | 'team';

/** A price as a label: thousands get a K, nothing below zero. */
export function priceLabel(amount: number): string {
  if (amount < 0) return 'invalid';
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${amount}`;
}

/** Seats included in a tier. */
export function seatsFor(tier: Tier): number {
  switch (tier) {
    case 'free':
      return 1;
    case 'pro':
      return 5;
    default:
      return 25;
  }
}
