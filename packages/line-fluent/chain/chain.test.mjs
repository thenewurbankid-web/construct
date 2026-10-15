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

// A fake @mx/reason calibratedChoice: two asks per read (real and baseline), probs from `read(options)`.
const fakeLinks = (read, log, states = []) => async (n) => (n === '@mx/reason'
  ? { module: { calibratedChoice: async (ask, frame, words, options) => { await ask({ state: frame.state(words), options }); await ask({ state: frame.state('N/A'), options }); log.push(options.join('')); return read(options); } } }
  : { module: { SEMIF_MARGIN: 0.3, SEMIF_MAX_OPTIONS: 5, semanticIf: async (m, q) => (states.push(q.state), { mode: 'logprobs' }) } });

test('the linked picker asks one calibrated question and does not rotate a clear read', async () => {
  const log = [];
  const picker = await linkedPicker({}, { importLinked: fakeLinks((o) => o.map((c) => (c === 'b' ? 0.8 : 0.1)), log) });
  assert.deepEqual(await picker(['a', 'b', 'c'], 'w', 'f', 'q'), { index: 1, calls: 2, rotated: false, margin: 0.7 });
  assert.deepEqual(log, ['abc']);
});

test('the linked picker rotates only a close call, and the rotation cancels a lean to letter A', async () => {
  const log = [];
  // Leans to slot A (0.4 + 0.2 for c): a plain read picks a, the rotated average picks c.
  const read = (o) => o.map((c, slot) => (slot === 0 ? 0.4 : 0.1) + (c === 'c' ? 0.2 : 0));
  const picker = await linkedPicker({}, { importLinked: fakeLinks(read, log) });
  const r = await picker(['a', 'b', 'c'], 'w', 'f', 'q');
  assert.equal(r.rotated, true);
  assert.equal(r.index, 2);
  assert.equal(r.calls, 6, 'two asks per rotation, three rotations');
  assert.deepEqual(log, ['abc', 'bca', 'cab']);
});

test('the linked picker holds at most 5 options (one round) and puts the fixed head before the words', async () => {
  const log = [];
  const states = [];
  const picker = await linkedPicker({}, { importLinked: fakeLinks((o) => o.map((_, i) => (i === 4 ? 0.9 : 0.02)), log, states) });
  const r = await picker(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'pads and entry', 'f', 'q', { head: 'HEAD' });
  assert.equal(r.index, 4);
  assert.deepEqual(log, ['abcde']);
  assert.deepEqual(states, ['HEAD\npads and entry', 'HEAD\nN/A']);
});

test('the linked picker is null when a link is missing', async () => {
  assert.equal(await linkedPicker({}, { importLinked: async () => ({ ok: false, reason: 'missing' }) }), null);
});

test('every prompt is fixed instructions, then the pads, then the entry; the system text never changes', async () => {
  const pads = padBoard(ROLES);
  pads.of('Array').shared.add('new-atom', 'list(xs).sorts() = xs.sort()', 'pass');
  pads.of('Array').frame.add('rule', 'earlier frame note', 'pass');
  const systems = new Set();
  const users = [];
  const words = [];
  const e = (id) => ({ id, key: id, section: 'Array', kind: 'static', params: [{ name: 'items', type: 'Iterable<T>' }] });
  for (const id of ['Array.from', 'Array.of']) {
    await chainAnswer({ entry: e(id), candidates: [] }, {
      pick: async (c, w, fact, q, { head }) => (words.push([head, w]), fact.endsWith('decide') ? 0 : 0),
      propose: async ({ system, user, schema }) => (systems.add(system), users.push(user), { text: schema.properties.js ? '{"js": "Array.from(xs)", "params": [{"name": "xs", "type": "list"}]}' : '{"verb": "makes"}' }),
      gateOf: () => async () => pass, pads,
    });
  }
  assert.equal(systems.size, 2, 'one fixed system text per proposing role');
  assert.ok([...systems].some((x) => x.includes('Test generator names:')), 'the generator names are in the fixed part');
  for (const u of users) {
    assert.ok(u.startsWith('Shared notes for Array:'), u);
    assert.ok(u.indexOf('This entry:') > u.indexOf('Shared notes'), 'the entry comes after the pads');
  }
  for (const [head, w] of words) {
    assert.ok(head.startsWith('You are the '), 'each pick has a fixed head');
    assert.ok(w.indexOf('This entry:') > w.indexOf('Shared notes'));
  }
});

test('each result records the model calls and milliseconds of every step', async () => {
  const r = await chainAnswer({ entry: at, candidates: [] }, {
    pick: async (choices, w, fact) => ({ index: fact.endsWith('decide') ? 0 : 0, calls: fact.endsWith('decide') ? 2 : 6, rotated: !fact.endsWith('decide') }),
    propose: async () => ({ text: '{"verb": "takes"}' }),
    gateOf: () => async () => pass, pads: padBoard(ROLES),
  });
  const { perStep, calls, ms, rotated, picks, proposals } = r.chain;
  assert.deepEqual(Object.keys(perStep), ['decide', 'shape', 'verb'], 'the frame came by rule: no call');
  assert.deepEqual([perStep.decide.calls, perStep.shape.calls, perStep.verb.calls], [2, 6, 1]);
  assert.equal(calls, 9);
  assert.equal(rotated, 1);
  assert.deepEqual([picks, proposals], [2, 1]);
  assert.ok(Object.values(perStep).every((s) => Number.isInteger(s.ms) && s.ms >= 0) && ms >= 0);
});

test('the shape pick offers at most 5 shapes', () => {
  for (const params of [[['xs', 'list']], [['xs', 'list'], ['sep', 'text']], [['s', 'text'], ['a', 'prim'], ['b', 'prim']]]) assert.ok(shapeChoices(params).length <= 5);
});
