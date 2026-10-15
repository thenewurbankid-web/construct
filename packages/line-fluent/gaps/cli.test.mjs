import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gapsIn, question, refine, selfAsk, selfLoop, confirmText, turnText, plainOptions, readReply, SETTLED } from './cli.mjs';
import { staticAtom, readableRun } from './fill.mjs';

const SOURCE = `function stackEntries(filteredOpportunities, getInitiativeDescription) {
  const groups = new Map();
  for (const opp of filteredOpportunities) {
    const title = getInitiativeDescription(opp)?.trim().toLowerCase();
    const key = title ? \`t:\${title}\` : \`id:\${opp.id}\`;
    const group = groups.get(key);
    if (group) group.push(opp);
    else groups.set(key, [opp]);
  }
  return Array.from(groups.entries());
}`;
const GAP = { type: 'map', member: 'set', entry: 'Map.prototype.set', code: 'groups.set(key, [opp])' };

/** A claude CLI stand-in: each call answers with the next reply, as the CLI's JSON envelope. */
const replies = (...rs) => {
  const calls = [];
  const run = async (args, input) => (calls.push({ args, input }), { stdout: JSON.stringify({ result: JSON.stringify(rs[calls.length - 1]) }) });
  return { run, calls };
};

const state = async () => {
  const atom = staticAtom(GAP);
  return {
    gap: GAP, atom, example: await readableRun(atom, 'map'),
    candidates: [
      { sentence: 'map(m).creates().at(key).to(value)', ok: true },
      { sentence: 'map(m).stores().at(key).to(value)', ok: true },
      { sentence: 'map(m).creates().with(key).to(value)', ok: true },
      { sentence: 'map(m).forgets().at(key).to(value)', ok: false },
    ],
  };
};

test('gapsIn: the registered atom closes the stackEntries gap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gaps-cli-'));
  try {
    const file = join(dir, 'stack.js');
    writeFileSync(file, `export ${SOURCE}\n`);
    const r = gapsIn(file);
    assert.deepEqual(r.gaps, []);
    assert.match(r.code, /createsAtTo\(groups, key, \[opp\]\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('question: one option per verb that held up, the step told with the readable example', async () => {
  const q = question(await state());
  assert.equal(q, [
    'One step in your code changes a map (a list of names, each with a value). For example, the map has {"pen" → 2}; the step is given "bag" and 30; afterwards the map has {"pen" → 2, "bag" → 30}.',
    'Which of these says best what it does?',
    '  1. creates',
    '  2. stores',
    'Or say it in your own words.',
  ].join('\n'));
});

test('refine: settled only with enough confidence and a real candidate or a plain word', async () => {
  const s = await state();
  const answer = (step) => replies({ assumptions: [{ about: 'block', statement: 'Groups opportunities by initiative.', confidence: 0.9 }], step, question: 'Does each group start with one opportunity?' });
  const sure = answer({ meaning: 'starts a new group', confidence: 0.93, candidate: 1, word: null });
  const r = await refine(s, SOURCE, { run: sure.run });
  assert.equal(r.settled, true);
  assert.equal(r.step.verb, 'creates');
  assert.match(sure.calls[0].input, /^The code:\nfunction stackEntries/);
  assert.match(sure.calls[0].input, /1\. creates: map\(m\)\.creates\(\)\.at\(key\)\.to\(value\)\n2\. stores:/);
  assert.equal((await refine(s, SOURCE, { run: answer({ confidence: SETTLED - 0.1, candidate: 1 }).run })).settled, false, 'not confident enough');
  assert.equal((await refine(s, SOURCE, { run: answer({ confidence: 0.95, candidate: 9 }).run })).settled, false, 'no such candidate');
  const own = await refine(s, SOURCE, { run: answer({ confidence: 0.95, candidate: null, word: 'Starts' }).run });
  assert.deepEqual([own.settled, own.step.word], [true, 'starts']);
});

test('selfAsk: the model designs the experiment, our code runs the real block, the model answers from the result', async () => {
  const { run, calls } = replies(
    { args: [[{ id: 1 }, { id: 2 }], { fn: '(o) => "Growth"' }], why: 'two opportunities, one initiative' },
    { answer: 'Both land in one group.' },
  );
  const h = await selfAsk({ question: 'Do opportunities with the same initiative share a group?' }, SOURCE, { run });
  assert.equal(h.self, true);
  assert.match(h.a, /it returns \[\["t:growth",\[\{"id":1\},\{"id":2\}\]\]\]/, 'the real run, not the model, says what came out');
  assert.match(calls[1].input, /What happened: it returns/);
});

test('selfLoop stops when settled, or when a round no longer raises confidence', async () => {
  const s = { ...(await state()), question: 'q', step: { confidence: 0.5 } };
  const experiment = { args: [[{ id: 1 }], { fn: '() => "A"' }] };
  const refined = (confidence, candidate) => ({ assumptions: [], step: { meaning: 'm', confidence, candidate }, question: 'q2' });
  const settles = replies(experiment, { answer: 'a' }, refined(0.9, 1));
  assert.equal((await selfLoop(s, SOURCE, { run: settles.run })).settled, true);
  assert.equal(settles.calls.length, 3);
  const stuck = replies(experiment, { answer: 'a' }, refined(0.6, null), experiment, { answer: 'a' }, refined(0.6, null));
  const r = await selfLoop(s, SOURCE, { run: stuck.run });
  assert.equal(r.settled, false);
  assert.equal(stuck.calls.length, 6, 'two rounds, then stops: the second learned nothing');
});

test('confirmText and turnText say the current reading in plain words', () => {
  const s = {
    assumptions: [{ about: 'block', statement: 'It groups opportunities by initiative.' }, { about: 'inputs', statement: 'A list of opportunities.' }],
    step: { meaning: 'It starts a new group.' }, question: 'Is that right?',
  };
  assert.equal(confirmText(s), "Here's what I worked out about this code:\n- What it does: It groups opportunities by initiative.\n- What goes in: A list of opportunities.\n- The step I wasn't sure about: It starts a new group.\nIs that right? (yes, or tell me what is wrong)");
  assert.equal(turnText(s), 'As I read it now: It groups opportunities by initiative.\nIs that right?');
});

test('plainOptions keeps each option\'s verb; a sentence that lost it falls back to the verb', async () => {
  const { run } = replies({ sentences: ['It creates an entry for "bag" holding 30.', 'It puts 30 under "bag".'] });
  assert.deepEqual(await plainOptions(await state(), { run }), { creates: 'It creates an entry for "bag" holding 30.', stores: 'stores' });
});

test('readReply: a number is read without a model; the model\'s reading is checked', async () => {
  const s = await state();
  assert.deepEqual(await readReply('2', s, { run: () => assert.fail('no model for a number') }), { choice: 2, word: null });
  assert.deepEqual(await readReply('the second', s, replies({ choice: 2, word: null })), { choice: 2, word: null });
  assert.deepEqual(await readReply('the ninth', s, replies({ choice: 9, word: null })), { choice: null, word: null });
  assert.deepEqual(await readReply('I would say it starts one', s, replies({ choice: null, word: 'Starts' })), { choice: null, word: 'starts' });
});
