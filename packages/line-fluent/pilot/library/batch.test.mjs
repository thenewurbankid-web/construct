import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batches, readList, matchUp, answerTurn, BATCH_SYSTEM } from './batch.mjs';
import { main } from './run.mjs';

const e = (key, section = 'Map', id = key.replace(/ #\d+$/, '')) => ({ key, id, section, kind: 'method', params: [] });
const reply = (text, costUsd = 0.002) => ({ text, tokensIn: 100, tokensOut: 50, costUsd });

test('batches never mix sections and hold at most size entries', () => {
  const list = [e('a', 'S'), e('b', 'S'), e('c', 'S'), e('d', 'T')];
  assert.deepEqual(batches(list, 2).map((b) => b.map((x) => x.key)), [['a', 'b'], ['c'], ['d']]);
});

test('readList reads the list after the prefill, or from a whole JSON reply, else null', () => {
  assert.deepEqual(readList('{"answers": [', '{"a":1}]}', 'answers'), [{ a: 1 }]);
  assert.deepEqual(readList('{"answers": [', 'Sure: {"answers": [{"a":2}]}', 'answers'), [{ a: 2 }]);
  assert.equal(readList('{"answers": [', 'no', 'answers'), null);
});

test('matchUp: by label where ids repeat, by position where the label is a number, the true id written back', () => {
  const items = [e('Array.from'), e('Array.from #2')].map((entry) => ({ entry }));
  assert.deepEqual(matchUp(items, [{ entry: 'Array.from #2', n: 2 }, { entry: 'Array.from', n: 1 }]), [{ entry: 'Array.from', n: 1 }, { entry: 'Array.from', n: 2 }]);
  assert.deepEqual(matchUp(items, [{ entry: 1, n: 1 }, { entry: 2, n: 2 }]).map((x) => x.n), [1, 2]);
  assert.deepEqual(matchUp(items, [{ entry: 'Array.from #2', n: 2 }]), [null, { entry: 'Array.from', n: 2 }]);
});

test('answerTurn: one call for the batch, each answer gated on its own, a missing one refused alone', async () => {
  const calls = [];
  const model = async (req) => (calls.push(req), reply('{"entry": "Map.prototype.get", "decision": "existing"}]}'));
  const items = [e('Map.prototype.get'), e('Map.prototype.has')].map((entry) => ({ entry, candidates: [] }));
  const gated = [];
  const out = await answerTurn(items, { model, gateOf: (entry) => async (a) => (gated.push(entry.key), { pass: a.decision === 'existing' }) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].system, BATCH_SYSTEM);
  assert.match(calls[0].user, /^### Map\.prototype\.get\nEntry: Map\.prototype\.get[\s\S]*\n\n### Map\.prototype\.has\n/);
  assert.deepEqual(gated, ['Map.prototype.get']);
  assert.equal(out[0].gate.pass, true);
  assert.match(out[1].gate.refusal, /no answer for this entry/);
  assert.equal(out[0].costUsd, 0.001, 'the call is shared over the batch');
});

test('a batched run: turn 1, turn 2 with the refusal, then the user stage, all recorded per entry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batch-run-'));
  try {
    const seen = [];
    const good = (key) => `{"entry": "${key}", "decision": "existing", "atom": null, "existing": "getFrom", "kind": "value", "sentence": "map(m).gives().at(key)", "js": "m.get(key)", "params": [["m", "map"], ["key", "prim"]], "parts": null, "reason": null}`;
    const bad = (key) => `{"entry": "${key}", "decision": "new-atom"}`;
    // haiku: turn 1 answers get well and has badly; turn 2 still badly; after the person speaks, well.
    const makeModel = ({ model }) => async (req) => {
      seen.push({ model, system: req.system.slice(0, 40), user: req.user });
      if (model === 'opus') return reply('{"answers": [{"entry": "Map.prototype.has", "answer": "It says whether the name is in the map."}]}');
      if (req.prefill.startsWith('{"questions')) return reply('{"entry": "Map.prototype.has", "question": "What do you want to know about the map?"}]}');
      const keys = [...req.user.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
      const told = /They said:/.test(req.user);
      return reply(`${keys.map((k) => (k === 'Map.prototype.get' || told ? good(k) : bad(k))).join(', ')}]}`);
    };
    const summary = await main(['--sections', 'Map', '--batch', '20', '--outside', 'none', '--user', 'opus', '--out', dir], { log: () => {}, makeModel: (o) => makeModel(o), pick: (list) => list.filter((x) => ['Map.prototype.get', 'Map.prototype.has'].includes(x.key)) });
    const rows = readFileSync(join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => [r.key, r.stage, r.tries]), [
      ['Map.prototype.get', 'inside', 1],
      ['Map.prototype.has', 'inside', 1],
      ['Map.prototype.has', 'inside', 2],
      ['Map.prototype.has', 'user', 2],
    ]);
    assert.equal(rows[0].gate.pass, true, JSON.stringify(rows[0].gate));
    assert.equal(rows[1].gate.pass, false);
    // The stand-in answer is get's, so the real gate refuses it for has: two rounds, each asked and answered.
    assert.equal(rows[3].dialogue.length, 2);
    assert.deepEqual(rows[3].dialogue[0], { q: 'What do you want to know about the map?', a: 'It says whether the name is in the map.' });
    assert.match(seen.find((s) => s.model === 'opus').user, /^### Map\.prototype\.has\nThe code step is the JavaScript method Map\.prototype\.has\(key\)\.\nTheir question: What do you want/);
    assert.match(seen[1].user, /Your last answer was refused: /, 'turn 2 carries the refusal');
    assert.equal(summary.user.entries, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
