// Fixture for english.test.mjs: three top-level functions and one non-function.
function add(a, b) {
  return a + b;
}

export const double = (x) => x * 2;

export function clamp(v, min, max) {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

const notAFunction = 3;
