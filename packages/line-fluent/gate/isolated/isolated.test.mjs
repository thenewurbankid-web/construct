import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatePool, stoppedVerdict } from './isolated.mjs';

const at = (js) => ({ entry: 'Array.prototype.at', decision: 'new-atom', atom: 'itemAt', existing: null, kind: 'value', sentence: 'list(xs).gives().item().at(index).andThe().given()', js, params: [['xs', 'list'], ['index', 'smallint']], parts: null, reason: null });

test('an answer that builds something huge is stopped and refused; the next answer is gated as usual', { timeout: 60_000 }, async () => {
  const pool = gatePool({ size: 1, maxMb: 300 });
  try {
    const huge = await pool.gate('Array.prototype.at', at('new Uint8Array(1e9).fill(1) && xs.at(index)'));
    assert.equal(huge.pass, false);
    assert.match(huge.refusal, /^Running the answer's js used more than 0\.3 GB of memory, so it was stopped/);
    const fine = await pool.gate('Array.prototype.at', at('xs.at(index)'));
    assert.equal(fine.checks.equivalence, 'pass', fine.refusal);
  } finally {
    pool.close();
  }
});

test('stoppedVerdict is a gate refusal on behaviour', () => {
  assert.deepEqual(stoppedVerdict('X', 'ran for more than 20 seconds').checks, { schema: 'pass', grammar: 'pass', equivalence: 'fail', types: 'skip' });
});
