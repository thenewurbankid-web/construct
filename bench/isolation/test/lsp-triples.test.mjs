// #943 -- the triple schema (bench/isolation/lsp/triples.mjs): deterministic ids, never a fill that failed a gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTriple, assertTriple, appendTriples, TRIPLE_KEYS } from '../lsp/triples.mjs';

const fill = (over = {}) => ({
  task: 't06-picks-store', setup: 'L-gate', trace_node: 'features/picks/store/picksStore.ts#addPick', line_steps: ['create'],
  scope_ops: ['add_import listPicks'], rule_ids: [], smith: ['Let picks be list picks of.'], code: 'export function addPick(id: string): void {}',
  stable_id: 'picks/store/addPick', model: 'qwen2.5-coder:1.5b', sample_idx: 0, gates: { tsc: true, check: true, atomic: true }, ...over,
});

test('a triple has exactly the schema keys and a deterministic id', () => {
  const a = makeTriple(fill());
  const b = makeTriple(fill({ code: 'export  function addPick(id: string): void {}\n' })); // whitespace only
  assert.deepEqual(Object.keys(a), TRIPLE_KEYS);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, makeTriple(fill({ sample_idx: 1 })).id);
  assert.throws(() => assertTriple({ ...a, id: 'x' }), /deterministic id/);
  assert.throws(() => assertTriple({ ...a, line_steps: ['jump'] }), /line_steps/);
  assert.throws(() => assertTriple({ ...a, extra: 1 }), /keys/);
});

test('a fill that failed any gate is refused', () => {
  for (const g of ['tsc', 'check', 'atomic']) assert.throws(() => makeTriple(fill({ gates: { tsc: true, check: true, atomic: true, [g]: false } })), /every gate/);
  assert.throws(() => makeTriple(fill({ smith: [] })), /Smith/);
});

test('appendTriples skips ids already in the file', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-triples-')), 'triples.jsonl');
  const t = makeTriple(fill());
  assert.equal(appendTriples(f, [t, t]), 1);
  assert.equal(appendTriples(f, [t]), 0);
  assert.equal(fs.readFileSync(f, 'utf8').trim().split('\n').length, 1);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});
