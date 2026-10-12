import test from 'node:test';
import assert from 'node:assert/strict';
import { toReadings, assertReading, assertBeamEvent, CLOSE_REASONS, BEAM_CAP } from './contract.mjs';

const catalog = [{ id: 'update.handler' }, { id: 'update.prop' }];

test('toReadings: classify Labels become top-k closed readings, best first', () => {
  const r = toReadings({ intent: { id: 'update.prop', confidence: 0.8 }, alternatives: [{ id: 'update.handler', confidence: 0.48 }], target: 'P1', layers: [{ layer: 'ui', confidence: 0.9 }, { layer: 'api', confidence: 0.2 }] });
  assert.deepEqual(r.map((x) => x.intent), ['update.prop', 'update.handler']);
  assert.deepEqual(r[0].layers, ['ui']);
  for (const x of r) assertReading(x, catalog);
  assert.throws(() => assertReading({ ...r[0], intent: 'add.page' }, catalog), /not a catalog id/);
});

test('events: closed kinds and reasons', () => {
  assert.equal(BEAM_CAP, 8);
  assertBeamEvent({ t: 'runClosed', run: 'r1', reason: 'structural', detail: 'x' });
  assert.throws(() => assertBeamEvent({ t: 'runClosed', run: 'r1', reason: 'meh', detail: '' }), /reason/);
  assert.ok(CLOSE_REASONS.includes('precondition'));
  assertBeamEvent({ t: 'question', question: { id: 'beam:1', sentence: 'Which?', hint: 'h', recommended: 'r1', options: [{ id: 'r1', sentence: 'a', effect: '' }, { id: 'r2', sentence: 'b', effect: '' }] } });
  assert.throws(() => assertBeamEvent({ t: 'done', outcome: 'maybe', run: null, open: 0, closed: 0 }), /outcome/);
});
