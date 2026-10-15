import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainAnswer, shapeChoices, linkedPicker } from './chain.mjs';
import { padBoard, Scratchpad } from './scratchpad.mjs';
import { ROLES } from './chain.mjs';
import { llamaSemifModel, chatPrompt } from './llama-semif.mjs';

const pass = { pass: true, checks: {}, refusal: null, fixes: [] };
const at = { id: 'Array.prototype.at', key: 'Array.prototype.at', section: 'Array', kind: 'method', params: [{ name: 'index', type: 'number', optional: false, rest: false }] };

test('a new atom: rule frame, picked shape, proposed verb, sentence built by code with the R10 ending', async () => {
  const pads = padBoard(ROLES);
  const seen = [];
  const r = await chainAnswer({ entry: at, candidates: [] }, {
    pick: async (choices, words, fact) => { seen.push(fact); return fact.endsWith('decide') ? 0 : choices.findIndex((c) => c.startsWith('list(xs).joins')); },
    propose: async () => ({ text: '{"verb": "takes"}', tokensIn: 10, tokensOut: 3 }),
    gateOf: () => async () => pass,
    pads,
  });
  assert.equal(r.answer.decision, 'new-atom');
  assert.equal(r.answer.js, 'xs.at(index)');
  assert.equal(r.answer.sentence, 'list(xs).takes().with(index).andThe().taken()');
  assert.equal(r.answer.atom, 'takesWith');
  assert.deepEqual(seen, ['line.chain.decide', 'line.chain.shape']);
  assert.match(pads.of('Array').shared.text(), /pass: list\(xs\)\.takes/);
  assert.match(pads.of('Array').verb.text(), /pass: xs\.at\(index\): takes/);
});

test('reuse is finished from the catalog with no proposal', async () => {
  let proposed = 0;
  const c = { atom: 'takesAt', fluent: 'list(xs).takes().at(i).andThe().taken()', js: ['xs.at(i)'] };
  const r = await chainAnswer({ entry: at, candidates: [c] }, { pick: async () => 0, propose: async () => (proposed++, { text: '{}' }), gateOf: () => async () => pass, pads: padBoard(ROLES) });
  assert.equal(r.answer.decision, 'existing');
  assert.equal(r.answer.existing, 'takesAt');
  assert.equal(r.answer.sentence, c.fluent);
  assert.equal(proposed, 0);
});

test('with no picker and no proposer, an entry no rule frames ends as not-expressible, saying why', async () => {
  const e = { id: 'Array.from', key: 'Array.from', section: 'Array', kind: 'static', params: [{ name: 'items', type: 'Iterable<T>' }] };
  const r = await chainAnswer({ entry: e, candidates: [] }, { gateOf: () => async () => pass, pads: padBoard(ROLES) });
  assert.equal(r.answer.decision, 'not-expressible');
  assert.match(r.answer.reason, /no model is running/);
});

test('after a not-expressible refusal the decide step no longer offers "cannot"', async () => {
  let offered;
  await chainAnswer({ entry: at, candidates: [], refusal: 'You answered not-expressible (x).' }, {
    pick: async (choices, w, fact) => { if (fact.endsWith('decide')) offered = choices; return 0; },
    propose: async () => ({ text: '{"verb": "takes"}' }), gateOf: () => async () => pass, pads: padBoard(ROLES),
  });
  assert.equal(offered, undefined, 'one choice left: no question asked');
});

test('a proposed frame is held to the gate generator names', async () => {
  const e = { id: 'Array.of', key: 'Array.of', section: 'Array', kind: 'static', params: [{ name: 'items', type: 'T[]', rest: true }] };
  const r = await chainAnswer({ entry: e, candidates: [] }, {
    pick: async (c, w, fact) => (fact.endsWith("decide") ? 0 : 1),
    propose: async ({ schema }) => ({ text: schema.properties.js ? '{"js": "Array.of(x)", "params": [{"name": "x", "type": "prim"}, {"name": "bad", "type": "Widget"}]}' : '{"verb": "makes"}' }),
    gateOf: () => async (a) => ({ ...pass, seen: a }), pads: padBoard(ROLES),
  });
  assert.deepEqual(r.answer.params, [['x', 'prim']]);
});

test('shape choices carry exactly the params, shortest from the subject first', () => {
  const s = shapeChoices([['xs', 'list'], ['sep', 'text']]);
  assert.ok(s.length > 1);
  assert.ok(s[0].startsWith('list(·)'));
  assert.ok(s.every((x) => x.split('(·)').length - 1 === 2));
});

test('a scratchpad compacts itself into tallies and pinned passing examples', () => {
  const pad = new Scratchpad('Notes', { limit: 300, keep: 2, pinned: 2 });
  for (let i = 0; i < 20; i++) pad.add(i % 2 ? 'verb sorts' : 'verb trims', `note number ${i} with some words`, i % 3 ? 'pass' : 'refused');
  assert.ok(pad.text().length <= 300, pad.text());
  assert.ok(pad.compactions > 0);
  assert.equal(pad.notes.length <= 2 || pad.text().length <= 300, true);
  assert.match(pad.text(), /passed/);
  const back = Scratchpad.fromJSON(JSON.parse(JSON.stringify(pad)));
  assert.equal(back.text(), pad.text());
});

test('the llama semif model reads first-token log-probabilities and constrains a forced letter', async () => {
  let body;
  const fetch = async (url, init) => ((body = JSON.parse(init.body)), { ok: true, json: async () => ({ content: 'A', completion_probabilities: [{ top_logprobs: [{ token: 'A', logprob: -0.1 }, { token: 'B', logprob: -2.5 }] }] }) });
  const m = llamaSemifModel({ fetch });
  const r = await m.complete({ messages: [{ role: 'user', content: 'Q' }], maxTokens: 1, topLogprobs: 20 });
  assert.equal(body.n_probs, 20);
  assert.equal(body.prompt, chatPrompt([{ role: 'user', content: 'Q' }]));
  assert.deepEqual(r.topLogprobs.map((t) => t.token), ['A', 'B']);
  await m.complete({ messages: [{ role: 'user', content: 'Q' }], oneOf: ['A', 'B'] });
  assert.equal(body.grammar, 'root ::= "A" | "B"');
});

test('the linked picker uses reason pickAmong over seraph semanticIf, or is null when a link is missing', async () => {
  const calls = [];
  const fake = (name) => async (n) => (n === '@mx/reason'
    ? { module: { pickAmong: async (ask, frame, words, choices) => { calls.push(frame.rotate); await ask({}); return [{ index: 1, p: 0.7 }]; } } }
    : name === 'ok' ? { module: { semanticIf: async () => (calls.push('semif'), {}) } } : { ok: false, reason: 'missing' });
  const picker = await linkedPicker({}, { importLinked: fake('ok') });
  assert.equal(await picker(['a', 'b'], 'w', 'f', 'q'), 1);
  assert.deepEqual(calls, [true, 'semif']);
  assert.equal(await linkedPicker({}, { importLinked: fake('no') }), null);
});
