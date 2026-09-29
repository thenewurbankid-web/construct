const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toEnglish, extractAtoms, reorderSteps } = require('./to-english');

test('toEnglish returns the flat english string for a function', () => {
  const code = `function checkAge(age) {\n  return age;\n}`;
  const { english } = toEnglish(code, 'function');
  assert.equal(english, 'check age using age: return age.');
});

test('toEnglish returns one step per top-level statement, in order', () => {
  const code = `function run(a, b) {\n  let x = a;\n  let y = b;\n  return x;\n}`;
  const { steps } = toEnglish(code, 'function');
  assert.equal(steps.length, 3);
  assert.equal(steps[0].english, 'let x be a');
  assert.equal(steps[1].english, 'let y be b');
  assert.equal(steps[2].english, 'return x');
});

test('each step carries its own code slice matching the original source', () => {
  const code = `function run(a, b) {\n  let x = a;\n  let y = b;\n  return x;\n}`;
  const { steps } = toEnglish(code, 'function');
  for (const step of steps) {
    assert.equal(code.slice(step.start, step.end), step.code);
  }
  assert.equal(steps[0].code, 'let x = a;');
  assert.equal(steps[1].code, 'let y = b;');
});

test('step offsets for a class method are relative to the unwrapped method code, not the wrapper', () => {
  const code = `checkAge(age) {\n  let ok = age;\n  return ok;\n}`;
  const { steps } = toEnglish(code, 'method');
  assert.equal(steps[0].code, 'let ok = age;');
  assert.equal(code.slice(steps[0].start, steps[0].end), 'let ok = age;');
});

test('steps join back into the same flat english string', () => {
  const code = `function run(a) {\n  let x = a;\n  return x;\n}`;
  const { english, steps, title } = toEnglish(code, 'function');
  assert.equal(english, `${title}: ${steps.map((s) => s.english).join('; then ')}.`);
});

test('toEnglish on unparsable input throws, same as before (caller/server.js catches it)', () => {
  assert.throws(() => toEnglish(`const x = ;`, 'function'));
});

test('extractAtoms still works unchanged alongside the new steps shape', () => {
  const code = `function run(a, b) {\n  return a.equals(b);\n}`;
  const atoms = extractAtoms(code, 'function');
  assert.deepEqual(atoms, ['equals']);
});

test('reorderSteps swaps two top-level statements and the re-derived english reflects the new order', () => {
  const code = `function run(a, b) {\n  let x = a;\n  let y = b;\n  return x;\n}`;
  const { code: rebuilt } = reorderSteps(code, 'function', [1, 0, 2]);
  const { steps } = toEnglish(rebuilt, 'function');
  assert.equal(steps[0].english, 'let y be b');
  assert.equal(steps[1].english, 'let x be a');
  assert.equal(steps[2].english, 'return x');
});

test('reorderSteps drops a statement when its index is omitted', () => {
  const code = `function run(a, b) {\n  let x = a;\n  let y = b;\n  return x;\n}`;
  const { code: rebuilt } = reorderSteps(code, 'function', [0, 2]);
  const { steps } = toEnglish(rebuilt, 'function');
  assert.equal(steps.length, 2);
  assert.equal(steps[0].english, 'let x be a');
  assert.equal(steps[1].english, 'return x');
});

test('reorderSteps works on a class method and stays unwrapped (no class wrapper in the output)', () => {
  const code = `checkAge(age) {\n  let ok = age;\n  let bad = age;\n  return ok;\n}`;
  const { code: rebuilt } = reorderSteps(code, 'method', [1, 0, 2]);
  assert.ok(!rebuilt.includes('class'));
  const { steps } = toEnglish(rebuilt, 'method');
  assert.equal(steps[0].english, 'let bad be age');
  assert.equal(steps[1].english, 'let ok be age');
});

test('reorderSteps flags a step moved above the step that defines a binding it uses', () => {
  // "return x" uses x, defined by "let x = a" -- moving the return to the
  // front puts it before its own definition.
  const code = `function run(a) {\n  let x = a;\n  return x;\n}`;
  const { breaks } = reorderSteps(code, 'function', [1, 0]);
  assert.equal(breaks[0].reason, "uses 'x', now set later in step 2");
  assert.equal(breaks[1], null);
});

test('reorderSteps does not flag a step whose binding is still defined earlier', () => {
  const code = `function run(a, b) {\n  let x = a;\n  let y = b;\n  return x;\n}`;
  const { breaks } = reorderSteps(code, 'function', [1, 0, 2]);
  assert.deepEqual(breaks, [null, null, null]);
});

test('reorderSteps flags a step whose binding was deleted', () => {
  const code = `function run(a) {\n  let x = a;\n  return x;\n}`;
  const { breaks } = reorderSteps(code, 'function', [1]);
  assert.match(breaks[0].reason, /no longer defined/);
});

test('fixing the order (moving the definer back above its use) clears the break', () => {
  const code = `function run(a) {\n  let x = a;\n  return x;\n}`;
  const broken = reorderSteps(code, 'function', [1, 0]).breaks;
  assert.ok(broken[0]);
  const fixed = reorderSteps(code, 'function', [0, 1]).breaks;
  assert.deepEqual(fixed, [null, null]);
});
