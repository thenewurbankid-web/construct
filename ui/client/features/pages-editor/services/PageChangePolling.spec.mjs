import test from 'node:test';
import assert from 'node:assert/strict';
import { watchPageChange, PAGE_CHANGE_POLL_MS } from './PageChangePolling.ts';

const flush = () => new Promise((r) => setImmediate(r));

test('watchPageChange reads now and every tick, maps a missing change to null, swallows read errors', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const seen = [];
  const answers = [{ change: { at: 1 } }, {}, null];
  let reads = 0;
  const stop = watchPageChange(
    () => { const a = answers[reads++]; return a ? Promise.resolve(a) : Promise.reject(new Error('down')); },
    (c) => seen.push(c),
  );
  await flush();
  assert.deepEqual(seen, [{ at: 1 }], 'immediate read');
  t.mock.timers.tick(PAGE_CHANGE_POLL_MS); await flush();
  assert.deepEqual(seen, [{ at: 1 }, null], 'no change key becomes null');
  t.mock.timers.tick(PAGE_CHANGE_POLL_MS); await flush();
  assert.equal(seen.length, 2, 'a rejected read is ignored');
  assert.equal(reads, 3);
  stop();
});

test('watchPageChange drops an answer that lands after stop and stops ticking', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const seen = [];
  let release;
  let reads = 0;
  const stop = watchPageChange(() => { reads++; return new Promise((r) => { release = r; }); }, (c) => seen.push(c));
  stop();
  release({ change: { at: 2 } });
  await flush();
  assert.deepEqual(seen, []);
  t.mock.timers.tick(PAGE_CHANGE_POLL_MS * 4);
  assert.equal(reads, 1);
});
