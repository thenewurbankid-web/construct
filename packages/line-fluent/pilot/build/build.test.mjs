import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wordsOf, verbOf, genOfType, shapeTrie, shortestShapes, fill, buildSentences, atomName, staticAtom, builtAnswers } from './build.mjs';
import { REFERENCE_PATH, CATALOG_PATH } from '../../generator/generator.mjs';

const reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')).entries;
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')).atoms;
const entry = (key) => reference.find((e) => e.key === key);

test('the member name gives its words and, in a verb frame, its verb (R1)', () => {
  assert.deepEqual(wordsOf('lastIndexOf'), ['last', 'index', 'of']);
  assert.equal(verbOf('padStart'), 'pads');
  assert.equal(verbOf('reverse'), 'reverses');
  assert.equal(verbOf('toUpperCase'), null, 'to... is not a verb the rules can name');
  assert.equal(genOfType('(value: T) => boolean'), 'pred');
  assert.equal(genOfType('string'), 'text');
});

test('the shortest path carries every argument; branches that cannot are cut before they are explored', () => {
  const trie = shapeTrie(['text(·).VERB()', 'text(·).VERB().with(·)', 'text(·).VERB().at(·).with(·)', 'text(·).VERB().by(·)', 'list(·).VERB()']);
  const one = shortestShapes('text', 2, { trie });
  assert.deepEqual(one.shapes, [['text(·)', 'VERB()', 'with(·)'], ['text(·)', 'VERB()', 'by(·)']]);
  assert.ok(one.cut > 0, 'the at(·).with(·) branch carries two and is cut');
  assert.deepEqual(shortestShapes('text', 3, { trie }).shapes, [['text(·)', 'VERB()', 'at(·)', 'with(·)']]);
  assert.deepEqual(shortestShapes('list', 2, { trie }), { shapes: [], explored: 0, cut: 1 }, 'a dead end is known at the first node');
  assert.equal(fill(['text(·)', 'VERB()', 'with(·)'], 'pads', ['s', 'fill']), 'text(s).pads().with(fill)');
  assert.equal(atomName('text(s).pads().with(fill)'), 'padsWith');
});

test('buildSentences names a dead end instead of asking a model', () => {
  assert.match(buildSentences([['s', 'text']], 'toUpperCase').deadEnd, /does not start with a verb/);
  assert.match(buildSentences([['r', 'regex']], 'test').deadEnd, /no subject word for a regex receiver/);
  assert.match(buildSentences([['xs', 'list'], ['a', 'num'], ['b', 'num'], ['c', 'num'], ['d', 'num']], 'fill').deadEnd, /no shape list\(·\)\.VERB\(\) carrying 4 more arguments/);
});

test('staticAtom takes js and params from the reference entry, receiver first', () => {
  assert.deepEqual(staticAtom(entry('Array.prototype.join')), { js: 'xs.join()', params: [['xs', 'list']], kind: 'value', member: 'join' });
  assert.equal(staticAtom(entry('Array.prototype.reverse')).kind, 'in-place');
  assert.equal(staticAtom(entry('Array.isArray')), null, 'static members are not built by rules yet');
});

test('builtAnswers: reuse a covering catalog atom first, then a new atom from the entry', () => {
  const { answers } = builtAnswers(entry('Array.prototype.reverse'), catalog);
  assert.ok(answers.length > 0);
  assert.ok(answers.every((a) => a.entry === 'Array.prototype.reverse' && a.js && Array.isArray(a.params)));
  const first = answers.findIndex((a) => a.decision === 'new-atom');
  assert.ok(first === -1 || answers.slice(0, first).every((a) => a.decision === 'existing'), 'reuse comes before new');
});
