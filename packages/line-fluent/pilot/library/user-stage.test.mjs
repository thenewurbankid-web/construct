import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { userStage, describeEntry } from './user-stage.mjs';
import { summarize } from './run.mjs';
import { REFERENCE_PATH } from '../../generator/generator.mjs';

const entry = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')).entries.find((e) => e.key === 'Map.prototype.set');
const answer = (sentence) => `new-atom", "atom": "createsAtTo", "existing": null, "kind": "in-place", "sentence": "${sentence}", "js": "m.set(key, value)", "params": [["m", "map"], ["key", "prim"], ["value", "prim"]], "parts": null, "reason": null}`;
const reply = (text, costUsd = 0.001) => ({ text, tokensIn: 10, tokensOut: 5, costUsd });

/** The inside model: asks a question, and answers the entry well only once the person has said something. */
function inside(calls) {
  return async (request) => {
    calls.push(request);
    if (request.prefill.startsWith('{"question')) return reply('What happens to the map?"}');
    return reply(answer(/They said:/.test(request.user) ? 'map(m).creates().at(key).to(value)' : 'map(m).quickly()'));
  };
}
const gate = async (a) => (a.sentence === 'map(m).creates().at(key).to(value)' ? { pass: true, checks: {}, refusal: null } : { pass: false, checks: { grammar: 'fail' }, refusal: 'quickly is not a verb.' });
const prior = { answer: { sentence: 'map(m).quickly()' }, gate: { pass: false, refusal: 'quickly is not a verb.' } };

test('the inside model asks, the user model answers as the person, the inside model gets through with that', async () => {
  const asked = [];
  const told = [];
  const user = async (request) => (told.push(request), reply('It adds the name and its value to the map, so the map has one more entry."}', 0.01));
  const r = await userStage(entry, prior, { asker: inside(asked), user, gate, catalog: [] });
  assert.equal(r.stage, 'user');
  assert.equal(r.model, 'haiku+opus as user');
  assert.equal(r.gate.pass, true, JSON.stringify(r.gate));
  assert.equal(r.answer.sentence, 'map(m).creates().at(key).to(value)');
  assert.deepEqual(r.dialogue, [{ q: 'What happens to the map?', a: 'It adds the name and its value to the map, so the map has one more entry.' }]);
  assert.match(asked[0].user, /Your refused sentence: map\(m\)\.quickly\(\)\nWhy it was refused: quickly is not a verb\./);
  // The person's side sees what the code is and the question; never the catalog, the format or the refusal.
  assert.equal(told[0].user, 'The code step is the JavaScript method Map.prototype.set(key, value).\nTheir question: What happens to the map?');
  assert.match(asked[1].user, /You asked the person: What happens to the map\?\nThey said: It adds the name/);
  assert.equal(r.costUsd, 0.012);
});

test('rounds stop at the limit, and an empty reply ends the conversation', async () => {
  const stubborn = async (request) => (request.prefill.startsWith('{"question') ? reply('What does it do?"}') : reply(answer('map(m).quickly()')));
  const r = await userStage(entry, prior, { asker: stubborn, user: async () => reply('It stores a value."}'), gate, catalog: [], rounds: 2 });
  assert.equal(r.gate.pass, false);
  assert.equal(r.dialogue.length, 2);
  const mute = await userStage(entry, prior, { asker: stubborn, user: async () => reply(''), gate, catalog: [] });
  assert.deepEqual(mute.dialogue, []);
  assert.equal(mute.gate, prior.gate, 'nothing new was tried');
});

test('a model error is recorded as an error, so the run can stop on a streak and resume', async () => {
  const r = await userStage(entry, prior, { asker: async () => { throw new Error('usage limit'); }, user: async () => reply(''), gate, catalog: [] });
  assert.equal(r.error, 'usage limit');
});

test('describeEntry says what the code step is, nothing more', () => {
  assert.equal(describeEntry(entry), 'The code step is the JavaScript method Map.prototype.set(key, value).');
});

test('summarize takes the user stage\'s answer when the earlier stages failed', () => {
  const fail = { gate: { pass: false, refusal: 'no' }, answer: null };
  const all = [
    { key: entry.key, section: 'Map', stage: 'inside', model: 'haiku', ...fail },
    { key: entry.key, section: 'Map', stage: 'user', model: 'haiku+opus as user', gate: { pass: true }, answer: { decision: 'new-atom', sentence: 's' }, tries: 1, costUsd: 0.01, ms: 1000 },
  ];
  const { summary, library } = summarize(all, [entry]);
  assert.equal(library[entry.key].stage, 'user');
  assert.equal(summary.inLibrary, 1);
  assert.equal(summary.user.passed, 1);
  assert.deepEqual(summary.sections.Map, { entries: 1, passed: 1, inside: 0, outside: 0, user: 1 });
});
