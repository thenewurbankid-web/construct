import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagedQueue } from './queue.mjs';

const tick = () => new Promise((r) => setTimeout(r, 1));

test('a refused entry reaches the next stage while the first stage is still working', async () => {
  const log = [];
  await stagedQueue([
    { name: 't1', initial: [1, 2, 3, 4, 5, 6, 7, 8], run: async (g) => { await tick(); log.push(['t1', g]); return g.filter((x) => x % 2 === 0); } },
    { name: 't2', run: async (g) => { await tick(); log.push(['t2', g]); return g; } },
  ], { size: 2, workers: 1 });
  const firstT2 = log.findIndex(([s]) => s === 't2');
  const lastT1 = log.map(([s]) => s).lastIndexOf('t1');
  assert.ok(firstT2 < lastT1, `t2 started at ${firstT2}, t1 ended at ${lastT1}`);
  assert.deepEqual(log.filter(([s]) => s === 't2').flatMap(([, g]) => g).sort(), [2, 4, 6, 8]);
});

test('every entry goes through every stage it is handed to, partial batches included', async () => {
  const seen = { a: [], b: [], c: [] };
  await stagedQueue([
    { name: 'a', initial: [1, 2, 3, 4, 5], run: async (g) => { seen.a.push(...g); return g; } },
    { name: 'b', initial: [9], run: async (g) => { seen.b.push(...g); return g.filter((x) => x > 3); } },
    { name: 'c', run: async (g) => { seen.c.push(...g); } },
  ], { size: 3, workers: 3 });
  assert.deepEqual(seen.a.sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(seen.b.sort((x, y) => x - y), [1, 2, 3, 4, 5, 9]);
  assert.deepEqual(seen.c.sort((x, y) => x - y), [4, 5, 9]);
});

test('a partial batch waits until earlier stages are drained', async () => {
  const sizes = [];
  await stagedQueue([
    { name: 'a', initial: [1, 2, 3, 4, 5, 6], run: async (g) => { await tick(); return g; } },
    { name: 'b', run: async (g) => { sizes.push(g.length); } },
  ], { size: 4, workers: 2 });
  assert.deepEqual(sizes.sort(), [2, 4]);
});

test('stop ends the run before the next batch', async () => {
  let n = 0;
  await stagedQueue([{ name: 'a', initial: [1, 2, 3, 4], run: async () => { n += 1; } }], { size: 1, workers: 1, stop: () => n >= 2 });
  assert.equal(n, 2);
});
