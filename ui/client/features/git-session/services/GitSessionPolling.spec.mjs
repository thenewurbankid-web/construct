import test from 'node:test';
import assert from 'node:assert/strict';
import { watchGitSession, GIT_SESSION_POLL_MS } from './GitSessionPolling.ts';

test('watchGitSession refreshes now, then every GIT_SESSION_POLL_MS, until stopped', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let n = 0;
  const stop = watchGitSession(() => { n++; });
  assert.equal(n, 1, 'immediate refresh');
  t.mock.timers.tick(GIT_SESSION_POLL_MS * 2);
  assert.equal(n, 3);
  stop();
  t.mock.timers.tick(GIT_SESSION_POLL_MS * 4);
  assert.equal(n, 3, 'no ticks after stop');
});
