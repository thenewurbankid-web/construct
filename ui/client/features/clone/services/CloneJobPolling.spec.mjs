import test from 'node:test';
import assert from 'node:assert/strict';
import { pollCloneJob, pollCloneList } from './CloneJobPolling.ts';

const job = (state) => ({ id: 'j1', state });
const CLONE_JOB_POLL_MS = 700;
const CLONE_LIST_POLL_MS = 2000;
const flush = () => new Promise((r) => setImmediate(r));

test('pollCloneJob reads the job every tick, hands successful reads over, ignores failed ones', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const seen = [];
  const answers = [{ ok: true, job: job('running') }, { ok: false, error: 'x' }, { ok: true, job: job('done') }];
  let reads = 0;
  const stop = pollCloneJob('j1', async (id) => { assert.equal(id, 'j1'); return answers[reads++]; }, (j) => seen.push(j.state));
  assert.equal(reads, 0, 'no read before the first tick');
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(CLONE_JOB_POLL_MS); await flush(); }
  assert.equal(reads, 3);
  assert.deepEqual(seen, ['running', 'done']);
  stop();
});

test('pollCloneJob stops ticking and drops a read that lands after stop', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const seen = [];
  let release;
  let reads = 0;
  const stop = pollCloneJob('j1', () => { reads++; return new Promise((r) => { release = r; }); }, (j) => seen.push(j));
  t.mock.timers.tick(CLONE_JOB_POLL_MS);
  stop();
  release({ ok: true, job: job('done') });
  await flush();
  assert.deepEqual(seen, [], 'the late answer is dropped');
  t.mock.timers.tick(CLONE_JOB_POLL_MS * 5);
  assert.equal(reads, 1, 'no further ticks');
});

test('pollCloneList reads now, then every tick, keeps the shown list on null, and stops', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const seen = [];
  const answers = [[job('a')], null, [job('b')]];
  let reads = 0;
  const stop = pollCloneList(async () => answers[reads++] ?? null, (jobs) => seen.push(jobs[0].state));
  await flush();
  assert.deepEqual(seen, ['a'], 'first read is immediate');
  t.mock.timers.tick(CLONE_LIST_POLL_MS); await flush();
  t.mock.timers.tick(CLONE_LIST_POLL_MS); await flush();
  assert.deepEqual(seen, ['a', 'b'], 'the null answer never reaches the caller');
  stop();
  t.mock.timers.tick(CLONE_LIST_POLL_MS * 3);
  assert.equal(reads, 3);
});
