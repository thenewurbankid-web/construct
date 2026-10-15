// C5: nextWords accepts every catalog sentence word by word and refuses what the grammar does not hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../../line-smith/scripts/lib-sentence.mjs';
import { nextWords, sentences, wordClasses } from './next-words.mjs';

const catalog = JSON.parse(readFileSync(new URL('../../line-smith/src/atoms/catalog.json', import.meta.url), 'utf8'));
const catalogFluent = catalog.atoms.filter((a) => a.fluent);

/** The prefixes of a sentence, call by call: '', 'checks()', 'checks().if(a)', ... */
const prefixes = (fluent) => {
  const calls = fluent.split(/\.(?=[A-Za-z_$][\w$]*\()/);
  return calls.map((_, i) => calls.slice(0, i).join('.'));
};

test('the grammar holds every catalog fluent sentence and every R9 table sentence', () => {
  assert.ok(catalogFluent.length >= 37, `catalog has ${catalogFluent.length} fluent sentences`);
  assert.equal(sentences.filter((s) => s.source.startsWith('catalog:')).length, catalogFluent.length);
  assert.ok(sentences.some((s) => s.source.startsWith('every.')));
});

for (const { fluent, source } of sentences) {
  test(`accepted word by word: ${fluent} (${source})`, () => {
    const words = parse(fluent).map((c) => c.word);
    const ps = prefixes(fluent);
    assert.equal(ps.length, words.length);
    words.forEach((word, i) => {
      const { legal, complete } = nextWords(ps[i]);
      assert.ok(legal.includes(word), `after "${ps[i]}": ${word} not in [${legal}]`);
      if (i > 0) assert.equal(complete, false, `"${ps[i]}" is not a whole sentence`);
    });
    assert.equal(nextWords(fluent).complete, true);
  });
}

test('every sentence word belongs to a naming.json grammar class', () => {
  const unknown = sentences.flatMap(({ fluent }) => parse(fluent).map((c) => c.word)).filter((w) => !wordClasses(w).length);
  assert.deepEqual([...new Set(unknown)], []);
});

test('an empty prefix lists the legal first words', () => {
  const { legal, complete } = nextWords('');
  for (const w of ['checks', 'clones', 'every', 'text', 'list', 'when', 'chooses', 'matches', 'attempts', 'folds', 'the']) {
    assert.ok(legal.includes(w), w);
  }
  assert.equal(complete, false);
  assert.ok(!legal.includes('is'), 'a question word never starts a sentence');
});

test('illegal continuations are refused', () => {
  const refused = [
    'is()', // a question word cannot start a sentence
    'checks().is()', // checks takes if first
    'checks().if(a).is().equal().than(b)', // equal takes to, not than
    'clones().text(s).and().sorts()', // text has no sorts
    'list(xs).splits()', // splits belongs to text
    'checks().if(a).is().greater().to(b)', // greater takes than
    'every(x).in(xs).is().mapped().to().clone().by().adding(x)', // adding is the fold body only
    'clones().list(xs).and().maps().each().with(fn).and()', // the sentence is already whole
    'banana()', // not a word
  ];
  for (const p of refused) assert.deepEqual(nextWords(p), { legal: [], complete: false }, p);
  assert.ok(!nextWords('checks().if(a).is().equal()').legal.includes('than'));
});

test('at() offers least and most; at().most(b) is whole', () => {
  const r = nextWords('checks().if(a).is().at()');
  assert.deepEqual(r.legal, ['least', 'most']);
  assert.equal(nextWords('checks().if(a).is().at().most(b)').complete, true);
});

test('R9 bodies nest deeper than the tables show', () => {
  const two = 'every(x).in(rows).is().mapped().to().clone().by().every(y).in(x).is().mapped().to().clone().by()';
  assert.ok(nextWords(two).legal.includes('every'));
  assert.equal(nextWords(`${two}.every(z).in(y).is().kept().if(z).is().positive()`).complete, true);
  assert.equal(nextWords(`${two}.every(z).in(y).is().kept().if().any(w).in(z).is().positive()`).complete, true);
});

test('a trailing partial word filters the completions', () => {
  assert.deepEqual(nextWords('clones().l').legal, ['list']);
  assert.deepEqual(nextWords('checks().if(a).is().g').legal, ['greater']);
  assert.equal(nextWords('list(xs).takes().fir').complete, false);
});
