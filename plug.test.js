const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plug } = require('./plug');

test('plug rewrites a raw operator inside an exported function, same rule as transform.js', () => {
  const source = `export function checkAge(age) {\n  return age >= 18;\n}`;
  const out = plug(source);
  assert.match(out, /export function checkAge/);
  assert.match(out, /greaterThanOrEqual/);
  assert.doesNotMatch(out, />=/);
});

test('plug parses TypeScript type annotations and leaves them untouched', () => {
  const source = `export function double(n: number): number {\n  return n * 2;\n}`;
  const out = plug(source);
  assert.match(out, /n: number/);
  assert.match(out, /: number \{/);
});

test('plug parses JSX and leaves it untouched (no atom rules apply to JSX nodes)', () => {
  const source = `export function Greeting({ name }: { name: string }) {\n  return <div>Hello {name}</div>;\n}`;
  const out = plug(source);
  assert.match(out, /<div>/);
  assert.match(out, /Hello \{name\}/);
});

test('plug preserves the exported public API surface (names, export keyword) for a module with multiple exports', () => {
  const source = `export function a(x) {\n  return x === 1;\n}\nexport const b = 2;\nfunction helper() {\n  return 1;\n}`;
  const out = plug(source);
  assert.match(out, /export function a/);
  assert.match(out, /export const b/);
  assert.match(out, /function helper/);
  assert.doesNotMatch(out, /export function helper/);
});

test('plug throws on unparsable input, same as transform() (caller/server.js catches it)', () => {
  assert.throws(() => plug('function ('));
});
