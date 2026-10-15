// Atomic English (ENGLISH-RULES.md): every catalog `fluent` sentence is held to the rules.
//   R1 verbs are third person singular: no base forms (sort), no participles (sorted)
//   R3 one argument per word, and the word that carries it names its role
//   R4 questions use is / has / can / does, split into words (no greaterThan)
//   R5 a changed copy starts clones().<subject>(x).and(); in-place atoms and questions never clone
//   R10 a sentence ends .andThe().<name>(), the name the rules give what it returns (lib-return.mjs)
// plus R8: naming.json grammar.plainNames is the plain name each sentence gives, and R9: inside an
// every() sentence (a binder and in(list)), participles, -ing forms and is()-actions are allowed,
// the body is one atom, and the first word decides the result.
// The words a sentence may use are listed in naming.json `grammar` (R9's in `grammar.every`).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, plainName, reading } from '../scripts/lib-sentence.mjs';
import { RETURN_WORD, returnClauseOf, returnNameOf, withoutReturn } from '../scripts/lib-return.mjs';

const catalog = JSON.parse(readFileSync(new URL('../src/atoms/catalog.json', import.meta.url), 'utf8'));
const naming = JSON.parse(readFileSync(new URL('../src/atoms/naming.json', import.meta.url), 'utf8'));
const g = naming.grammar;
const withFluent = catalog.atoms.filter((a) => a.fluent);

const verbs = new Set(g.verbs);
const questionWords = new Set(g.questionWords);
const subjects = new Set(g.subjects);
const roleWords = new Set(g.roleWords);
const argumentVerbs = new Set(Object.keys(g.argumentVerbs));
const vocabulary = new Set([...g.verbs, ...g.questionWords, ...g.subjects, ...g.connectors, ...g.roleWords, ...g.words, ...argumentVerbs]);
// The base forms of the listed verbs (sorts -> sort, matches -> match) and the irregular ones (has -> have).
const baseForms = new Set([
  ...g.verbs.flatMap((v) => [v.slice(0, -1), ...(v.endsWith('es') ? [v.slice(0, -2)] : [])]),
  ...Object.values(g.irregularBaseForms),
]);
// Logic operators that read as connectors, not questions (checks().if(a).and(() => b)).
const OPERATORS = new Set(['and', 'or', 'not']);
// R9: every() sentences.
const ev = g.every;
const binders = new Set(ev.binders);
const placeholders = new Set(ev.placeholders);
const participles = new Set(ev.participles);
const gerunds = new Set(ev.gerunds);
const everyRoleWords = new Set(ev.roleWords);
const everyWords = new Set([...ev.participles, ...ev.gerunds, ...ev.roleWords, ...ev.words, ...ev.binders]);
const bodyAtoms = new Set(Object.keys(ev.bodyAtoms));
// The words before the binder, and the binders, each start allows.
const OPENINGS = { every: ['', ['every']], checks: ['checks.if', ['every', 'any']], the: ['the', ['first']], folds: ['folds', ['every']] };
// What each plain-JS callback returns, by its method.
const JS_KINDS = { map: 'list', filter: 'list', every: 'boolean', some: 'boolean', find: 'item', reduce: 'value', forEach: 'nothing' };
/** A kind as it is said: "a list", "an item", "nothing". */
const said = (kind) => (kind === 'nothing' ? 'nothing' : `${kind === 'item' ? 'an' : 'a'} ${kind}`);
const R9_KINDS = new Set(Object.values(ev.starts));
const booleanName = new RegExp(`^(${naming.booleanPrefixes.join('|')})[A-Z]`);

/** What the atom is, as far as the rules care: a question, a changed copy, or in place. */
function kindOf(a) {
  if (a.mutates) return 'inPlace';
  if (a.returnsCopy || a.replacesMutation) return 'copy';
  if (booleanName.test(a.atom) || (naming.booleanExempt.includes(a.atom) && !OPERATORS.has(a.atom))) return 'question';
  return 'other';
}

/** Every rule a sentence breaks, as readable messages; empty when it follows them all. */
/** R10: the sentence ends with the return clause the rules derive, and nothing after its name. */
function returnViolations(sentence) {
  let clause;
  try {
    clause = returnClauseOf(sentence);
  } catch {
    return [];
  }
  const want = returnNameOf(sentence, g.returnNames);
  if (!clause) return [`R10: the sentence does not say what it returns; end it with .${RETURN_WORD}().${want}()`];
  const out = [];
  if (clause.name !== want) out.push(`R10: it returns its ${want}; end it with .${RETURN_WORD}().${want}(), not .${clause.name}()`);
  if (clause.extra) out.push(`R10: nothing follows .${RETURN_WORD}().${clause.name}()`);
  return out;
}

function violations(sentence, kind) {
  return [...returnViolations(sentence), ...actionViolations(withoutReturn(sentence), kind)];
}

function actionViolations(sentence, kind) {
  const out = [];
  let calls;
  try {
    calls = parse(sentence);
  } catch (e) {
    return [`does not parse: ${e.message}`];
  }
  // R9: an every() sentence binds its item with a binder, maybe its index with at(i), and then
  // in(list); what follows the in() is inside it.
  const named = (c, word) => c?.word === word && c.args.length === 1 && placeholders.has(c.args[0]);
  const inOf = (i) => {
    const j = named(calls[i + 1], 'at') ? i + 2 : i + 1;
    return calls[j]?.word === 'in' && calls[j].args.length === 1 ? j : -1;
  };
  const binds = (c, i) => binders.has(c.word) && named(c, c.word) && inOf(i) >= 0;
  const indexes = (c, i) => i > 0 && binds(calls[i - 1], i - 1) && named(c, 'at');
  const bound = calls.findIndex(binds);
  const opened = bound >= 0 ? inOf(bound) : -1;
  // The names bound so far: each binder (nested ones too, every(y).in(x)), its at(i), and into(total).
  const names = new Set();
  const boundAt = calls.map((c, i) => {
    const before = new Set(names);
    if (binds(c, i) || indexes(c, i) || named(c, 'into')) names.add(c.args[0]);
    return before;
  });
  calls.forEach(({ word, args }, i) => {
    const inside = bound >= 0 && i > opened;
    const known = vocabulary.has(word) || (bound >= 0 && everyWords.has(word));
    // R4 (split into words) and R1: one lowercase English word per call.
    if (!/^[a-z]+$/.test(word)) out.push(`R4: ${word}() is not a single word; split it (greaterThan -> greater().than())`);
    else if (participles.has(word) || gerunds.has(word)) {
      if (!inside) out.push(`R1: ${word}() is a ${participles.has(word) ? 'past participle' : '-ing form'}, allowed only inside an every() sentence (R9)`);
      if (!inside && participles.has(word) && calls[i - 1]?.word === 'is') out.push(`R4: is().${word}() is an action, allowed only inside an every() sentence (R9)`);
    } else if (word.endsWith('ed')) out.push(`R1: ${word}() is a past participle; use the third-person verb`);
    else if (baseForms.has(word) && !known) out.push(`R1: ${word}() is a base form; use the third-person verb`);
    else if (!known && everyWords.has(word)) out.push(`R9: ${word}() belongs to every() sentences only`);
    else if (!known) out.push(`grammar: ${word}() is not in naming.json grammar; add it to the class it belongs to`);
    // R3: at most one argument, carried by a role word (or a subject, or an approved argument verb).
    if (args.length > 1) out.push(`R3: ${word}() takes ${args.length} arguments; give each its own word`);
    const binding = binds(calls[i], i) || indexes(calls[i], i);
    const carries = roleWords.has(word) || subjects.has(word) || argumentVerbs.has(word) || binding || (bound >= 0 && everyRoleWords.has(word));
    if (args.length && !carries) out.push(`R3: ${word}(${args[0]}) carries an argument but is not a role word`);
    // R9: a body names only the placeholders its sentence binds.
    if (binding && boundAt[i].has(args[0])) out.push(`R9: ${word}(${args[0]}): ${args[0]} is already bound; nested callbacks use different names`);
    else if (inside && word !== 'into' && !binding) for (const a of args) if (placeholders.has(a) && !boundAt[i].has(a)) out.push(`R9: ${a} is not bound in this sentence`);
    // R4: the question word itself carries nothing.
    if (questionWords.has(word) && args.length) out.push(`R4: ${word}() is a question word and takes no argument`);
  });
  const words = calls.map((c) => c.word);
  if (bound >= 0 || R9_KINDS.has(kind)) {
    // R9: the first word decides what the sentence returns, and the body is one atom.
    const start = ev.starts[words[0]];
    if (bound < 0) out.push(`R9: a sentence that returns ${said(kind)} binds its item: every(x).in(xs)`);
    else if (!start) out.push(`R9: an every() sentence starts with ${Object.keys(ev.starts).map((w) => `${w}()`).join(', ')}`);
    else {
      if (start !== kind) out.push(`R9: ${words[0]}() returns ${said(start)}, but this sentence returns ${said(kind)}`);
      const [before, allowed] = OPENINGS[words[0]];
      const opening = calls.slice(0, bound);
      if (opening.map((c) => c.word).join('.') !== before || opening.some((c) => c.args.length) || !allowed.includes(words[bound])) {
        out.push(`R9: ${words[0]}() opens as ${[...before.split('.').filter(Boolean).map((w) => `${w}()`), `${allowed.join('|')}(x)`].join('.')}.in(xs)`);
      }
    }
    const body = words.slice(opened + 1).filter((w) => bodyAtoms.has(w));
    if (body.length > 1) out.push(`R9: a body is one atom, and this one is ${body.join(' + ')}; name it as a molecule made of existing atoms (for example lineTotal), not a new atom`);
    return out;
  }
  const clones = words.indexOf('clones');
  if (kind === 'question') {
    const asks = calls.length > 3 && words[0] === 'checks' && words[1] === 'if' && questionWords.has(words[2]);
    if (!asks) out.push('R4: a question reads checks().if(x).is()/has()/can()/does() and then its words');
  }
  if (kind === 'copy') {
    const [c, subject, and, verb] = calls;
    const said = c?.word === 'clones' && !c.args.length && subjects.has(subject?.word) && subject.args.length === 1 && and?.word === 'and' && !and.args.length && verbs.has(verb?.word);
    if (!said) out.push('R5: a changed copy reads clones().<subject>(x).and().<verb>()');
    if (clones > 0) out.push('R5: clones() comes first');
  } else if (clones >= 0) {
    out.push(`R5: only an atom that returns a changed copy says clones() (this one is ${kind === 'inPlace' ? 'in place' : `a ${kind}`})`);
  }
  if (kind === 'inPlace' && !subjects.has(words[0])) out.push('R5: an atom that changes its input in place starts with its subject');
  return out;
}

describe('Atomic English grammar', () => {
  test('the grammar word lists are well formed', () => {
    for (const v of g.verbs) assert.match(v, /s$/, `${v} is not third person singular`);
    for (const w of vocabulary) assert.match(w, /^[a-z]+$/, w);
    assert.ok(withFluent.length > 0);
  });

  for (const a of withFluent) {
    test(`${a.atom}: ${a.fluent}`, () => {
      assert.deepEqual(violations(a.fluent, kindOf(a)), []);
      assert.equal(a.reads, reading(a.fluent), 'reads follows the sentence');
    });
  }

  test('R8: grammar.plainNames is the plain name of each sentence, and names no other atom', () => {
    const names = new Set(catalog.atoms.map((a) => a.atom));
    const want = {};
    for (const a of withFluent) {
      const p = plainName(a.fluent, g.subjects);
      if (p && p !== a.atom) want[a.atom] = p;
    }
    assert.deepEqual(g.plainNames, want);
    for (const [atom, p] of Object.entries(g.plainNames)) {
      assert.ok(!names.has(p), `${atom}'s plain name ${p} is already the name of another atom`);
      assert.equal(catalog.atoms.find((a) => a.atom === atom).plainName, p);
    }
  });

  test('a deprecated form is not the sentence', () => {
    for (const a of withFluent) if (a.fluentDeprecated) assert.notEqual(a.fluentDeprecated, a.fluent, a.atom);
  });

  test('the rules catch the forms they replace', () => {
    const bad = [
      ['checks().if(a).is().greaterThan(b)', 'question', 'R4'],
      ['checks().if(a).is(b)', 'question', 'R4'],
      ['list(xs).sortedBy(order)', 'copy', 'R4'],
      ['clones().text(s).and().trimmed()', 'copy', 'R1'],
      ['clones().list(xs).and().sort().by(order)', 'copy', 'R1'],
      ['choose().when(c1).yields(() => a).otherwise(() => b)', 'other', 'R1'],
      ['clones().text(s).and().replaces().first(p, r)', 'copy', 'R3'],
      ['clones().list(xs).and().sorts(order)', 'copy', 'R3'],
      ['list(xs).sorts().by(order)', 'copy', 'R5'],
      ['clones().text(s).trims()', 'copy', 'R5'],
      ['clones().list(xs).and().sorts().by(order)', 'inPlace', 'R5'],
      ['clones().list(xs).and().takes().first()', 'other', 'R5'],
      ['list(xs).frobnicates()', 'other', 'grammar'],
    ];
    for (const [sentence, kind, rule] of bad) {
      const found = violations(sentence, kind);
      assert.ok(found.some((v) => v.startsWith(rule)), `${sentence} (${kind}) should break ${rule}, got ${JSON.stringify(found)}`);
    }
    assert.deepEqual(violations('list(xs).sorts().by(order).andThe().sorted()', 'inPlace'), []);
  });

  test('R1/R4/R5 hold outside every(): no participles, -ing forms, is()-actions or every() words there', () => {
    const bad = [
      ['clones().list(xs).and().maps().each().mapped()', 'copy', 'R1'],
      ['list(xs).is().mapped()', 'other', 'R4'],
      ['list(xs).is().kept()', 'other', 'R4'],
      ['checks().if(n).is().multiplying(x)', 'question', 'R1'],
      ['clones().list(xs).and().maps().to().clone()', 'copy', 'R1'],
      ['checks().if(n).is().positive()', 'question', 'R9'],
      // A binder without in(list) does not open an every() sentence.
      ['every(x).is().mapped()', 'list', 'R1'],
    ];
    for (const [sentence, kind, rule] of bad) {
      const found = violations(sentence, kind);
      assert.ok(found.some((v) => v.startsWith(rule)), `${sentence} (${kind}) should break ${rule}, got ${JSON.stringify(found)}`);
    }
  });

  describe('R9: every() sentences', () => {
    test('the table covers map, filter, every, some, find and reduce, and each start is a known word', () => {
      const table = Object.fromEntries(Object.entries(JS_KINDS).filter(([m]) => m !== 'forEach'));
      assert.deepEqual(ev.sentences.map((s) => s.js.match(/^xs\.(\w+)/)[1]).sort(), Object.keys(table).sort());
      for (const w of Object.keys(ev.starts)) assert.ok(vocabulary.has(w) || everyWords.has(w), w);
      for (const atom of Object.values(ev.bodyAtoms)) assert.ok(catalog.atoms.some((a) => a.atom === atom), `${atom} is not an atom`);
      for (const p of ev.participles) assert.ok(!vocabulary.has(p), `${p} is also allowed outside every()`);
    });

    test('four first words, each with exactly one result kind (does() withdrawn by R11)', () => {
      assert.deepEqual(ev.starts, { every: 'list', checks: 'boolean', the: 'item', folds: 'value' });
      assert.equal(new Set(Object.values(ev.starts)).size, Object.keys(ev.starts).length, 'no two first words share a kind');
      assert.deepEqual(Object.keys(OPENINGS).sort(), Object.keys(ev.starts).sort());
      // Every R9 sentence is said by the first word of its kind, and every first word is used.
      const all = [...ev.sentences, ...ev.nested, ...ev.shapes, ...ev.async, ...ev.nestedAsync];
      const used = new Set(all.map((s) => s.fluent.match(/^(\w+)/)[1]));
      assert.deepEqual([...used].sort(), Object.keys(ev.starts).sort());
      for (const s of all) assert.equal(ev.starts[s.fluent.match(/^(\w+)/)[1]], s.kind ?? JS_KINDS[s.js.match(/^(?:xs|rows)\.(\w+)/)[1]], s.fluent);
    });

    for (const { js, fluent, kind: declared } of [...ev.sentences, ...ev.nested, ...ev.shapes, ...ev.async, ...ev.nestedAsync]) {
      const kind = declared ?? JS_KINDS[js.match(/^(?:xs|rows)\.(\w+)/)[1]];
      test(`${fluent} (${kind}, as ${js})`, () => {
        assert.deepEqual(violations(fluent, kind), []);
      });
    }

    test('the first word is checked against the result', () => {
      const bad = [
        ['every(x).in(xs).is().positive()', 'boolean', 'R9: every() returns a list'],
        ['the().first(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2)', 'list', 'R9: the() returns an item'],
        ['checks().if().every(x).in(xs).is().positive()', 'item', 'R9: checks() returns a boolean'],
        ['folds().every(x).in(xs).into(total).starting().at(0).by().adding(x).to(total)', 'list', 'R9: folds() returns a value'],
        ['checks().if().first(x).in(xs).is().positive()', 'boolean', 'R9: checks() opens as'],
        ['checks().if(n).every(x).in(xs).is().positive()', 'boolean', 'R9: checks() opens as'],
        ['list(xs).every(x).in(xs).is().positive()', 'boolean', 'R9: an every() sentence starts with'],
        ['clones().list(xs).and().maps().each().with(fn)', 'list', 'R9: a sentence that returns a list binds'],
        ['does().every(x).in(xs).by().multiplying(x).by(2)', 'nothing', 'R9: an every() sentence starts with'],
      ];
      for (const [sentence, kind, message] of bad) {
        const found = violations(sentence, kind);
        assert.ok(found.some((v) => v.startsWith(message)), `${sentence} (${kind}) should say "${message}", got ${JSON.stringify(found)}`);
      }
    });

    test('a body is one atom, on placeholders the sentence binds', () => {
      const bad = [
        ['every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2).and().adding(1).to(x)', 'list', 'R9: a body is one atom'],
        ['every(x).in(xs).is().kept().if(y).is().positive()', 'list', 'R9: y is not bound'],
        ['folds().every(x).in(xs).into(total).starting().at(0).by().adding(item).to(total)', 'value', 'R9: item is not bound'],
        ['every(x).in(rows).is().kept().if().any(x).in(x).is().positive()', 'list', 'R9: any(x): x is already bound'],
        ['every(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(i)', 'list', 'R9: i is not bound'],
        ['every(x).at(x).in(xs).is().mapped().to().clone().by().multiplying(x).by(2)', 'list', 'R9: at(x): x is already bound'],
        ['every(x).at(i).in(xs).is().mapped().to().clone().by().every(y).at(i).in(x).is().mapped().to().clone().by().multiplying(y).by(i)', 'list', 'R9: at(i): i is already bound'],
        ['every(x).in(rows).is().mapped().to().clone().by().every(y).in(item).is().mapped().to().clone().by().multiplying(y).by(2)', 'list', 'R9: item is not bound'],
      ];
      for (const [sentence, kind, message] of bad) {
        const found = violations(sentence, kind);
        assert.ok(found.some((v) => v.startsWith(message)), `${sentence} should say "${message}", got ${JSON.stringify(found)}`);
      }
    });

    test('in the catalog, the first word decides the kind too: checks() asks, clones() copies', () => {
      // and(): `checks().if(a).and(() => b)` returns a or b, not a yes or no (an open question for the owner).
      const NOT_YET = new Set(['and']);
      for (const a of withFluent) {
        const first = parse(a.fluent)[0].word;
        if (first === 'checks' && !NOT_YET.has(a.atom)) assert.equal(kindOf(a), 'question', `${a.atom}: ${a.fluent} starts with checks() but is not a question`);
        if (first === 'clones') assert.equal(kindOf(a), 'copy', `${a.atom}: ${a.fluent}`);
        if (kindOf(a) === 'question') assert.equal(first, 'checks', `${a.atom}: ${a.fluent}`);
      }
    });
  });

  test('R10: grammar.returned is exactly the set of names the rules give the sentences', () => {
    const pending = catalog.atoms.filter((a) => a.fluentPending).map((a) => a.fluentPending);
    const all = [...withFluent.map((a) => a.fluent), ...pending, ...ev.sentences.map((x) => x.fluent), ...ev.nested.map((x) => x.fluent), ...ev.shapes.map((x) => x.fluent)];
    assert.deepEqual([...new Set(all.map((x) => returnNameOf(x, g.returnNames)))].sort(), [...g.returned].sort());
  });

  test('R10: a missing, wrong or trailing return clause is refused', () => {
    assert.match(returnViolations('clones().text(s).and().trims()')[0], /^R10: the sentence does not say what it returns; end it with \.andThe\(\)\.trimmed\(\)$/);
    assert.match(returnViolations('clones().text(s).and().trims().andThe().cleaned()')[0], /^R10: it returns its trimmed/);
    assert.match(returnViolations('checks().if(a).is().text().andThe().answer().and()')[0], /^R10: nothing follows/);
    assert.deepEqual(returnViolations('text(s).splits().by(sep).andThe().parts()'), []);
  });

  test('summary', () => {
    const kinds = {};
    for (const a of withFluent) kinds[kindOf(a)] = (kinds[kindOf(a)] ?? 0) + 1;
    console.log(`# grammar: ${[...ev.sentences, ...ev.nested, ...ev.shapes, ...ev.async, ...ev.nestedAsync].length} every() sentences (R9), ${withFluent.length} catalog sentences (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), ${Object.keys(g.plainNames).length} plain-name aliases, ${catalog.atoms.length - withFluent.length} atoms without a sentence`);
  });
});
