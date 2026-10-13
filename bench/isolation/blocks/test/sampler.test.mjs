import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sample } from '../sampler.mjs';

const run = (outcomes) => {
  const seeds = [];
  return sample({
    n: 5, seedBase: 10,
    generate: async (seed) => { seeds.push(seed); return { reply: String(seeds.length - 1), ms: 100 }; },
    judge: async (reply) => ({ ...outcomes[Number(reply)], ms: 1 }),
  }).then((r) => ({ ...r, seeds }));
};

test('stops at the first passing sample and uses seedBase + i', async () => {
  const r = await run([{ pass: false, tscOk: false, failClass: 'tsc' }, { pass: true, tscOk: true }, { pass: true, tscOk: true }]);
  assert.equal(r.pass, true);
  assert.equal(r.picked.i, 1);
  assert.deepEqual(r.seeds, [10, 11]);
});

test('N stats come from the same draw', async () => {
  const r = await run([{ tscOk: false }, { tscOk: true, failClass: 'check' }, { pass: true, tscOk: true }]);
  const s = r.stats([1, 3, 5], 1000);
  assert.equal(s[1].pass, false);
  assert.equal(s[3].pass, true);
  assert.equal(s[5].pass, true);
  assert.equal(s[3].wallMs, 1000 + 3 * 101);
  assert.equal(s[1].wallMs, 1000 + 101);
  assert.equal(s[5].tscPickerPass, false); // the first tsc-clean sample failed the check
});

test('no pass: draws all N and reports the last sample', async () => {
  const r = await run(Array.from({ length: 5 }, () => ({ pass: false, failClass: 'fragment' })));
  assert.equal(r.pass, false);
  assert.equal(r.samples.length, 5);
  assert.equal(r.stats([5])[5].drawn, 5);
});
