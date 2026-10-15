// Tests for coverage.mjs (t2-3a-coverage): five C1 reference entries with known outcomes,
// plus the bySection / filter bookkeeping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { coverage, classify, referenceSource } from './coverage.mjs';

const REF = JSON.parse(fs.readFileSync(new URL('../../line-codemod/bench/atoms/js-reference/reference.json', import.meta.url), 'utf8'));
const byKey = (key) => REF.entries.find((e) => e.key === key);

const KNOWN = [
  ['Array.from', 'converts'], // Array.from([7, 8]) -> listFrom([7, 8])
  ['Array.prototype.push', 'refused'], // push mutates: toAtoms records reason 'mutates'
  ['#x in obj (private brand check)', 'refused'], // toAtoms throws on a PrivateName argument
  ['new Array', 'untranslated'], // new Array(2): no catalog entry, JS left
  ['Array.[Symbol.species]', 'untranslated'], // nothing rewritten, no atom call
];

test('five reference entries classify as known', () => {
  const entries = KNOWN.map(([key]) => byKey(key));
  assert.ok(entries.every(Boolean), 'all five entries exist in reference.json');
  const res = coverage({ entries });
  assert.deepEqual(res.results.map((r) => [r.key, r.outcome]), KNOWN);
  assert.deepEqual(
    { total: res.total, converts: res.converts, refused: res.refused, untranslated: res.untranslated },
    { total: 5, converts: 1, refused: 2, untranslated: 2 },
  );
  assert.deepEqual(res.bySection.Array, { total: 4, converts: 1, refused: 1, untranslated: 2 });
  assert.equal(res.results[1].reasons[0], 'mutates');
  assert.match(res.results[2].reasons[0], /^threw: /);
});

test('reference source is the declaration without export', () => {
  assert.match(referenceSource('Array.from'), /^function Array_from\(\) \{/);
  assert.match(referenceSource('with (sloppy mode)'), /^exports\.syntax_with_sloppy_mode = function/);
  assert.equal(referenceSource('no such key'), null);
  assert.equal(classify(null).outcome, 'refused');
});

test('sections and limit filter; bySection sums to the totals', () => {
  const res = coverage({ sections: ['Array', 'Math'], limit: 50 });
  assert.equal(res.total, 50);
  assert.deepEqual(Object.keys(res.bySection).filter((s) => !['Array', 'Math'].includes(s)), []);
  for (const k of ['total', 'converts', 'refused', 'untranslated']) {
    assert.equal(Object.values(res.bySection).reduce((n, s) => n + s[k], 0), res[k]);
  }
  assert.equal(res.converts + res.refused + res.untranslated, res.total);
});
