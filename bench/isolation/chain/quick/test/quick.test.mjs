// Deterministic parts of the quick kill-tests (#942); no model, no Smith.
//   node --test bench/isolation/chain/quick/test/quick.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as k3 from '../k3.mjs';
import * as k4 from '../k4.mjs';
import { TASKS } from '../tasks.mjs';
import { tscGate, unitCheck } from '../lib/gates.mjs';
import { stubProblems } from '../../../../../packages/engine/line/path/stubs.mjs';

test('K3: the facts built by moduleScope + stubProblems give the expected step under Line order', () => {
  const kinds = new Set();
  for (const c of k3.CASES) {
    const root = k3.materialize(c);
    try {
      const f = k3.buildFacts(root, c);
      assert.deepEqual(k3.decide(c, f), c.expect, c.id);
      assert.ok(f.candidates.includes(c.expect.target), `${c.id} target is in the closed enum`);
      kinds.add(c.expect.step);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
  assert.equal(k3.CASES.length, 8);
  assert.deepEqual([...kinds].sort(), [...k3.STEPS].sort());
});

test('K4: every case names a real atom with an english sentence', () => {
  const ids = k4.readAtoms().map((a) => a.id);
  assert.ok(ids.length >= 10);
  for (const c of k4.CASES) assert.ok(ids.includes(c.atom), c.id);
  assert.equal(k4.CASES.length, 8);
});

test('tasks: stubs are open, references pass tsc and the unit check, mutants fail the unit check', async () => {
  for (const t of TASKS) {
    for (const fn of t.functions) assert.ok(stubProblems(t.stub, fn).some((p) => p.code === 'OPEN'), `${t.id} ${fn} stub open`);
    const src = `${t.prelude ?? ''}${t.reference}`;
    assert.deepEqual(tscGate(src), [], `${t.id} reference tsc`);
    assert.equal(await unitCheck(src, t.check), true, `${t.id} reference unit`);
    for (const [i, m] of t.mutants.entries()) assert.equal(await unitCheck(`${t.prelude ?? ''}${m}`, t.check), false, `${t.id} mutant ${i + 1}`);
  }
});
