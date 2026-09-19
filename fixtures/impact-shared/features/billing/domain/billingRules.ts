// Pure billing rules: no I/O, no framework.
export function totalBilling(lines: number[]): number {
  return lines.reduce((a, b) => a + b, 0);
}
