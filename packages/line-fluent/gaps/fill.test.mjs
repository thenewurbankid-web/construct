import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticAtom, answerFor, readableRun, readBack, readBackMatches, fillGap } from './fill.mjs';

const SET = { type: 'map', member: 'set', entry: 'Map.prototype.set' };
/** A claude CLI stand-in: each call answers with the next reply, as the CLI's JSON envelope. */
const replies = (...rs) => {
  const calls = [];
  const run = async (args, input) => (calls.push({ args, input }), { stdout: JSON.stringify({ result: JSON.stringify(rs[calls.length - 1]) }) });
  return { run, calls };
};

test('staticAtom takes js, params and kind from the gap and its reference entry; the receiver is never a subject word', () => {
  const a = staticAtom(SET);
  assert.equal(a.js, 'm.set(key, value)');
  assert.deepEqual(a.params, [['m', 'map'], ['key', 'prim'], ['value', 'prim']]);
  assert.equal(a.kind, 'in-place');
  assert.equal(staticAtom({ type: 'map', member: 'get', entry: 'Map.prototype.get' }).kind, 'value');
  assert.throws(() => staticAtom({ ...SET, entry: 'No.such' }), /No reference entry No\.such/);
});

test('answerFor names the atom after the words past the subject (R8)', () => {
  const r = answerFor(staticAtom(SET), 'map(m).creates().at(key).to(value)');
  assert.equal(r.atom, 'createsAtTo');
  assert.equal(r.decision, 'new-atom');
  assert.equal(r.js, 'm.set(key, value)');
});

test('readableRun shows the step on readable values, maps as people write them', async () => {
  assert.deepEqual(await readableRun(staticAtom(SET), 'map'), {
    subject: 'map',
    given: 'm = a map {"pen" → 2}, key = "bag", value = 30',
    gives: 'a map {"pen" → 2, "bag" → 30}',
    changed: ['m becomes a map {"pen" → 2, "bag" → 30}'],
  });
});

test('readBackMatches judges the reader against the real run, with no model', async () => {
  const atom = staticAtom(SET);
  const real = { gives: 'x', changes: ['m'], becomes: ['a map {"pen" → 2, "bag" → 30}'] };
  assert.deepEqual(readBackMatches({ said: { changes: 'm', becomes: '{"pen": 2, "bag": 30}', name: 'add bag' }, real }, atom), { ok: true, name: 'add bag' });
  assert.match(readBackMatches({ said: { changes: 'none' }, real }, atom).why, /expect nothing to change, but m changes/);
  assert.match(readBackMatches({ said: { changes: 'm', becomes: '{"pen": 2}' }, real }, atom).why, /expect m to become/);
  const value = { ...atom, kind: 'value' };
  assert.match(readBackMatches({ said: { changes: 'none', gives: '3' }, real: { gives: '2', changes: [], becomes: [] } }, value).why, /expect it to give 3, but it gives 2/);
});

test('readBack shows the reader only the sentence and the readable inputs, never the js', async () => {
  const atom = staticAtom(SET);
  const { run, calls } = replies({ gives: 'the map', changes: 'm', becomes: '{"pen" → 2, "bag" → 30}', name: 'store bag' });
  const rb = await readBack('map(m).creates().at(key).to(value)', atom, await readableRun(atom, 'map'), { run });
  assert.equal(rb.said.name, 'store bag');
  assert.doesNotMatch(calls[0].input, /\.set\(/);
  assert.match(calls[0].input, /^Sentence: map\(m\)\.creates\(\)\.at\(key\)\.to\(value\)\nInputs: m = a map/);
});

test('fillGap: grammar, gate and read-back each keep or drop a suggested sentence, with the reason', async () => {
  const { run } = replies(
    { sentences: ['map(m).creates().at(key).to(value)', 'map(m).quickly()', 'map(m).forgets().at(key).to(value)'] },
    { changes: 'm', becomes: '{"pen" → 2, "bag" → 30}', name: 'add bag' },
    { changes: 'none', becomes: 'none', name: 'forget' },
  );
  const gate = async (answer) => ({ pass: true, answer });
  const r = await fillGap(SET, { gate, run });
  assert.deepEqual(r.candidates.map((c) => c.ok), [true, false, false]);
  assert.equal(r.candidates[0].answer.atom, 'createsAtTo');
  assert.match(r.candidates[2].why, /expect nothing to change, but m changes/);
});
