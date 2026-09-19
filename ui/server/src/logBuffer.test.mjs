import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogBuffer, handleLogs, MAX_TEXT } from './logBuffer.mjs';

test('records in order with increasing ids and reads since an id', () => {
  const log = createLogBuffer();
  log.record('a', 'info', 'one', 1);
  log.record('b', 'warn', 'two', 2);
  assert.deepEqual(log.read().map((e) => e.text), ['one', 'two']);
  assert.deepEqual(log.read(1).map((e) => e.text), ['two']);
  assert.equal(log.read()[1].level, 'warn');
});

test('is bounded: oldest entries fall off', () => {
  const log = createLogBuffer(3);
  for (let i = 1; i <= 5; i++) log.record('s', 'info', `m${i}`);
  assert.deepEqual(log.read().map((e) => e.text), ['m3', 'm4', 'm5']);
});

test('clips long text, coerces non-strings, defaults unknown levels', () => {
  const log = createLogBuffer();
  log.record('s', 'weird', 'x'.repeat(MAX_TEXT + 50));
  log.record('s', 'info', 42);
  const [long, num] = log.read();
  assert.equal(long.level, 'info');
  assert.equal(long.text.length, MAX_TEXT + 3);
  assert.equal(num.text, '42');
});

test('handleLogs: origin guard, since validation, last id', () => {
  const log = createLogBuffer();
  log.record('s', 'info', 'a');
  log.record('s', 'info', 'b');
  const ctx = { origin: 'http://localhost:3000', clientOrigin: 'http://localhost:3000', log };
  assert.equal(handleLogs({}, { ...ctx, origin: 'http://evil.example' }).status, 403);
  assert.equal(handleLogs({ since: '-1' }, ctx).status, 400);
  assert.equal(handleLogs({ since: ['1', '2'] }, ctx).status, 400);
  const all = handleLogs({}, ctx);
  assert.equal(all.status, 200);
  assert.equal(all.body.entries.length, 2);
  assert.equal(all.body.last, 2);
  const none = handleLogs({ since: '2' }, ctx);
  assert.deepEqual(none.body.entries, []);
  assert.equal(none.body.last, 2);
  assert.equal(handleLogs({}, { clientOrigin: 'x', log }).status, 200); // no Origin header = non-browser
});
