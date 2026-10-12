export function total(prices: number[]): number {
  return prices.reduce((a, b) => a + b, 0);
}

export function useTotal(prices: number[]): number {
  return total(prices);
}
