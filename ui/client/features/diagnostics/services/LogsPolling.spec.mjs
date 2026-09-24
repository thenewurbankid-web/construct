import test from 'node:test';
import assert from 'node:assert/strict';
import { watchLogs, LOGS_POLL_MS } from './LogsPolling.ts';

test('watchLogs refreshes now, then every LOGS_POLL_MS, until stopped', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let n = 0;
  const stop = watchLogs(() => { n++; });
  assert.equal(n, 1, 'immediate refresh');
  t.mock.timers.tick(LOGS_POLL_MS - 1);
  assert.equal(n, 1);
  t.mock.timers.tick(1);
  assert.equal(n, 2);
  stop();
  t.mock.timers.tick(LOGS_POLL_MS * 4);
  assert.equal(n, 2, 'no ticks after stop');
});
