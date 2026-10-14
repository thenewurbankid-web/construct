// Atomic English (ENGLISH-RULES.md): every catalog `fluent` sentence is held to the rules.
//   R1 verbs are third person singular: no base forms (sort), no participles (sorted)
//   R3 one argument per word, and the word that carries it names its role
//   R4 questions use is / has / can / does, split into words (no greaterThan)
//   R5 a changed copy starts clones().<subject>(x).and(); in-place atoms and questions never clone
// plus R8: naming.json grammar.plainNames is the plain name each sentence gives.
// The words a sentence may use are listed in naming.json `grammar`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, plainName, reading } from '../scripts/lib-sentence.mjs';

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
const booleanName = new RegExp(`^(${naming.booleanPrefixes.join('|')})[A-Z]`);

/** What the atom is, as far as the rules care: a question, a changed copy, or in place. */
function kindOf(a) {
  if (a.mutates) return 'inPlace';
  if (a.returnsCopy || a.replacesMutation) return 'copy';
  if (booleanName.test(a.atom) || (naming.booleanExempt.includes(a.atom) && !OPERATORS.has(a.atom))) return 'question';
  return 'other';
}

/** Every rule a sentence breaks, as readable messages; empty when it follows them all. */
function violations(sentence, kind) {
  const out = [];
  let calls;
  try {
    calls = parse(sentence);
  } catch (e) {
    return [`does not parse: ${e.message}`];
  }
  for (const { word, args } of calls) {
    // R4 (split into words) and R1: one lowercase English word per call.
    if (!/^[a-z]+$/.test(word)) out.push(`R4: ${word}() is not a single word; split it (greaterThan -> greater().than())`);
    else if (word.endsWith('ed')) out.push(`R1: ${word}() is a past participle; use the third-person verb`);
    else if (baseForms.has(word) && !vocabulary.has(word)) out.push(`R1: ${word}() is a base form; use the third-person verb`);
    else if (!vocabulary.has(word)) out.push(`grammar: ${word}() is not in naming.json grammar; add it to the class it belongs to`);
    // R3: at most one argument, carried by a role word (or a subject, or an approved argument verb).
    if (args.length > 1) out.push(`R3: ${word}() takes ${args.length} arguments; give each its own word`);
    if (args.length && !(roleWords.has(word) || subjects.has(word) || argumentVerbs.has(word))) out.push(`R3: ${word}(${args[0]}) carries an argument but is not a role word`);
    // R4: the question word itself carries nothing.
    if (questionWords.has(word) && args.length) out.push(`R4: ${word}() is a question word and takes no argument`);
  }
  const words = calls.map((c) => c.word);
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
    assert.deepEqual(violations('list(xs).sorts().by(order)', 'inPlace'), []);
  });

  test('summary', () => {
    const kinds = {};
    for (const a of withFluent) kinds[kindOf(a)] = (kinds[kindOf(a)] ?? 0) + 1;
    console.log(`# grammar: ${withFluent.length} sentences (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), ${Object.keys(g.plainNames).length} plain-name aliases, ${catalog.atoms.length - withFluent.length} atoms without a sentence`);
  });
});
