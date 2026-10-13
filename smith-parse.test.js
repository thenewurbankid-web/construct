// S4: Smith reads TypeScript + JSX, finds exported functions, and can
// describe every function in a module.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toEnglish } = require('./to-english');
const { chunkCode } = require('./chunker');

test('toEnglish parses TypeScript annotations instead of throwing', () => {
  const { english } = toEnglish(`function double(n: number): number {\n  return n;\n}`, 'function');
  assert.equal(english, 'double using n: return n.');
});

test('toEnglish parses a TS class method with modifiers', () => {
  const { title, steps } = toEnglish(`private async load(id: string): Promise<void> {\n  return id;\n}`, 'method');
  assert.equal(title, 'load using id');
  assert.equal(steps[0].english, 'return id');
});

test('toEnglish parses TSX without throwing', () => {
  assert.doesNotThrow(() => toEnglish(`function A(): JSX.Element {\n  return <div />;\n}`, 'function'));
});

test('export function is found (it was invisible before)', () => {
  const { title } = toEnglish(`export function checkAge(age: number) {\n  return age;\n}`, 'function');
  assert.equal(title, 'check age using age');
});

test('export default function and export const arrow are found', () => {
  assert.equal(toEnglish(`export default function (a) {\n  return a;\n}`, 'function').title, 'default using a');
  const r = toEnglish(`export const total = (a, b) => a.plus(b);`, 'function');
  assert.equal(r.title, 'total using a and b');
  assert.equal(r.steps[0].english, 'return a plus b');
  assert.equal(r.steps[0].code, 'a.plus(b)');
});

test('default describes only the first function; {all: true} describes every one in source order', () => {
  const code = `import x from 'x';\nexport function a(p) {\n  return p;\n}\nconst b = (q) => {\n  return q;\n};\nexport class C {\n  m(r) {\n    return r;\n  }\n}\n`;
  const first = toEnglish(code, 'function');
  assert.equal(first.title, 'a using p');
  assert.equal(first.functions, undefined);
  const all = toEnglish(code, 'function', { all: true });
  assert.deepEqual(all.functions.map((f) => f.name), ['a', 'b', 'm']);
  assert.deepEqual(all.functions.map((f) => f.kind), ['function', 'function', 'method']);
  assert.equal(all.english, first.english);
  for (const f of all.functions) assert.ok(code.slice(f.start, f.end).includes(f.name === 'm' ? 'm(r)' : f.name));
});

test('TS overloads and declare-only functions are skipped, the implementation is described', () => {
  const code = `export function f(a: string): string;\nexport function f(a: any) {\n  return a;\n}`;
  const all = toEnglish(code, 'function', { all: true });
  assert.equal(all.functions.length, 1);
  assert.equal(all.steps[0].english, 'return a');
});

test('chunkCode parses TSX and includes exported functions, sliced without the export keyword', () => {
  const code = `export function a(n: number) {\n  return n;\n}\nexport default function b() {\n  return <i />;\n}\nfunction c() {}\nclass K {\n  #p() {}\n}`;
  const chunks = chunkCode(code);
  assert.deepEqual(chunks.map((c) => c.name), ['a', 'b', 'c', 'p']);
  assert.ok(chunks[0].code.startsWith('function a'));
  assert.ok(chunks[1].code.startsWith('function b'));
});
