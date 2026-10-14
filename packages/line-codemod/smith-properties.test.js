// S7: property tests for Smith (fast-check). Random TS/TSX functions from a
// small grammar, plus every function of the real corpus when it is present
// (bench/corpus.js; SMITH_CORPUS overrides the location).
//
// Properties:
//   1. toEnglish never throws on input that parses
//   2. it is deterministic
//   3. the steps join back to `english`
//   4. every chip's (and unhandled entry's) offsets fall inside its step
//   5. unplug(src, plug(src)) === src
// Properties 1-4 are checked in both styles ({ style: 'plain' } and 'exact').
//
// Seeded so a failure reproduces: SMITH_FC_SEED=<n> SMITH_FC_RUNS=<n>.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const parser = require('@babel/parser');
const { toEnglish, clearEnglishCache } = require('./to-english');
const { plug } = require('./plug');
const { unplug } = require('./unplug');
const corpus = require('./bench/corpus');

const SEED = Number(process.env.SMITH_FC_SEED || 20261013);
const RUNS = Number(process.env.SMITH_FC_RUNS || 300);
const FC = { seed: SEED, numRuns: RUNS };
const PARSE = { sourceType: 'module', plugins: ['typescript', 'jsx'] };

// ---- a small TS/TSX grammar ------------------------------------------------
const ident = fc.constantFrom('a', 'b', 'x', 'items', 'user', 'this');
const assignable = fc.constantFrom('x', 'n', 'total');
const prop = fc.constantFrom('id', 'name', 'isValid', 'getValue', 'length', 'map', 'filter');
const word = fc.stringMatching(/^[a-z ]{0,8}$/);

const { expr } = fc.letrec((tie) => ({
  expr: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    ident,
    fc.integer({ min: 0, max: 99 }).map(String),
    word.map((w) => `'${w}'`),
    fc.constantFrom('true', 'null', 'undefined', '/ab+c/gi', '10n', 'import.meta'),
    fc.tuple(word, tie('expr'), word).map(([p, e, q]) => `\`${p}\${${e}}${q}\``),
    fc.tuple(tie('expr'), prop).map(([e, p]) => `(${e}).${p}`),
    fc.tuple(tie('expr'), prop).map(([e, p]) => `(${e})?.${p}`),
    fc.tuple(tie('expr'), tie('expr')).map(([e, k]) => `(${e})[${k}]`),
    fc.tuple(prop, fc.array(tie('expr'), { maxLength: 3 })).map(([p, as]) => `${p}(${as.join(', ')})`),
    fc.tuple(tie('expr'), prop, fc.array(tie('expr'), { maxLength: 2 })).map(([e, p, as]) => `(${e}).${p}(${as.join(', ')})`),
    fc.tuple(tie('expr'), fc.array(tie('expr'), { maxLength: 2 })).map(([e, as]) => `(${e})?.(${as.join(', ')})`),
    fc.tuple(tie('expr'), tie('expr')).map(([e, k]) => `(${e})[${k}](${k})`),
    tie('expr').map((e) => `(() => ${e})()`),
    tie('expr').map((e) => `new Map(${e})`),
    tie('expr').map((e) => `new a.Store(${e})`),
    fc.tuple(fc.constantFrom('!', '-', 'typeof ', 'void '), tie('expr')).map(([o, e]) => `${o}(${e})`),
    fc.tuple(tie('expr'), fc.constantFrom('+', '===', '<', 'instanceof', '&&', '||', '??'), tie('expr')).map(([l, o, r]) => `(${l}) ${o} (${r})`),
    fc.tuple(tie('expr'), tie('expr'), tie('expr')).map(([c, t, e]) => `(${c}) ? (${t}) : (${e})`),
    fc.tuple(assignable, fc.constantFrom('=', '+=', '-=', '??=', '*='), tie('expr')).map(([l, o, r]) => `(${l} ${o} (${r}))`),
    fc.tuple(assignable, fc.constantFrom('++', '--')).map(([l, o]) => `${l}${o}`),
    tie('expr').map((e) => `((p) => (${e}))`),
    tie('expr').map((e) => `(function (q) { return ${e}; })`),
    tie('expr').map((e) => `(async () => await (${e}))`),
    fc.tuple(prop, tie('expr'), tie('expr')).map(([k, v, s]) => `({ ${k}: ${v}, ...(${s}), [${v}]: 1, m() { return ${v}; } })`),
    fc.constantFrom('({})', '[]'),
    fc.tuple(tie('expr'), tie('expr')).map(([e, s]) => `[${e}, , ...(${s})]`),
    fc.tuple(tie('expr'), tie('expr')).map(([e, f]) => `((${e}), (${f}))`),
    tie('expr').map((e) => `((${e}) as Foo)`),
    tie('expr').map((e) => `(${e})!`),
    tie('expr').map((e) => `((${e}) satisfies Bar)`),
    tie('expr').map((e) => `(class Box { v = ${e}; })`),
    fc.tuple(word, tie('expr')).map(([w, e]) => `<div className="${w.trim()}" hidden onClick={() => ${e}}>${w}{${e}}<b>{(${e})}</b></div>`),
    fc.tuple(tie('expr'), tie('expr')).map(([e, f]) => `<><UI.Item {...(${e})} />{(${f})}</>`),
  ),
}));

const declName = fc.constantFrom('v1', 'v2', 'v3');
const { stmt, loopStmt } = fc.letrec((tie) => ({
  stmt: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    expr.map((e) => `return ${e};`),
    expr.map((e) => `(${e});`),
    fc.tuple(declName, expr).map(([n, e]) => `var ${n} = ${e};`),
    expr.map((e) => `var [p1, p2] = ${e};`),
    expr.map((e) => `var { id: p3, name = 'x', ...p4 } = ${e};`),
    fc.tuple(expr, tie('stmt'), fc.option(tie('stmt'))).map(([c, t, e]) => `if (${c}) { ${t} }${e ? ` else { ${e} }` : ''}`),
    fc.tuple(expr, tie('loopStmt')).map(([e, b]) => `for (var i = 0; i < (${e}); i++) { ${b} }`),
    fc.tuple(expr, tie('loopStmt')).map(([e, b]) => `for (var [k, w] of (${e})) { ${b} }`),
    fc.tuple(expr, tie('loopStmt')).map(([e, b]) => `for (var key in (${e})) { ${b} }`),
    fc.tuple(expr, tie('loopStmt')).map(([e, b]) => `while (${e}) { ${b} }`),
    fc.tuple(expr, tie('loopStmt')).map(([e, b]) => `do { ${b} } while (${e});`),
    fc.tuple(expr, tie('stmt'), tie('stmt')).map(([e, s, d]) => `switch (${e}) { case 1: case 2: ${s} break; default: ${d} }`),
    fc.tuple(tie('stmt'), tie('stmt')).map(([s, c]) => `try { ${s} } catch (err) { ${c} } finally { ; }`),
    expr.map((e) => `throw new Error(${e});`),
    tie('stmt').map((s) => `function inner(p, { q } = {}) { ${s} }`),
    fc.constantFrom(';', 'debugger;', 'type T = string;'),
  ),
  loopStmt: fc.oneof({ depthSize: 'small' }, tie('stmt'), fc.constantFrom('break;', 'continue;')),
}));

const params = fc.constantFrom('', 'a', 'a, b', 'a: number, { id, name: label = "n" }: P', '[first] = [], ...rest');
const fnSource = fc.tuple(params, fc.array(stmt, { minLength: 1, maxLength: 4 }), fc.boolean())
  .map(([p, body, method]) => (method
    ? { kind: 'method', code: `async run(${p}) {\n  ${body.join('\n  ')}\n}` }
    : { kind: 'function', code: `export async function run(${p}) {\n  ${body.join('\n  ')}\n}` }));

function parses({ code, kind }) {
  try {
    parser.parse(kind === 'method' ? `class __W__ {\n${code}\n}` : code, PARSE);
    return true;
  } catch {
    return false;
  }
}

// ---- the properties, as plain checks reused for generated and corpus input --
const STYLES = ['plain', 'exact'];

function checkDescription({ code, kind }) {
  for (const style of STYLES) checkDescriptionIn({ code, kind }, style);
}

function checkDescriptionIn({ code, kind }, style) {
  const r = toEnglish(code, kind, { style }); // property 1: must not throw
  clearEnglishCache(); // recompute from scratch, not a cache hit
  const again = toEnglish(code, kind, { style });
  assert.deepEqual(again, r); // property 2: deterministic
  assert.deepEqual(toEnglish(code, kind, { style }), r); // and the cached answer is the same
  assert.equal(r.english, `${r.title}: ${r.steps.map((s) => s.english).join('; then ')}.`); // property 3
  for (const s of r.steps) {
    assert.equal(code.slice(s.start, s.end), s.code);
    for (const tk of s.tokens) {
      assert.equal(typeof tk.text, 'string');
      if (tk.start == null) continue;
      assert.ok(tk.start >= s.start && tk.end <= s.end && tk.start <= tk.end, `chip '${tk.text}' [${tk.start},${tk.end}] outside step [${s.start},${s.end}]`); // property 4
    }
    for (const u of s.unhandled) {
      if (u.start != null) assert.ok(u.start >= s.start && u.end <= s.end, `unhandled ${u.type} outside its step`);
    }
  }
  return r;
}

test('property: toEnglish never throws, is deterministic, steps join to english, chips sit inside their step (generated)', () => {
  fc.assert(
    fc.property(fnSource, (src) => {
      fc.pre(parses(src));
      checkDescription(src);
    }),
    FC,
  );
});

test('property: the generated grammar mostly parses (guards against a vacuous property)', () => {
  const sample = fc.sample(fnSource, { seed: SEED, numRuns: 200 });
  const ok = sample.filter(parses).length;
  assert.ok(ok / sample.length > 0.8, `only ${ok}/${sample.length} generated functions parse`);
});

test('property: unplug(src, plug(src)) === src (generated modules)', () => {
  const moduleSrc = fc.tuple(fc.array(fnSource, { minLength: 1, maxLength: 3 }), fc.boolean()).map(([fns, header]) => {
    const decls = fns.map((f, i) => (f.kind === 'method'
      ? `export class K${i} {\n  ${f.code.replace(/\n/g, '\n  ')}\n}`
      : f.code.replace('function run', `function run${i}`)));
    return `${header ? "import { z } from 'lib';\n\n" : ''}${decls.join('\n\n')}\n`;
  });
  fc.assert(
    fc.property(moduleSrc, (src) => {
      let plugged;
      try {
        parser.parse(src, PARSE);
        plugged = plug(src);
      } catch {
        fc.pre(false);
      }
      assert.equal(unplug(src, plugged).updated, src);
    }),
    { ...FC, numRuns: Math.max(50, Math.floor(RUNS / 3)) },
  );
});

const live = corpus.loadCorpus();

test('property over the corpus: every function satisfies properties 1-4', { skip: !live.files.length && 'no corpus (set SMITH_CORPUS)' }, () => {
  for (const fn of live.functions) {
    try {
      checkDescription(fn);
    } catch (e) {
      e.message = `${fn.file} :: ${fn.name}: ${e.message}`;
      throw e;
    }
  }
});

test('property over the corpus: unplug(src, plug(src)) === src for every file plug accepts', { skip: !live.files.length && 'no corpus (set SMITH_CORPUS)' }, () => {
  const refused = [];
  for (const { file, src } of live.sources) {
    let plugged;
    try {
      plugged = plug(src);
    } catch (e) {
      refused.push(file);
      continue;
    }
    assert.equal(unplug(src, plugged).updated, src, `round trip changed ${file}`);
  }
  assert.ok(refused.length <= live.sources.length * 0.05, `plug refused ${refused.length}/${live.sources.length} corpus files: ${refused.slice(0, 5).join(', ')}`);
});
