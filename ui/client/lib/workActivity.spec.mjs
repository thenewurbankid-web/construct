// The "work is going on" signal behind the Cockpit's processing indicator: which requests count, and the counter itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { beginWork, getWorkCount, isWorkRequest, subscribeWork, trackWork } from './workActivity.ts';

test('only the framework doing work counts: commands and validate, not reads, notes or pane state', () => {
  for (const path of ['/api/create', '/api/refactor', '/api/research', '/api/import', '/api/init']) assert.equal(isWorkRequest('POST', path), true, path);
  assert.equal(isWorkRequest('GET', '/api/validate'), true);
  assert.equal(isWorkRequest('GET', '/api/validate?x=1'), true);
  for (const [m, p] of [['GET', '/api/create'], ['POST', '/api/notes'], ['PUT', '/api/notes/abc'], ['GET', '/api/pages'], ['POST', '/api/pages/node'], ['POST', '/api/plan/validate'], ['POST', '/api/validate'], ['GET', '/api/validate/other'], ['POST', '/api/createx']]) {
    assert.equal(isWorkRequest(m, p), false, `${m} ${p}`);
  }
});

test('beginWork counts up, its end counts down once (a second call is harmless), and subscribers hear every change', () => {
  const heard = [];
  const off = subscribeWork(() => heard.push(getWorkCount()));
  const base = getWorkCount();
  const endA = beginWork();
  const endB = beginWork();
  assert.equal(getWorkCount(), base + 2);
  endA();
  endA();
  assert.equal(getWorkCount(), base + 1);
  endB();
  assert.equal(getWorkCount(), base);
  off();
  beginWork()();
  assert.deepEqual(heard, [base + 1, base + 2, base + 1, base]);
});

test('trackWork counts a work request while it is in flight, releases it when it fails, and ignores every other request', async () => {
  const base = getWorkCount();
  let during = -1;
  const out = await trackWork('POST', '/api/create', async () => { during = getWorkCount(); return 'done'; });
  assert.equal(out, 'done');
  assert.equal(during, base + 1);
  assert.equal(getWorkCount(), base);

  await assert.rejects(trackWork('POST', '/api/import', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(getWorkCount(), base, 'a failed request is not left counting');

  let other = -1;
  await trackWork('GET', '/api/pages', async () => { other = getWorkCount(); });
  assert.equal(other, base, 'an ordinary read is not work');
});
