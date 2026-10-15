// Tests for coverage.mjs (t2-3a-coverage): five C1 reference entries with known outcomes,
// plus the bySection / filter bookkeeping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coverage, classify, referenceSource, record, writeRecord, table } from './coverage.mjs';

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

// Small self-contained fixture: entries carry their own `source`, no reference.json lookup.
const FIXTURE = [
  { id: 'f1', key: 'from', section: 'A', source: 'function a() { return Array.from([7, 8]); }', want: 'converts' },
  { id: 'f2', key: 'push', section: 'A', source: 'function b(xs) { xs.push(1); return xs; }', want: 'refused' },
  { id: 'f3', key: 'brand', section: 'B', source: 'function c(o) { class K { #x; static has(o) { return #x in o; } } return K.has(o); }', want: 'refused' },
  { id: 'f4', key: 'newArray', section: 'B', source: 'function d() { return new Array(2); }', want: 'untranslated' },
  { id: 'f5', key: 'bare', section: 'B', source: 'function e() { return 1; }', want: 'untranslated' },
  { id: 'f6', key: 'missing', section: 'C', source: null, want: 'refused' },
];

test('fixture: each outcome path, bySection and totals', () => {
  const res = coverage({ entries: FIXTURE });
  assert.deepEqual(res.results.map((r) => r.outcome), FIXTURE.map((f) => f.want));
  assert.deepEqual(res.bySection, {
    A: { total: 2, converts: 1, refused: 1, untranslated: 0 },
    B: { total: 3, converts: 0, refused: 1, untranslated: 2 },
    C: { total: 1, converts: 0, refused: 1, untranslated: 0 },
  });
  assert.deepEqual(res.results.map((r) => r.reasons[0] || ''), ['', 'mutates', res.results[2].reasons[0], '', '', 'no reference function']);
  assert.match(res.results[2].reasons[0], /^threw: /);
  assert.equal(res.results[4].converted, 0); // bare return: no atom call -> untranslated
  assert.equal(coverage({ entries: FIXTURE, sections: ['B'], limit: 2 }).total, 2);
});

test('fixture: record and writeRecord produce the latest.json shape', () => {
  const res = coverage({ entries: FIXTURE });
  const rec = record(res, { sections: [], limit: null });
  assert.deepEqual(Object.keys(rec), ['$comment', 'filter', 'total', 'converts', 'refused', 'untranslated', 'bySection', 'refusalReasons']);
  assert.deepEqual({ total: rec.total, converts: rec.converts, refused: rec.refused, untranslated: rec.untranslated }, { total: 6, converts: 1, refused: 3, untranslated: 2 });
  assert.equal(rec.refusalReasons.mutates, 1);
  assert.equal(rec.refusalReasons['no reference function'], 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-'));
  const file = writeRecord(res, { sections: [], limit: null }, path.join(dir, 'latest.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), rec);
  fs.rmSync(dir, { recursive: true });
  const lines = table(res).split('\n');
  assert.match(lines.at(-1), /^TOTAL\s+6\s+1\s+3\s+2$/);
});
