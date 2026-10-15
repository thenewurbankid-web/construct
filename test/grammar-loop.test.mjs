import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { ts } from '../packages/ast/index.mjs';
import { evaluateLexicon, evaluateSource, lintSentence } from '../packages/core/grammar-eval.mjs';
import { parseAnswer, questionsFor, correctGaps, markerTypes, markFunction, lemmaOf } from '../packages/core/corrections.mjs';
import { setMarkedFunctions, nominalize, mapUserCall } from '../packages/core/user-lexicon.mjs';
import { planAtoms, applyAtom, applyAtoms, atomQuestion, nameFromAnswer } from '../packages/core/atoms.mjs';
import { describeImplementation } from '../packages/core/prose.mjs';
import { extractWithPlaceholders, namingSheet, suggestNames, parseOptions, applyNames, optionsQuestion } from '../packages/core/naming.mjs';

const ref = (js) => ({ english: `\`${js}\``, js, bare: null });

test('closed system: every lexicon sentence, in every argument shape, lints clean, reads back and compiles', () => {
  const { checked, failures } = evaluateLexicon();
  assert.ok(checked > 1000, `swept only ${checked} sentences`);
  assert.deepEqual(failures, []);
});

test('closed system: every exported declaration in packages/core reads as clean English with no gaps', () => {
  const files = execSync("git ls-files 'packages/core/*.mjs'", { encoding: 'utf8' }).trim().split('\n').filter((f) => !f.endsWith('.test.mjs'));
  const { checked, failures, gaps } = evaluateSource(files);
  assert.ok(checked > 200, `swept only ${checked} declarations`);
  assert.deepEqual(failures.map((f) => `${f.file}:${f.line} ${f.problem}`), []);
  assert.deepEqual(gaps.map((g) => `${g.file}:${g.line}`), []);
});

test('lint catches the grammar slips a reader used to have to spot', () => {
  assert.ok(lintSentence('parses the to ast with `source`').includes('article before a particle'));
  assert.ok(lintSentence('logs the in with `user`').includes('article before a particle'));
  assert.ok(lintSentence('returns a apple').includes('"a" before a vowel sound'));
  assert.ok(lintSentence('sets `x` to x.y(z)').includes('raw code outside backticks'));
  assert.deepEqual(lintSentence("sets the browser-storage key 'a(b)' to `f(x)`"), [], 'code and data spans are not English');
});

test('corrections: questions are plain English, never code', () => {
  const q = questionsFor({ name: 'parseToAst', inputs: ['source'] });
  assert.match(q.does, /called “parse to ast”, and it is given “source”/);
  for (const text of [q.does, q.rename]) assert.doesNotMatch(text, /[`(){};=]/);
});

test('corrections: an answer is parsed through the grammar, with "it" marking the inputs', () => {
  assert.equal(lemmaOf('turns'), 'turn');
  assert.equal(lemmaOf('copies'), 'copy');
  assert.equal(lemmaOf('fetches'), 'fetch');
  assert.equal(lemmaOf('turn'), null);
  const ok = parseAnswer('parseToAst', 'Turns it into a syntax tree.');
  assert.ok('type' in ok);
  assert.equal(ok.english, 'turns `input` into a syntax tree');
  const value = parseAnswer('total', 'the sum of it');
  assert.equal(value.english, 'the sum of `input`');
  assert.match(parseAnswer('x', 'parse(source)').error, /plain words/);
  assert.match(parseAnswer('x', 'turn it into a tree').error, /action word/);
  assert.match(parseAnswer('x', 'turns the to ast').error, /reads badly/);
});

test('corrections: the loop re-asks with the reason, marks the function with what parses, and the mapper uses the marker', async () => {
  const answers = ['parse it', 'Turns it into a syntax tree.', 'build syntax tree'];
  const asked = [];
  const { accepted, rejected } = await correctGaps([{ name: 'parseToAst', inputs: ['source'] }], async (q) => (asked.push(q), answers.shift()));
  assert.equal(rejected.length, 0);
  assert.deepEqual(accepted.map((a) => [a.name, a.does, a.rename]), [['parseToAst', 'Turns it into a syntax tree.', 'buildSyntaxTree']]);
  assert.match(asked[1], /Your last answer was “parse it”\. “parse” is not an action word/);
  const defining = markFunction('export function parseToAst(source) {\n  return acorn.parse(source, { ecmaVersion: 2022 });\n}\n', 'parseToAst', accepted[0].does);
  assert.match(defining, /^\/\*\* @does Turns it into a syntax tree \*\/\nexport function parseToAst/);
  assert.equal(describeImplementation(defining), 'Takes `source` as input. Turns `source` into a syntax tree.', 'a marked function reads by its marker, not its internals');
  try {
    setMarkedFunctions(markerTypes([{ file: 'ast.ts', source: defining }]));
    assert.equal(describeImplementation('export function f(source) { return parseToAst(source); }'), 'Takes `source` as input. Returns the result of turning `source` into a syntax tree.');
  } finally {
    setMarkedFunctions(new Map());
  }
});

test('markers: an existing doc comment gains the marker; a second answer replaces the first', () => {
  const src = '/**\n * Parses source.\n */\nexport const parseToAst = (source) => acorn.parse(source);\n';
  const once = markFunction(src, 'parseToAst', 'turns it into a tree');
  assert.match(once, /\* Parses source\.\n \* @does turns it into a tree\n \*\//);
  const twice = markFunction(once, 'parseToAst', 'turns it into a syntax tree');
  assert.equal((twice.match(/@does/g) || []).length, 1);
  assert.match(twice, /@does turns it into a syntax tree/);
  assert.equal(markFunction(src, 'missing', 'x'), null);
});

test('user domain: a name only guessable from its words is flagged uncertain, not trusted', () => {
  assert.ok(mapUserCall('parseToAst').uncertain);
  assert.ok(mapUserCall('frobnicate').uncertain);
  assert.equal(mapUserCall('startSession').uncertain, undefined);
});

test('a function handed over reads as its gerund; one-word names and variables stay references', () => {
  assert.equal(nominalize('activateAccount'), 'activating the account');
  assert.equal(nominalize('save'), null);
  assert.equal(nominalize('userName'), null);
  const sentence = new (mapUserCall('handleAction'))({ args: [{ english: 'activating the account', js: 'activateAccount', bare: null }], target: null });
  assert.equal(sentence.toEnglish(), 'handles activating the account');
});

const CHECKOUT = `export async function checkout(order, user) {
  const total = order.items.reduce((sum, i) => sum + i.price * i.qty, 0) * (1 + (user.region === 'EU' ? 0.2 : 0.07)) - (user.coupon ? Math.min(user.coupon.amount, order.items.length * 5) : 0);
  if (total > 0) await chargeCard(user, total);
  return total;
}
`;

test('atoms: bottom-up, the smallest expression that does not read is planned first, with its inputs', () => {
  const { atoms, needsPerson } = planAtoms(CHECKOUT, 'checkout.ts');
  assert.equal(needsPerson.length, 0);
  assert.equal(atoms[0].kind, 'expr');
  assert.equal(atoms[0].raw, 'order.items.reduce((sum, i) => sum + i.price * i.qty, 0)');
  assert.deepEqual(atoms[0].inputs, ['order']);
  assert.doesNotMatch(atomQuestion(atoms[0]), /`/);
});

test('atoms: each answer names a top-level marked function; lifting repeats until the statement reads as one sentence', () => {
  const answers = ['add up the item prices', 'work out the tax rate', 'work out the discount'];
  assert.deepEqual(nameFromAnswer('work out the order total'), { name: 'workOutOrderTotal', does: 'works out the order total' });
  assert.match(nameFromAnswer('works out the total').error, /plain action word/);
  let out = CHECKOUT;
  const names = [];
  for (let next = planAtoms(out, 'checkout.ts').atoms[0]; next; next = planAtoms(out, 'checkout.ts').atoms[0]) {
    const named = nameFromAnswer(answers.shift());
    names.push(named.name);
    out = applyAtom(out, next, named.name, named.does);
    assert.ok(names.length <= 3, 'lifting terminates');
  }
  assert.deepEqual(names, ['addUpItemPrices', 'workOutTaxRate']);
  const parsed = ts.createSourceFile('out.ts', out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.deepEqual(parsed.parseDiagnostics, [], 'the rewritten source parses');
  assert.match(out, /const total = addUpItemPrices\(order\) \* \(workOutTaxRate\(user\)\) - /);
  assert.match(out, /\/\*\* @does adds up the item prices \*\/\nfunction addUpItemPrices\(order\) \{\n  return order\.items\.reduce/);
  try {
    setMarkedFunctions(markerTypes([{ file: 'checkout.ts', source: out }]));
    const english = describeImplementation(out.slice(0, out.indexOf('\n}\n') + 2));
    assert.match(english, /Declares `total` as the result of adding up the item prices using `order` times the result of working out the tax rate using `user` minus/);
  } finally {
    setMarkedFunctions(new Map());
  }
});

test('atoms: a long condition is lifted even when the loop around it returns from the middle', () => {
  const src = `function f(items) {
  for (const item of items) { if (item.a && item.b && item.c && item.d && item.e && item.f && item.g && item.h && item.i && item.j && item.k && item.l && item.m && item.n && item.o && item.p && item.q && item.r && item.s && item.t) return item; }
  return null;
}`;
  const { atoms, needsPerson } = planAtoms(src, 'f.ts');
  assert.equal(needsPerson.length, 0);
  assert.equal(atoms[0].kind, 'expr');
  assert.deepEqual(atoms[0].inputs, ['item']);
});

test('atoms: a statement with nothing liftable that leaves the function from the middle needs a person, and says why', () => {
  const branches = Array.from({ length: 14 }, (_, i) => `if (item.k${i}) return item.v${i};`).join(' ');
  const src = `function f(items) {\n  for (const item of items) { ${branches} }\n  return null;\n}`;
  const { atoms, needsPerson } = planAtoms(src, 'f.ts');
  assert.equal(atoms.length, 0);
  assert.equal(needsPerson.length, 1);
  assert.match(needsPerson[0].problem, /leaves the function from the middle/);
});

test('atoms: one pass collects non-overlapping pieces and applies them all at once', () => {
  const { atoms } = planAtoms(CHECKOUT, 'checkout.ts');
  assert.deepEqual(atoms.map((a) => a.raw), [
    'order.items.reduce((sum, i) => sum + i.price * i.qty, 0)',
    "1 + (user.region === 'EU' ? 0.2 : 0.07)",
    'user.coupon ? Math.min(user.coupon.amount, order.items.length * 5) : 0',
  ]);
  const out = applyAtoms(CHECKOUT, [
    { atom: atoms[0], ...nameFromAnswer('add up the item prices') },
    { atom: atoms[1], ...nameFromAnswer('work out the tax rate') },
    { atom: atoms[2], ...nameFromAnswer('work out the discount') },
  ]);
  assert.match(out, /const total = addUpItemPrices\(order\) \* \(workOutTaxRate\(user\)\) - \(workOutDiscount\(user, order\)\);/);
  assert.match(out, /\/\*\* @does adds up the item prices \*\/\nfunction addUpItemPrices\(order\)/);
  assert.match(out, /\/\*\* @does works out the tax rate \*\/\nfunction workOutTaxRate\(user\)/);
  assert.deepEqual(ts.createSourceFile('out.ts', out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics, []);
  assert.deepEqual(planAtoms(out, 'checkout.ts').atoms, []);
});

test('corrections: a model can be asked several names at once; results keep the order asked', async () => {
  const gaps = ['parseToAst', 'frobnicate', 'zorch'].map((name) => ({ name, inputs: ['x'] }));
  let inFlight = 0;
  let peak = 0;
  const ask = async (q) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return /clearer name/.test(q) ? 'clear name' : 'turns it into a tree';
  };
  const { accepted } = await correctGaps(gaps, ask, { concurrency: 3 });
  assert.deepEqual(accepted.map((a) => a.name), ['parseToAst', 'frobnicate', 'zorch']);
  assert.equal(peak, 3);
});

test('batch naming: every atom is lifted at once under a placeholder, and the code still parses', () => {
  const { source, placeholders } = extractWithPlaceholders(CHECKOUT, 'checkout.ts');
  assert.deepEqual(placeholders, ['pendingName1', 'pendingName2', 'pendingName3']);
  assert.match(source, /const total = pendingName1\(order\) \* \(pendingName2\(user\)\) - \(pendingName3\(user, order\)\);/);
  assert.match(source, /\/\*\* @pending the single value .* \*\/\nfunction pendingName1\(order\)/);
  assert.deepEqual(ts.createSourceFile('c.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics, []);
});

test('batch naming: the sheet shows each placeholder\'s code, our English and options read off the code', () => {
  const { source } = extractWithPlaceholders(CHECKOUT, 'checkout.ts');
  const sheet = namingSheet(source, 'checkout.ts');
  assert.deepEqual(sheet.map((e) => e.snippet), ['order.items.reduce((sum, i) => sum + i.price * i.qty, 0)', "1 + (user.region === 'EU' ? 0.2 : 0.07)", 'user.coupon ? Math.min(user.coupon.amount, order.items.length * 5) : 0']);
  assert.equal(sheet[0].options[0], 'add up the order items');
  assert.equal(sheet[1].options[0], 'work out the user region');
  assert.equal(sheet[2].options[0], 'choose the user coupon');
  assert.deepEqual(suggestNames('{ id: user.id, name: user.fullName }')[0], 'build the user id');
  assert.doesNotMatch(optionsQuestion(sheet[0]), /`|=>|\(sum/, 'the model is given the English only');
});

test('batch naming: model replies become options; choices rename placeholders everywhere and become @does markers', () => {
  assert.deepEqual(parseOptions('1. Add up the prices\n2) "work out the subtotal"\n- totals the cart\nsum(x)'), ['add up the prices', 'work out the subtotal']);
  const { source } = extractWithPlaceholders(CHECKOUT, 'checkout.ts');
  const sheet = namingSheet(source, 'checkout.ts');
  sheet[0].choice = 'add up the item prices';
  sheet[1].choice = 'work out the tax rate';
  sheet[2].choice = 'works out the discount';
  const { source: out, applied, skipped } = applyNames(source, sheet, 'checkout.ts');
  assert.deepEqual(applied.map((a) => a.name), ['addUpItemPrices', 'workOutTaxRate']);
  assert.match(skipped[0].error, /plain action word/);
  assert.match(out, /const total = addUpItemPrices\(order\) \* \(workOutTaxRate\(user\)\) - \(pendingName3\(user, order\)\);/);
  assert.match(out, /\/\*\* @does adds up the item prices \*\/\nfunction addUpItemPrices\(order\)/);
  assert.match(out, /\/\*\* @pending .* \*\/\nfunction pendingName3/);
});
