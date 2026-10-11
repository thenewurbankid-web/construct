// cs2 (scaffold) -- the rule factory's contract: the miss record and the static share, with the mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISS_SOURCES, COLLECTED_SOURCES, assertMissRecord, assertStaticShare } from '../packages/rule-factory/contract.mjs';
import { MOCK_MISSES, createMockMissCollector } from '../packages/rule-factory/mock.mjs';

test('contract: four miss sources, two collected today; every mock record is a valid miss record', () => {
  assert.deepEqual([...MISS_SOURCES], ['plan', 'validate', 'decision-trace', 'reason-ledger']);
  assert.deepEqual([...COLLECTED_SOURCES], ['plan', 'validate']);
  for (const r of createMockMissCollector().collect()) assertMissRecord(r);
});

test('contract: a record that is not a miss must be decided by static code; bad shapes are named', () => {
  const r = MOCK_MISSES[0];
  assert.throws(() => assertMissRecord({ ...r, decidedBy: 'person' }), /not a miss was decided by static/);
  assert.throws(() => assertMissRecord({ ...r, source: 'chat' }), /source is one of/);
  assert.throws(() => assertMissRecord({ ...r, sentence: 'lower case' }), /full sentence/);
  assert.throws(() => assertMissRecord({ ...r, label: 'maybe' }), /label/);
});

test('contract: a static share has total >= byStatic and a share between 0 and 1', () => {
  assertStaticShare({ step: 'line.baseOn', total: 2, byStatic: 1, share: 0.5, sentence: 'Static code decided 1 of 2.' });
  assert.throws(() => assertStaticShare({ step: 'x', total: 1, byStatic: 2, share: 2, sentence: '' }), /StaticShare/);
});
