import test from 'node:test';
import assert from 'node:assert/strict';
import { watchDevServerStatus } from './DevServerPolling.ts';

test('watchDevServerStatus refreshes now, then every interval, until stopped', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let n = 0;
  const stop = watchDevServerStatus(() => { n++; }, 600);
  assert.equal(n, 1, 'immediate refresh');
  t.mock.timers.tick(1200);
  assert.equal(n, 3);
  stop();
  t.mock.timers.tick(5000);
  assert.equal(n, 3, 'no ticks after stop');
});
