import test from 'node:test';
import assert from 'node:assert/strict';
import { watchLiveRun, RUN_POLL_MS } from './RunPolling.ts';

test('watchLiveRun does not read now, refreshes every RUN_POLL_MS, and stops', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let n = 0;
  const stop = watchLiveRun(() => { n++; });
  assert.equal(n, 0, 'the caller has just read the run');
  t.mock.timers.tick(RUN_POLL_MS * 3);
  assert.equal(n, 3);
  stop();
  t.mock.timers.tick(RUN_POLL_MS * 3);
  assert.equal(n, 3, 'no ticks after stop');
});
