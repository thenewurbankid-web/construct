const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plug } = require('./plug');
const { unplug } = require('./unplug');

test('round trip: unplug(source, plug(source)) is byte-for-byte the original source when nothing is edited', () => {
  const source = `export function checkAge(age) {\n  return age >= 18 ? true : false;\n}\n\nexport function greet(name) {\n  return 'hi ' + name;\n}\n`;
  const plugged = plug(source);
  const { updated, changed, flags } = unplug(source, plugged);
  assert.equal(updated, source);
  assert.deepEqual(changed, []);
  assert.deepEqual(flags, []);
});

test('reordering statements in the plugged function reorders the same statements in source.tsx, unresolved (raw)', () => {
  // Single param -- transform.js's collapseParams rule (multi-param ->
  // `const [a, b] = args;`) only fires for 2+ params; avoiding it here keeps
  // the plugged function's statement count equal to the original's, which
  // is what this block's reorder mapping requires.
  const source = `export function run(a) {\n  let x = a;\n  let y = a;\n  return x + y;\n}\n`;
  const plugged = plug(source);
  const swapped = plugged.replace('let x = a;\n  let y = a;', 'let y = a;\n  let x = a;');
  assert.notEqual(swapped, plugged);
  const { updated, changed, flags } = unplug(source, swapped);
  assert.deepEqual(flags, []);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].name, 'run');
  const lines = updated.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.equal(lines[1], 'let y = a;');
  assert.equal(lines[2], 'let x = a;');
});

test('a genuinely changed statement (not just reordered) is flagged, and source.tsx is left untouched for that function', () => {
  const source = `export function checkAge(age) {\n  return age >= 18 ? true : false;\n}\n`;
  const plugged = plug(source);
  const edited = plugged.replace('greaterThanOrEqual(18)', 'greaterThanOrEqual(21)');
  const { updated, changed, flags } = unplug(source, edited);
  assert.equal(updated, source);
  assert.deepEqual(changed, []);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].name, 'checkAge');
  assert.match(flags[0].reason, /not just reordered/);
});

test('adding/removing a top-level declaration is flagged for the whole file, source.tsx left untouched', () => {
  const source = `export function a(x) {\n  return x;\n}\n`;
  const plugged = plug(source);
  const withExtra = plugged + `\nexport function b(x) {\n  return x;\n}\n`;
  const { updated, changed, flags } = unplug(source, withExtra);
  assert.equal(updated, source);
  assert.deepEqual(changed, []);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].name, null);
});

test('parts of source.tsx untouched by any edit stay byte-for-byte identical, including a changed function elsewhere', () => {
  const source = `import { z } from 'lib';\n\nexport function a(age) {\n  return age >= 18 ? true : false;\n}\n\nexport function b(x) {\n  return x;\n}\n`;
  const plugged = plug(source);
  const edited = plugged.replace('greaterThanOrEqual(18)', 'greaterThanOrEqual(99)');
  const { updated } = unplug(source, edited);
  assert.match(updated, /^import \{ z \} from 'lib';/);
  assert.match(updated, /export function b\(x\) \{\n  return x;\n\}/);
});
