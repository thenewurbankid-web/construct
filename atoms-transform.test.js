// Unit tests for atoms-transform.js (JS -> atoms) and the catalog loader it reads.
// The catalog here is a small fixture in the runtime's catalog.json shape; `params`
// stands in for the signatures the loader otherwise reads from the runtime's source.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const parser = require('@babel/parser');
const { toAtoms } = require('./atoms-transform');
const { compileCatalog, paramsFromSource, signaturesFromSource } = require('./atoms-catalog');

const FIXTURE = [
  { atom: 'equals', js: ['a === b'], params: ['a', 'b'] },
  { atom: 'differs', js: ['a !== b'], params: ['a', 'b'] },
  { atom: 'times', js: ['a * b'], params: ['a', 'b'] },
  { atom: 'orElse', js: ['a ?? b'], params: ['a', 'b'] },
  { atom: 'isText', js: ["typeof value === 'string'"], params: ['value'] },
  { atom: 'mapEach', js: ['list.map(fn)'], params: ['list', 'fn'] },
  { atom: 'hasItem', js: ['list.includes(item, fromIndex)'], params: ['list', 'item', 'fromIndex?'] },
  { atom: 'parseJson', js: ['JSON.parse(text)'], params: ['text'] },
  { atom: 'parseJsonOrThrow', js: ['JSON.parse(text, reviver)'], params: ['text', 'reviver?'] },
  { atom: 'when', js: ['c ? a : b', 'if (c) { a } else { b }'], params: ['condition', 'then', 'otherwise?'] },
  { atom: 'choose', js: ['if (c1) { a } else if (c2) { b } else { fallback }'], params: ['cases', 'fallback?'] },
  { atom: 'match', js: ['switch (value) { case k: … default: … }'], params: ['value', 'cases', 'fallback?'] },
  { atom: 'attempt', js: ['try { body } catch (e) { recover(e) } finally { cleanup }'], params: ['body', 'recover?', 'cleanup?'] },
  { atom: 'attemptAsync', js: ['try { await body } catch (e) { recover(e) } finally { cleanup }'], params: ['body', 'recover?', 'cleanup?'] },
  { atom: 'each', js: ['for (const item of list) { body }'], params: ['list', 'fn'] },
  { atom: 'fail', js: ['throw error'], params: ['error'] },
];
const catalog = compileCatalog(FIXTURE);
const flat = (code) => code.replace(/\s+/g, ' ').trim();
const atoms = (code, options = {}) => toAtoms(code, { catalog, ...options });
const body = (code, options) => flat(atoms(code, options).body);
const parses = (code) => parser.parse(code, { sourceType: 'module', plugins: ['typescript'] });

describe('expressions', () => {
  test('a catalog form becomes a call of its atom, arguments in parameter order', () => {
    assert.equal(body('const same = left === right;'), 'const same = equals(left, right);');
    assert.equal(body('const names = users.map(nameOf);'), 'const names = mapEach(users, nameOf);');
    assert.equal(body("const isString = typeof input === 'string';"), 'const isString = isText(input);');
  });

  test('a lazily evaluated position becomes a thunk', () => {
    assert.equal(body('const value = given ?? compute();'), 'const value = orElse(given, () => compute());');
  });

  test('the atoms used are imported once, sorted', () => {
    const out = atoms('export const f = (a, b) => a === b ? a * 2 : b;');
    assert.deepEqual(out.imports, ['equals', 'times', 'when']);
    assert.match(out.code, /^import \{ equals, times, when \} from 'smith';/);
  });

  test('a form may leave out optional parameters of its atom', () => {
    assert.equal(body('const found = list.includes(x);'), 'const found = hasItem(list, x);');
    assert.equal(body('const found = list.includes(x, 2);'), 'const found = hasItem(list, x, 2);');
  });

  test('when two atoms claim a call, the larger form wins: JSON.parse keeps throwing', () => {
    assert.equal(body('const data = JSON.parse(text);'), 'const data = parseJsonOrThrow(text);');
    assert.equal(body('const data = JSON.parse(text, revive);'), 'const data = parseJsonOrThrow(text, revive);');
  });

  test('code with no catalog entry is left as it is and recorded', () => {
    const out = atoms('const label = `${first} ${last}`;');
    assert.equal(flat(out.body), 'const label = `${first} ${last}`;');
    assert.equal(out.converted, 0);
    assert.deepEqual(out.untranslated.map((u) => u.type), ['TemplateLiteral']);
  });
});

describe('control flow', () => {
  test('if/else with returns becomes return when(...)', () => {
    assert.equal(
      body('function sign(n) { if (n === 0) { return "zero"; } else { return "other"; } }'),
      'function sign(n) { return when(equals(n, 0), () => "zero", () => "other"); }',
    );
  });

  test('the statements after an early return move into the branch that falls through', () => {
    assert.equal(
      body('function area(shape) { if (shape === null) { return 0; } const side = shape.side; return side * side; }'),
      'function area(shape) { return when(equals(shape, null), () => 0, () => { const side = shape.side; return times(side, side); }); }',
    );
  });

  test('an else-if chain becomes choose([...])', () => {
    assert.equal(
      body('function grade(n) { if (n === 1) { return "a"; } else if (n === 2) { return "b"; } else { return "c"; } }'),
      'function grade(n) { return choose([[equals(n, 1), () => "a"], [() => equals(n, 2), () => "b"]], () => "c"); }',
    );
  });

  test('switch over string cases becomes match(...)', () => {
    assert.equal(
      body("function label(status) { switch (status) { case 'ok': return 'Fine'; default: return 'Unknown'; } }"),
      "function label(status) { return match(status, { ok: () => 'Fine' }, () => 'Unknown'); }",
    );
  });

  test('try/catch/finally becomes attempt(...), attemptAsync when the body awaits', () => {
    assert.equal(
      body('function read(text) { try { return decode(text); } catch (e) { return null; } finally { done(); } }'),
      'function read(text) { return attempt(() => decode(text), e => null, () => done()); }',
    );
    assert.equal(
      body('async function load(url) { try { return await get(url); } catch (e) { return null; } }'),
      'async function load(url) { return await attemptAsync(async () => await get(url), async e => null); }',
    );
  });

  test('for...of becomes each(...); throw becomes fail(...)', () => {
    assert.equal(body('function run(tasks) { for (const task of tasks) { task(); } }'), 'function run(tasks) { each(tasks, task => { task(); }); }');
    assert.equal(body('function stop(error) { throw error; }'), 'function stop(error) { fail(error); }');
  });
});

describe('await and yield never move into a plain thunk', () => {
  const awaitsAfter = 'async function submit(state, send) { if (state.status !== "ready") { return state; } const result = await send(state.data); return result; }';

  test('an early return followed by await stays an if', () => {
    const out = atoms(awaitsAfter);
    assert.equal(flat(out.body), 'async function submit(state, send) { if (differs(state.status, "ready")) { return state; } const result = await send(state.data); return result; }');
    assert.deepEqual(out.untranslated.map((u) => u.reason), ['await/yield after the if would move into a branch']);
    assert.doesNotThrow(() => parses(out.code));
  });

  test('the same holds when the await sits in a try after the if', () => {
    const out = atoms('async function submit(state, send) { if (state === null) { return null; } try { return await send(state); } catch (e) { return state; } }');
    assert.doesNotThrow(() => parses(out.code));
    assert.match(flat(out.body), /^async function submit\(state, send\) \{ if \(equals\(state, null\)\) \{ return null; \}/);
  });

  test('yield after the if stays syntax too', () => {
    const out = atoms('function* walk(node) { if (node === null) { return; } yield node.value; }');
    assert.doesNotThrow(() => parses(out.code));
    assert.match(flat(out.body), /if \(equals\(node, null\)\)/);
  });

  test('an await inside a nested async function does not block the rewrite', () => {
    assert.equal(
      body('function later(job) { if (job === null) { return null; } return async () => await job(); }'),
      'function later(job) { return when(equals(job, null), () => null, () => async () => await job()); }',
    );
  });
});

describe('signatures from the runtime source', () => {
  const generated = `
export function parseJsonOrThrow(text: string, reviver?: (key: string, value: any) => any): any;
export function parseJsonOrThrow(...args: any[]): any { return (JSON as any).parse(...args); }
export function padded(text: string, length: number): string;
export function padded(text: string, length: number, fill: string): string;
export function padded(...args: any[]): any { return (args[0] as any).padStart(...args.slice(1)); }
export function maxOf(...values: number[]): number { return Math.max(...values); }
`;

  test('a generated wrapper takes its parameters from its declared overloads, not from (...args)', () => {
    const sig = signaturesFromSource(generated);
    assert.deepEqual(sig.parseJsonOrThrow.params.map((p) => [p.name, p.optional]), [['text', false], ['reviver', true]]);
    assert.deepEqual(sig.padded.params.map((p) => p.name), ['text', 'length', 'fill']);
    assert.deepEqual(sig.parseJsonOrThrow.firstKinds, ['string']);
  });

  test('a real rest parameter with no overloads stays a rest parameter', () => {
    assert.deepEqual(signaturesFromSource(generated).maxOf.params.map((p) => [p.name, p.rest]), [['values', true]]);
  });

  test('paramsFromSource reads subfolders of src/atoms', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atoms-catalog-'));
    try {
      fs.mkdirSync(path.join(root, 'src', 'atoms', 'generated'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'atoms', 'json.ts'), 'export function parseJson(text: string): unknown { return text; }\n');
      fs.writeFileSync(path.join(root, 'src', 'atoms', 'generated', 'json.ts'), generated);
      const sig = paramsFromSource(root);
      assert.deepEqual(Object.keys(sig).sort(), ['maxOf', 'padded', 'parseJson', 'parseJsonOrThrow']);
      assert.equal(sig.parseJsonOrThrow.file, 'generated/json.ts');
      const compiled = compileCatalog(FIXTURE.map(({ params, ...entry }) => entry), { signatures: sig });
      assert.equal(flat(toAtoms('const data = JSON.parse(text);', { catalog: compiled }).body), 'const data = parseJsonOrThrow(text);');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
