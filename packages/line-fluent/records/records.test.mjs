import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { record, appendRecords, readRecords, splitBySection } from './records.mjs';

const reference = JSON.parse(
  readFileSync(new URL('../../line-codemod/bench/atoms/js-reference/reference.json', import.meta.url), 'utf8'),
).entries;

const gold = { entry: 'Array.prototype.flatMap', decision: 'new-atom', atom: 'flatMapped' };
const good = (over = {}) => ({
  entry: 'Array.prototype.flatMap',
  section: 'Array',
  source: 'gold',
  gold,
  student: null,
  verdict: null,
  ...over,
});

test('record returns a frozen object with the keys in contract order', () => {
  const r = record({ verdict: 'same', student: gold, gold, source: 'codemod', section: 'Array', entry: 'x' });
  assert.deepEqual(Object.keys(r), ['entry', 'section', 'source', 'gold', 'student', 'verdict']);
  assert.ok(Object.isFrozen(r));
  assert.equal(record(good()).verdict, null);
});

test('record refuses unknown, missing and out-of-enum fields with one sentence', () => {
  const cases = [
    [{ ...good(), extra: 1 }, /unknown field `extra`/],
    [(({ verdict: _v, ...rest }) => rest)(good()), /missing field `verdict`/],
    [good({ source: 'model' }), /`source` must be one of/],
    [good({ verdict: 'close' }), /`verdict` must be null or one of/],
    [good({ entry: '' }), /`entry` must be/],
    [good({ section: 3 }), /`section` must be/],
    [good({ gold: null }), /`gold` must be/],
    [good({ student: 'text' }), /`student` must be/],
    [null, /must be an object/],
  ];
  for (const [input, re] of cases) {
    assert.throws(() => record(input), (err) => re.test(err.message) && !err.message.includes('\n'));
  }
});

test('appendRecords writes JSONL in a new folder and readRecords round-trips it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'line-records-'));
  try {
    const path = join(dir, 'nested', 'deeper', 'records.jsonl');
    assert.deepEqual(readRecords(path), []);
    assert.equal(appendRecords(path, [good(), good({ source: 'corrected', student: gold, verdict: 'wrong' })]), 2);
    appendRecords(path, [good({ entry: 'Array.prototype.map', verdict: 'equivalent', student: gold })]);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(lines.length, 3);
    const back = readRecords(path);
    assert.equal(back.length, 3);
    assert.deepEqual(back[1], record(good({ source: 'corrected', student: gold, verdict: 'wrong' })));
    assert.equal(back[2].entry, 'Array.prototype.map');
    assert.throws(() => appendRecords(path, [{ ...good(), extra: 1 }]), /unknown field/);
    assert.equal(readRecords(path).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('splitBySection: same seed gives the same split, a different seed differs', () => {
  const a = splitBySection(reference, { seed: 'line' });
  const b = splitBySection(reference, { seed: 'line' });
  const c = splitBySection(reference, { seed: 'other' });
  assert.deepEqual(a.heldOutSections, b.heldOutSections);
  assert.deepEqual(a.train.map((e) => e.id), b.train.map((e) => e.id));
  assert.notDeepEqual(a.heldOutSections, c.heldOutSections);
  assert.deepEqual(splitBySection(reference).heldOutSections, a.heldOutSections);
});

test('splitBySection: no section on both sides, every entry on exactly one side', () => {
  for (const seed of ['line', 'other', 'x']) {
    const { train, heldOut, heldOutSections } = splitBySection(reference, { seed });
    assert.equal(train.length + heldOut.length, reference.length);
    const trainSections = new Set(train.map((e) => e.section));
    const heldSet = new Set(heldOut.map((e) => e.section));
    assert.deepEqual([...heldSet].sort(), heldOutSections);
    for (const s of heldSet) assert.ok(!trainSections.has(s), `section ${s} is on both sides`);
  }
});

test('splitBySection: held-out share stays near the fraction on the real reference', () => {
  for (const [fraction, seed] of [[0.2, 'line'], [0.2, 'other'], [0.1, 'line'], [0.3, 'z']]) {
    const { heldOut } = splitBySection(reference, { heldOut: fraction, seed });
    const share = heldOut.length / reference.length;
    assert.ok(Math.abs(share - fraction) <= 0.03, `share ${share.toFixed(3)} for ${fraction}/${seed}`);
  }
  assert.equal(splitBySection(reference, { heldOut: 0 }).heldOut.length, 0);
});

test('splitBySection refuses entries without a section and a bad fraction', () => {
  assert.throws(() => splitBySection([{ id: 'a' }]), /non-empty string `section`/);
  assert.throws(() => splitBySection([], { heldOut: 1.5 }), /from 0 to 1/);
});
