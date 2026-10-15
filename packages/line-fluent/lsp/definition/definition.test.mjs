// t4-4a-definition: index counts over catalog.json + C1, and go-to-definition lookups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../../line-smith/scripts/lib-sentence.mjs';
import { buildIndex, definitionAt, membersOf, wordKey, wordSpans } from './definition.mjs';

const index = buildIndex();
const at = (sentence, word, n = 0) => definitionAt(index, sentence, sentence.indexOf(word) + n);

test('index counts over the catalog and the C1 reference', () => {
  assert.deepEqual(index.counts, { atoms: 292, withFluent: 37, withReference: 238 });
  assert.equal(index.bySentenceWords.size, 37);
  assert.equal(index.bySentenceWords.get('checks.if.has.item'), 'hasItem');
  assert.equal(wordKey('list(xs).joins().with(sep)'), 'list.joins.with');
});

test('reference match keeps every entry whose key carries the member', () => {
  const ref = index.byAtom.get('hasItem').reference;
  assert.ok(ref.includes('Array.prototype.includes'));
  assert.ok(ref.includes('String.prototype.includes'));
  assert.deepEqual(index.byAtom.get('largestOf').reference, ['Math.max']);
  assert.deepEqual(index.byAtom.get('hasKey').reference, ['Object.hasOwn', 'Object.prototype.hasOwnProperty']);
  assert.deepEqual(index.byAtom.get('equals').reference, []);
  assert.deepEqual(membersOf('[...new Set(list)]'), [{ key: 'new Set' }]);
});

test('word spans agree with lib-sentence parse on every catalog sentence', () => {
  for (const { fluent } of index.byAtom.values()) {
    if (fluent) assert.deepEqual(wordSpans(fluent).map((s) => s.word), parse(fluent).map((c) => c.word), fluent);
  }
});

test('lookup: a word inside a whole catalog sentence', () => {
  const d = at('checks().if(xs).has().item(x)', 'item');
  assert.equal(d.atom, 'hasItem');
  assert.equal(d.module, 'sequences');
  assert.ok(d.reference.includes('Array.prototype.includes'));
});

test('lookup: offset inside an argument resolves to its call', () => {
  assert.equal(at('checks().if(a).is().greater().than(b)', '(b)', 1).atom, 'greaterThan');
});

test('lookup: the longest run wins (not equal vs equal)', () => {
  const s = 'checks().if(a).is().not().equal().to(b)';
  assert.equal(at(s, 'equal').atom, 'differs');
  assert.equal(at('checks().if(a).is().equal().to(b)', 'equal').atom, 'equals');
});

test('lookup: a catalog sentence followed by extra words', () => {
  const d = at('clones().list(xs).and().sorts().by(order).then().more()', 'sorts');
  assert.equal(d.atom, 'sortedBy');
  assert.equal(d.fluent, 'clones().list(xs).and().sorts().by(order).andThe().sorted()');
});

test('lookup: no match', () => {
  assert.equal(at('greets().the().world()', 'the'), null);
  assert.equal(definitionAt(index, 'clones().list(xs).and().sorts().by(order).then().more()', 50), null);
  assert.equal(definitionAt(index, '', 0), null);
});
