import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, contains, daysIn, overlaps, lastDays, startOfDay, endOfDay, isValidDate, dateRange } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);
const d = (s: string) => new Date(`${s}T12:00:00Z`);

test('picking ends: empty -> partial -> complete, a backwards range is invalid', () => {
  let s = kit.init();
  assert.equal(s.status, 'empty');
  assert.equal(kit.send(s, { type: 'CLEAR' }), s);
  s = kit.send(s, { type: 'SET_START', date: d('2026-10-01') });
  assert.equal(s.status, 'partial');
  s = kit.send(s, { type: 'SET_END', date: d('2026-10-07') });
  assert.equal(s.status, 'complete');
  assert.equal(daysIn(s), 7);
  assert.equal(contains(s, new Date('2026-10-07T23:59:59Z')), true, 'the last day counts all day');
  assert.equal(contains(s, new Date('2026-10-08T00:00:00Z')), false);
  s = kit.send(s, { type: 'SET_START', date: d('2026-10-09') });
  assert.equal(s.status, 'invalid');
  assert.equal(daysIn(s), 0);
  assert.equal(contains(s, d('2026-10-09')), false);
  s = kit.send(s, { type: 'SET_START', date: d('2026-10-02') });
  assert.equal(s.status, 'complete');
  s = kit.send(s, { type: 'SET_END', date: d('2026-09-01') });
  assert.equal(s.status, 'invalid');
  s = kit.send(s, { type: 'SET_END', date: null });
  assert.equal(s.status, 'partial');
  s = kit.send(s, { type: 'SET_START', date: null });
  assert.equal(s.status, 'empty');
  s = kit.send(s, { type: 'SET_END', date: d('2026-10-05') });
  assert.equal(s.status, 'partial');
  s = kit.send(s, { type: 'SET_START', date: new Date('nope') });
  assert.equal(s.status, 'invalid', 'an Invalid Date is invalid');
  s = kit.send(s, { type: 'SET_START', date: d('2026-10-01') });
  s = kit.send(s, { type: 'SET_START', date: null });
  s = kit.send(s, { type: 'SET_END', date: null });
  assert.equal(s.status, 'empty');
  s = kit.send(s, { type: 'SET_START', date: d('2026-10-01') });
  s = kit.send(s, { type: 'SET_END', date: d('2026-10-01') });
  assert.equal(daysIn(s), 1, 'a one-day range');
  s = kit.send(s, { type: 'CLEAR' });
  assert.equal(s.status, 'empty');
});

test('presets: the last 7 days up to today', () => {
  let s = kit.init();
  assert.equal(kit.send(s, { type: 'PRESET', days: 0, today: d('2026-10-12') }), s, 'a preset of no days is refused');
  s = kit.send(s, { type: 'PRESET', days: 7, today: d('2026-10-12') });
  assert.equal(s.status, 'complete');
  assert.equal(s.start?.toISOString(), '2026-10-06T00:00:00.000Z');
  assert.equal(daysIn(s), 7);
  assert.deepEqual(lastDays(1, d('2026-10-12')).start, startOfDay(d('2026-10-12')));
});

test('helpers: overlaps, day bounds, valid dates, dateRange in one call', () => {
  const a = dateRange(d('2026-10-01'), d('2026-10-05'));
  assert.equal(overlaps(a, dateRange(d('2026-10-05'), d('2026-10-09'))), true, 'sharing one day is an overlap');
  assert.equal(overlaps(a, dateRange(d('2026-10-06'), d('2026-10-09'))), false);
  assert.equal(overlaps(a, dateRange(null, d('2026-10-09'))), false);
  assert.equal(endOfDay(d('2026-10-01')).toISOString(), '2026-10-01T23:59:59.999Z');
  assert.equal(isValidDate(new Date('x')), false);
  assert.equal(isValidDate('2026-10-01'), false);
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
