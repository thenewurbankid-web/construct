// Pure checkout rules: no I/O, no framework.
export function totalCheckout(lines: number[]): number {
  return lines.reduce((a, b) => a + b, 0);
}
