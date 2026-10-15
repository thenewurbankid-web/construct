// T4.2: hover on JS calls and functions returns the fluent sentence and atom id (hit / no-atom / no-sentence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHoverIndex, callAt, hoverAt } from './hover.mjs';

const index = buildHoverIndex();
const SRC = [
  'const ok = xs.includes(x);',
  'const top = Math.max(...ns);',
  'greet(name);',
  'function hasItem(list, item) { return list.includes(item); }',
  'const u = new Set(xs);',
  'const ys = xs.map(fn).toSorted(order);',
].join('\n');
const at = (word, n = 1, text = SRC) => hoverAt(index, text, text.indexOf(word) + n);

test('index ranks the most direct snippet first, then atoms with a fluent sentence', () => {
  assert.deepEqual(index.byMember.get('.includes'), ['hasItem', 'hasText', 'omit']);
  assert.deepEqual(index.byMember.get('Math.max'), ['largestOf', 'range', 'clamp']);
  assert.equal(index.byMember.get('.at')[0], 'at');
  assert.equal(index.byMember.get('new Set')[0], 'setOf');
});

test('hit: a method call shows the fluent sentence and the atom id', () => {
  const h = at('includes');
  assert.equal(h.atom, 'hasItem');
  assert.equal(h.fluent, 'checks().if(xs).has().item(x)');
  assert.equal(h.contents.kind, 'markdown');
  assert.match(h.contents.value, /```line\nchecks\(\)\.if\(xs\)\.has\(\)\.item\(x\)\n```/);
  assert.match(h.contents.value, /\*\*atom\*\* `hasItem` · sequences/);
  assert.match(h.contents.value, /Also matches: `hasText`, `omit`/);
  assert.deepEqual(h.range, { start: { line: 0, character: 14 }, end: { line: 0, character: 22 } });
});

test('hit: an LSP position works the same as an offset, and chained calls resolve separately', () => {
  const h = hoverAt(index, SRC, { line: 5, character: 25 });
  assert.equal(h.atom, 'sortedBy');
  assert.equal(h.fluent, 'clones().list(xs).and().sorts().by(order)');
  assert.equal(at('map').atom, 'mapEach');
});

test('hit: a function declared or called by an atom id', () => {
  const h = at('hasItem');
  assert.equal(h.atom, 'hasItem');
  assert.ok(!h.contents.value.includes('Also matches'));
  assert.equal(hoverAt(index, 'const b = hasItem(xs, x);', 12).atom, 'hasItem');
});

test('no atom: a plain call, a receiver, a non-call and unknown members return null', () => {
  assert.equal(at('greet'), null);
  assert.equal(at('xs.includes', 0), null);
  assert.equal(at('const', 0), null);
  assert.equal(hoverAt(index, 'thing.frobnicate(1)', 8), null);
  assert.equal(hoverAt(index, '', 0), null);
  assert.equal(callAt('greet(name)', 2).member, null);
});

test('no sentence: an atom without a fluent sentence still shows its id and reading', () => {
  const h = at('max');
  assert.equal(h.atom, 'largestOf');
  assert.equal(h.fluent, null);
  assert.match(h.contents.value, /^_No fluent sentence for this atom yet\._/);
  assert.match(h.contents.value, /\*\*atom\*\* `largestOf`/);
  assert.match(h.contents.value, /Reads: the largest of numbers/);
  // A static call covers its whole chain, so hovering `Math` gives the same answer.
  assert.equal(at('Math').atom, 'largestOf');
  assert.equal(at('new Set', 0).atom, 'setOf');
});

test('fluentFor (T2.1a) is used before the catalog sentence, which stays the fallback', () => {
  const fluentFor = (atom) => (atom === 'largestOf' ? 'takes().the().largest().of(ns)' : null);
  assert.equal(hoverAt(index, SRC, SRC.indexOf('max'), { fluentFor }).fluent, 'takes().the().largest().of(ns)');
  assert.equal(hoverAt(index, SRC, SRC.indexOf('includes'), { fluentFor }).fluent, 'checks().if(xs).has().item(x)');
});
