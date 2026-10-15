import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGrammar } from './grammar.mjs';
import { SHAPES, shapeOf, isTypo, looksLikeVerb } from './shapes.mjs';
import { sentences } from '../../grammar/next-words.mjs';

test('every known sentence has a shape the grammar holds', () => {
  for (const { fluent } of sentences) assert.ok(SHAPES.has(shapeOf(fluent)), fluent);
  assert.equal(shapeOf('list(xs).joins().with(sep)'), 'list(·).VERB().with(·)');
  assert.equal(shapeOf('checks().if(a).is().greater().than(b)'), 'checks().if(·).is().greater().than(·)', 'frame and role words stay literal');
});

test('a new verb in a known shape passes, reported as a verb alias', () => {
  assert.deepEqual(checkGrammar({ sentence: 'clones().list(xs).and().copies()' }), {
    check: 'pass', errors: [], fixes: [], aliases: [{ word: 'copies', class: 'verb' }], shape: 'clones().list(·).and().VERB()',
  });
  assert.deepEqual(checkGrammar({ sentence: 'clones().list(xs).and().sorts().by(order)' }), { check: 'pass', errors: [], fixes: [] }, 'a known path still passes on the trie, with no aliases');
});

test('a new verb in a shape the grammar lacks is refused with the nearest real sentences as examples', () => {
  const r = checkGrammar({ sentence: 'text(s).pads(n).with(c)' });
  assert.equal(r.check, 'fail');
  assert.match(r.errors[0], /the shape `text\(·\)\.VERB\(·\)\.with\(·\)` is not one the grammar has\. Sentences with the nearest shapes: `/);
  assert.deepEqual(r.fixes, []);
});

test('a slip of a known word keeps its fix; a different word may be a new verb', () => {
  assert.ok(isTypo('flatens', 'flattens'));
  assert.ok(isTypo('yeilds', 'yields'), 'reordered letters');
  assert.ok(!isTypo('fills', 'finds'));
  assert.ok(!isTypo('pads', 'has'), 'a different first letter is a different word');
  assert.ok(!isTypo('removes', 'reverses'), 'two edits apart is a different word');
  const r = checkGrammar({ sentence: 'clones().list(xs).and().flatens()' });
  assert.deepEqual(r.fixes, [{ kind: 'replace-word', from: 'flatens', to: 'flattens' }]);
});

test('only a third-person verb form can join as a new verb (R1)', () => {
  for (const w of ['fills', 'copies', 'pushes']) assert.ok(looksLikeVerb(w), w);
  for (const w of ['class', 'fill', 'quickly', 'is', 'status']) assert.ok(!looksLikeVerb(w), w);
  assert.match(checkGrammar({ sentence: 'clones().list(xs).and().quickly()' }).errors[0], /`quickly` is not legal/);
});

test('a new shape that follows the word-class rules passes, flagged for the person to confirm', () => {
  const r = checkGrammar({ sentence: 'set(s).puts().at(key).to(value)' });
  assert.equal(r.check, 'pass');
  assert.deepEqual(r.newShape, { shape: 'set(·).VERB().at(·).to(·)', like: r.newShape.like });
  // Once an atom with that shape is approved (createsAtTo, map(m).creates().at(key).to(value)), it is a known shape.
  const known = checkGrammar({ sentence: 'map(m).sets().at(key).to(value)' });
  assert.equal(known.newShape, undefined);
  assert.deepEqual(known.aliases, [{ word: 'sets', class: 'verb' }]);
  assert.equal(checkGrammar({ sentence: 'map(m).removes().at(key)' }).check, 'pass');
  assert.equal(checkGrammar({ sentence: 'map(m).sets().by(key).and(() => value)' }).check, 'fail', 'a connector taking an argument breaks R6');
  assert.equal(checkGrammar({ sentence: 'text(s).pads(n).with(c)' }).check, 'fail', 'a verb taking its own argument breaks R3');
});
