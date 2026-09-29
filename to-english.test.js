const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toEnglish, extractAtoms, extractAtomUsage, reorderSteps, atomParamNames, buildStepFromAtom, applyAtomToStep, tokenizeStmt, reorderChip } = require('./to-english');

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

test('atomParamNames reads parameter names straight off the atom\'s own source', () => {
  const code = `function clamp(value, min, max) {\n  return value;\n}`;
  assert.deepEqual(atomParamNames(code), ['value', 'min', 'max']);
});

test('buildStepFromAtom keeps a return statement\'s shape', () => {
  const original = { type: 'ReturnStatement' };
  assert.equal(buildStepFromAtom(original, 'clamp', ['value', 'min', 'max']), 'return clamp(value, min, max);');
});

test('buildStepFromAtom keeps a single-declarator variable declaration\'s shape (kind and name)', () => {
  const original = {
    type: 'VariableDeclaration',
    kind: 'let',
    declarations: [{ id: { type: 'Identifier', name: 'x' } }],
  };
  assert.equal(buildStepFromAtom(original, 'clamp', ['a', 'b']), 'let x = clamp(a, b);');
});

test('buildStepFromAtom falls back to a bare call for anything else', () => {
  const original = { type: 'ExpressionStatement' };
  assert.equal(buildStepFromAtom(original, 'log', ['msg']), 'log(msg);');
});

test('applyAtomToStep replaces a step with a call and the resulting english reflects it', () => {
  const code = `function run(a) {\n  let x = a;\n  return x;\n}`;
  const rebuilt = applyAtomToStep(code, 'function', 0, 'clone', ['a']);
  const { steps } = toEnglish(rebuilt, 'function');
  assert.equal(steps[0].english, 'let x be clone of a');
});

test('applyAtomToStep rejects an out-of-range step index', () => {
  const code = `function run(a) {\n  return a;\n}`;
  assert.throws(() => applyAtomToStep(code, 'function', 5, 'clone', ['a']));
});

test('applyAtomToStep replaces a bare return statement (return outside function during rebuild)', () => {
  const code = `function run(a) {\n  return a;\n}`;
  const rebuilt = applyAtomToStep(code, 'function', 0, 'triple', ['a']);
  const { steps } = toEnglish(rebuilt, 'function');
  assert.equal(steps[0].english, 'return triple of a');
});

test('extractAtomUsage orders atoms by first use, not alphabetically', () => {
  const code = `function run(value, min, max) {\n  return ifIt(value).greaterThanOrEqual(min).and(value).lessThanOrEqual(max);\n}`;
  const usage = extractAtomUsage(code, 'function');
  assert.deepEqual(usage.map((u) => u.name), ['ifIt', 'greaterThanOrEqual', 'and', 'lessThanOrEqual']);
});

test('extractAtomUsage counts repeated calls to the same atom', () => {
  const code = `function run(a, b, c) {\n  return a.equals(b) ? a.equals(c) : false;\n}`;
  const usage = extractAtomUsage(code, 'function');
  assert.deepEqual(usage, [{ name: 'equals', count: 2 }]);
});

test('tokenizeStmt (via toEnglish steps[].tokens) splits a method call into subject/verb/arg chips', () => {
  const code = `function run(a, b) {\n  return a.equals(b);\n}`;
  const { steps } = toEnglish(code, 'function');
  const tokens = steps[0].tokens;
  assert.deepEqual(tokens.map((tk) => tk.type), ['connective', 'subject', 'verb', 'arg']);
  assert.deepEqual(tokens.map((tk) => tk.text), ['return', 'a', 'equals', 'b']);
});

test('a multi-word atom name is one verb chip, not split into separate chips', () => {
  const code = `function run(value, min) {\n  return value.greaterThanOrEqual(min);\n}`;
  const { steps } = toEnglish(code, 'function');
  const verbChip = steps[0].tokens.find((tk) => tk.type === 'verb');
  assert.equal(verbChip.text, 'greater than or equal');
});

test('chip start/end map back to the source node, in the same coordinate space as the step code slice', () => {
  const code = `function run(a, b) {\n  return a.equals(b);\n}`;
  const { steps } = toEnglish(code, 'function');
  const argChip = steps[0].tokens.find((tk) => tk.type === 'arg');
  assert.equal(code.slice(argChip.start, argChip.end), 'b');
});

test('let-declaration chips: subject is the declared name, connectives are let/be', () => {
  const code = `function run(a) {\n  let total = a;\n  return total;\n}`;
  const { steps } = toEnglish(code, 'function');
  const tokens = steps[0].tokens;
  assert.deepEqual(tokens.map((tk) => tk.text), ['let', 'total', 'be', 'a']);
  assert.deepEqual(tokens.map((tk) => tk.type), ['connective', 'subject', 'connective', 'arg']);
});

test('chained conditions produce one verb chip and one arg chip per link, joined by connectives', () => {
  const code = `function run(value, min, max) {\n  return ifIt(value).greaterThanOrEqual(min).and(value).lessThanOrEqual(max);\n}`;
  const { steps } = toEnglish(code, 'function');
  const verbs = steps[0].tokens.filter((tk) => tk.type === 'verb').map((tk) => tk.text);
  assert.deepEqual(verbs, ['if it', 'greater than or equal', 'and', 'less than or equal']);
});

test('a destructuring declarator (const [a, b] = args) renders its pattern, not "undefined"', () => {
  const code = `function run(args) {\n  const [a, b] = args;\n  return a;\n}`;
  const { steps } = toEnglish(code, 'function');
  assert.equal(steps[0].english, 'let [a, b] be args');
  const subjectChip = steps[0].tokens.find((tk) => tk.type === 'subject');
  assert.equal(subjectChip.text, '[a, b]');
});

test('reorderChip swaps two argument chips of the same call and regenerates the code', () => {
  const code = `function run(a, b, c) {\n  return combine(a, b, c);\n}`;
  // tokens: 0 return, 1 combine(verb), 2 of, 3 a(arg), 4 and, 5 b(arg), 6 and, 7 c(arg)
  const order = [0, 1, 2, 5, 4, 3, 6, 7];
  const { code: rebuilt, broken } = reorderChip(code, 'function', 0, order);
  assert.equal(broken, null);
  const { steps } = toEnglish(rebuilt, 'function');
  assert.equal(steps[0].english, 'return combine of b and a and c');
});

test('reorderChip rejects swapping an argument with a connective', () => {
  const code = `function run(a, b) {\n  return combine(a, b);\n}`;
  // tokens: 0 return, 1 combine, 2 of, 3 a(arg), 4 and, 5 b(arg)
  const order = [0, 1, 2, 4, 3, 5];
  const { code: unchanged, broken } = reorderChip(code, 'function', 0, order);
  assert.equal(unchanged, code);
  assert.match(broken.reason, /only two argument words can swap/);
});

test('reorderChip rejects swapping arguments that belong to different calls', () => {
  const code = `function run(a, b) {\n  return combine(a).and(b);\n}`;
  const { steps } = toEnglish(code, 'function');
  const argPositions = steps[0].tokens.map((tk, idx) => (tk.type === 'arg' ? idx : -1)).filter((idx) => idx >= 0);
  const [posA, posB] = argPositions;
  const order = steps[0].tokens.map((_, idx) => idx);
  [order[posA], order[posB]] = [order[posB], order[posA]];
  const { code: unchanged, broken } = reorderChip(code, 'function', 0, order);
  assert.equal(unchanged, code);
  assert.match(broken.reason, /not arguments of the same call/);
});

test('reorderChip rejects an order that displaces more than two positions', () => {
  const code = `function run(a, b, c) {\n  return combine(a, b, c);\n}`;
  const order = [0, 1, 2, 5, 6, 3, 4, 7];
  const { code: unchanged, broken } = reorderChip(code, 'function', 0, order);
  assert.equal(unchanged, code);
  assert.match(broken.reason, /single word swap/);
});
