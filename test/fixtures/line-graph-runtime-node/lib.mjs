// Fixture for test/line-graph-runtime.test.mjs (node:test + module.registerHooks). Plain ESM, no build step.
export function total(lines) {
  return lines.reduce((sum, l) => sum + l.qty * l.price, 0);
}

export const formatTotal = (amount) => `${amount.toFixed(2)} EUR`;

export function neverCalled() {
  return 'not reached';
}
