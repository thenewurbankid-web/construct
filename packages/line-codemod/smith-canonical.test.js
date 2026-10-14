// q2: equivalent code reads as the same English under { canonical: true }.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { toEnglish } = require('./to-english');
const corpus = require('./bench/corpus');

const SEED = Number(process.env.SMITH_FC_SEED || 20261014);
const RUNS = Number(process.env.SMITH_FC_RUNS || 300);
const FC = { seed: SEED, numRuns: RUNS };

const SIG = 'a: number, b: number, flag: boolean, user: User, items: Item[]';
const fn = (body) => `function run(${SIG}) {\n  ${body}\n}`;
const STYLES = ['plain', 'exact'];
const canon = (code, kind = 'function', style = 'exact') => toEnglish(code, kind, { canonical: true, style }).english;

// ---- examples: each pair reads identically -------------------------------------
const PAIRS = {
  'ternary vs if/else vs early return': [
    "return user.isAvailable ? 'Available' : 'On loan';",
    "if (user.isAvailable) {\n    return 'Available';\n  } else {\n    return 'On loan';\n  }",
    "if (user.isAvailable) return 'Available';\n  return 'On loan';",
  ],
  'ternary tautology vs plain condition': ['return a > 1 ? true : false;', 'return a > 1;'],
  '!flag vs flag === false (flag: boolean)': ['if (!flag) {\n    log(a);\n  }', 'if (flag === false) {\n    log(a);\n  }', 'if (false == flag) log(a);', 'if (flag !== true) log(a);'],
  'flag vs flag === true / !!flag': ['return flag;', 'return flag === true;', 'return flag !== false;', 'return !!flag;'],
  'early return vs if/else with more steps': [
    'if (a > b) {\n    log(a);\n    return a;\n  } else {\n    log(b);\n    return b;\n  }',
    'if (a > b) {\n    log(a);\n    return a;\n  }\n  log(b);\n  return b;',
  ],
  'a && b guard vs nested if': ['if (a > 1 && flag) {\n    user.save();\n  }', 'if (a > 1) {\n    if (flag) {\n      user.save();\n    }\n  }', 'if (a > 1) if (flag) user.save();'],
  'a && f() statement vs if': ['flag && user.save();', 'if (flag) {\n    user.save();\n  }'],
  'x ? x : y vs x || y': ['return user.name ? user.name : b;', 'return user.name || b;'],
  'grouping and chain association': ['return (a > 1) && (flag && b > 2);', 'return a > 1 && flag && b > 2;'],
};

for (const style of STYLES) {
  for (const [name, forms] of Object.entries(PAIRS)) {
    test(`canonical (${style}): ${name} read the same`, () => {
      const english = forms.map((f) => canon(fn(f), 'function', style));
      for (const e of english) assert.equal(e, english[0]);
    });
  }
}

test('canonical: the K5 shape -- a ternary and the if/return plan read the same', () => {
  const ternary = canon(`function status(book) {\n  return book.available ? 'Available' : 'On loan';\n}`);
  const plan = canon(`function status(book) {\n  if (book.available) {\n    return 'Available';\n  }\n  return 'On loan';\n}`);
  assert.equal(ternary, plan);
  assert.equal(plan, "status using book: if book's available: return 'Available'; then return 'On loan'.");
  assert.equal(canon(`function status(book) {\n  return book.available ? 'Available' : 'On loan';\n}`, 'function', 'plain'), "status using book: if book's available, return 'Available'; then return 'On loan'.");
});

test('canonical: an arrow with an expression body and its block twin read the same', () => {
  assert.equal(canon('const run = (c) => c ? 1 : 2;'), canon('function run(c) {\n  if (c) return 1;\n  return 2;\n}'));
  assert.equal(canon(fn('return items.map((i) => { return i.id; });')), canon(fn('return items.map((i) => i.id);')));
});

test('canonical: === false is NOT folded into ! when the value is not known boolean', () => {
  assert.equal(canon(fn('return a === false;')), 'run using a and b and flag and user and items: return a === false.');
  assert.equal(canon('function f(flag: boolean) {\n  const flag2 = 1;\n  return flag === false;\n}'), 'f using flag: let flag2 be 1; then return not (flag).');
});

test('canonical is off by default: the plain reading is unchanged', () => {
  const code = fn("return user.isAvailable ? 'Available' : 'On loan';");
  assert.equal(toEnglish(code, 'function', { style: 'exact' }).english, "run using a and b and flag and user and items: return if user's is available then 'Available', otherwise 'On loan'.");
  assert.notEqual(toEnglish(code, 'function', { style: 'exact' }).english, canon(code));
  assert.notEqual(toEnglish(code, 'function').english, canon(code, 'function', 'plain'));
});

test('canonical keeps every step and chip pointing into the original source', () => {
  const code = fn("if (a > b) {\n    log(a);\n    return a ? a : b;\n  } else {\n    flag && user.save();\n    return b;\n  }");
  const r = toEnglish(code, 'function', { canonical: true });
  assert.equal(r.english, `${r.title}: ${r.steps.map((s) => s.english).join('; then ')}.`);
  for (const s of r.steps) {
    assert.equal(code.slice(s.start, s.end), s.code);
    for (const tk of s.tokens) if (tk.start != null) assert.ok(tk.start >= s.start && tk.end <= s.end);
  }
});

// ---- properties ---------------------------------------------------------------
const cond = fc.constantFrom('a > 1', 'user.isValid', 'flag', '!flag', 'a === b', 'items.length', '(a > 1)', 'a > 1 && flag', '(a < 2) && (flag || b > 3)', 'flag || a < 2');
const values = fc.uniqueArray(fc.constantFrom("'Available'", "'On loan'", 'a + 1', 'b', 'user.name', '0', 'null', 'items[0]', 'compute(a, b)'), { minLength: 2, maxLength: 2 });
const pure = fc.constantFrom('a', 'user.name', 'items.length', 'user.profile.email');
const sideEffect = fc.constantFrom('log(a);', 'b++;', 'user.save();', 'items.push(a);');
const boolCtx = fc.constantFrom((x) => `if (${x}) {\n    log(a);\n  }`, (x) => `return ${x};`, (x) => `const ok = ${x};\n  return ok;`, (x) => `return ${x} && a > 1;`);

const ternaryForms = (c, x, y) => [
  `return ${c} ? ${x} : ${y};`,
  `if (${c}) {\n    return ${x};\n  } else {\n    return ${y};\n  }`,
  `if (${c}) return ${x};\n  return ${y};`,
  `if (${c}) {\n    return ${x};\n  }\n  return ${y};`,
];

// One generated equivalent pair: [formA, formB, label].
const equivalentPair = fc.oneof(
  fc.tuple(cond, values, fc.nat(3), fc.nat(3)).map(([c, [x, y], i, j]) => [ternaryForms(c, x, y)[i], ternaryForms(c, x, y)[j], 'ternary/if']),
  fc.tuple(boolCtx, fc.constantFrom('flag === false', 'false === flag', 'flag == false', 'flag !== true', '!!(!flag)')).map(([ctx, alt]) => [ctx('!flag'), ctx(alt), '!flag']),
  fc.tuple(boolCtx, fc.constantFrom('flag === true', 'true == flag', 'flag !== false', '!!flag')).map(([ctx, alt]) => [ctx('flag'), ctx(alt), 'flag']),
  fc.tuple(cond, sideEffect, sideEffect, values).map(([c, s1, s2, [x, y]]) => [
    `if (${c}) {\n    ${s1}\n    return ${x};\n  } else {\n    ${s2}\n    return ${y};\n  }`,
    `if (${c}) {\n    ${s1}\n    return ${x};\n  }\n  ${s2}\n  return ${y};`,
    'early return',
  ]),
  fc.tuple(cond, cond, sideEffect).map(([c1, c2, s]) => [`if ((${c1}) && (${c2})) {\n    ${s}\n  }`, `if (${c1}) {\n    if (${c2}) {\n      ${s}\n    }\n  }`, 'nested if']),
  fc.tuple(cond, fc.constantFrom('user.save()', 'log(a)', 'items.push(b)')).map(([c, call]) => [`(${c}) && ${call};`, `if (${c}) {\n    ${call};\n  }`, 'guard']),
  fc.tuple(pure, values).map(([p, [, y]]) => [`return ${p} ? ${p} : ${y};`, `return ${p} || ${y};`, 'self-default']),
);

const withContext = fc.tuple(equivalentPair, fc.option(sideEffect), fc.boolean()).map(([[x, y, label], prefix, method]) => {
  const wrap = (body) => {
    const full = prefix ? `${prefix}\n  ${body}` : body;
    return method ? { kind: 'method', code: `run(${SIG}) {\n  ${full}\n}` } : { kind: 'function', code: fn(full) };
  };
  return { a: wrap(x), b: wrap(y), label };
});

for (const style of STYLES) {
  test(`property (${style}): generated equivalent forms read as the same English (canonical)`, () => {
    fc.assert(
      fc.property(withContext, ({ a, b }) => {
        assert.equal(canon(a.code, a.kind, style), canon(b.code, b.kind, style));
      }),
      FC,
    );
  });
}

test('property (negative): swapping the branches changes the English', () => {
  const swapped = fc.tuple(cond, values, fc.nat(3), fc.nat(3)).map(([c, [x, y], i, j]) => [ternaryForms(c, x, y)[i], ternaryForms(c, y, x)[j]]);
  fc.assert(
    fc.property(swapped, ([x, y]) => {
      for (const style of STYLES) assert.notEqual(canon(fn(x), 'function', style), canon(fn(y), 'function', style));
    }),
    FC,
  );
});

test('property (negative): negating the condition changes the English', () => {
  fc.assert(
    fc.property(fc.constantFrom('a > 1', 'user.isValid', 'flag', 'a === b'), values, (c, [x, y]) => {
      for (const style of STYLES) assert.notEqual(canon(fn(`return ${c} ? ${x} : ${y};`), 'function', style), canon(fn(`return !(${c}) ? ${x} : ${y};`), 'function', style));
    }),
    FC,
  );
});

const live = corpus.loadCorpus();

test('canonical over the corpus: never throws, no placeholders, steps join, chips inside their step', { skip: !live.files.length && 'no corpus (set SMITH_CORPUS)' }, () => {
  for (const f of live.functions) for (const style of STYLES) {
    const r = toEnglish(f.code, f.kind, { canonical: true, style });
    assert.deepEqual(r.unhandled, [], `${f.file} :: ${f.name}`);
    assert.equal(r.english, `${r.title}: ${r.steps.map((s) => s.english).join('; then ')}.`);
    assert.deepEqual(toEnglish(f.code, f.kind, { canonical: true, style }), r);
    for (const s of r.steps) {
      assert.equal(f.code.slice(s.start, s.end), s.code, `${f.file} :: ${f.name}`);
      for (const tk of s.tokens) if (tk.start != null) assert.ok(tk.start >= s.start && tk.end <= s.end, `${f.file} :: ${f.name} chip ${tk.text}`);
    }
  }
});
