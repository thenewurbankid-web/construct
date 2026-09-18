// Epic #57 / #61 -- deterministic XState source edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { editWorkflow } from '../src/engine/workflowEditor.mjs';
import { extractMachines } from '../src/engine/workflowExtractor.mjs';
import { compileWorkflow } from '../src/engine/workflowGenerator.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/workflow-graphs/checkout.json', import.meta.url), 'utf8'));
const SRC = compileWorkflow(fixture, { name: 'Checkout' }).source;

const edit = (source, req) => editWorkflow(source, { machine: 0, ...req });
const shape = (source) => {
  const m = extractMachines(source).machines[0];
  return { states: m.states.map((s) => s.path), edges: m.transitions.map((t) => `${t.from}-${t.event}->${t.target}`) };
};

test('addState appends a state, everything else byte-identical, machine re-parses', () => {
  const r = edit(SRC, { op: 'addState', name: 'refunded' });
  assert.ok(r.ok, r.error);
  assert.deepEqual(shape(r.source).states, ['idle', 'submitting', 'done', 'refunded']);
  assert.ok(r.source.includes('refunded: {}'));
  assert.ok(r.source.startsWith(SRC.slice(0, SRC.indexOf('done: {'))));
});

test('addState into an empty states object and duplicate/invalid names refused', () => {
  const tiny = `export const m = createMachine({ id: 'm', initial: 'a', states: { a: {} } });`;
  assert.deepEqual(shape(edit(tiny, { op: 'addState', name: 'b' }).source).states, ['a', 'b']);
  assert.equal(edit(tiny, { op: 'addState', name: 'a' }).ok, false);
  assert.equal(edit(tiny, { op: 'addState', name: 'not valid' }).ok, false);
});

test('renameState updates key, initial, and every transition target', () => {
  const r = edit(SRC, { op: 'renameState', path: 'idle', name: 'ready' });
  assert.ok(r.ok, r.error);
  assert.ok(r.source.includes("initial: 'ready'"));
  assert.deepEqual(shape(r.source), {
    states: ['ready', 'submitting', 'done'],
    edges: ['ready-SUBMIT->submitting', 'submitting-SUCCESS->done', 'submitting-FAILURE->ready'],
  });
  assert.equal(edit(SRC, { op: 'renameState', path: 'idle', name: 'done' }).ok, false);
});

test('removeState: refuses initial / still-referenced; removes a free state', () => {
  assert.match(edit(SRC, { op: 'removeState', path: 'idle' }).error, /initial/);
  assert.match(edit(SRC, { op: 'removeState', path: 'done' }).error, /still the target/);
  const withExtra = edit(SRC, { op: 'addState', name: 'tmp' }).source;
  const r = edit(withExtra, { op: 'removeState', path: 'tmp' });
  assert.ok(r.ok, r.error);
  assert.equal(r.source, SRC);
});

test('addTransition to a state with and without an existing on{}', () => {
  const a = edit(SRC, { op: 'addTransition', from: 'idle', event: 'CANCEL', target: 'done' });
  assert.ok(a.ok, a.error);
  assert.ok(shape(a.source).edges.includes('idle-CANCEL->done'));
  const b = edit(SRC, { op: 'addTransition', from: 'done', event: 'RESET', target: 'idle' });
  assert.ok(b.ok, b.error);
  assert.ok(shape(b.source).edges.includes('done-RESET->idle'));
  assert.equal(edit(SRC, { op: 'addTransition', from: 'idle', event: 'SUBMIT', target: 'done' }).ok, false);
  assert.equal(edit(SRC, { op: 'addTransition', from: 'idle', event: 'X', target: 'nope' }).ok, false);
});

test('retarget and remove a plain transition; guarded transitions are refused', () => {
  const r = edit(SRC, { op: 'retargetTransition', from: 'idle', event: 'SUBMIT', target: 'done' });
  assert.ok(r.ok, r.error);
  assert.ok(shape(r.source).edges.includes('idle-SUBMIT->done'));
  const d = edit(SRC, { op: 'removeTransition', from: 'submitting', event: 'SUCCESS' });
  assert.ok(d.ok, d.error);
  assert.ok(!shape(d.source).edges.some((e) => e.includes('SUCCESS')));
  assert.ok(shape(d.source).edges.some((e) => e.includes('FAILURE')));
  const g = edit(SRC, { op: 'retargetTransition', from: 'submitting', event: 'FAILURE', target: 'done' });
  assert.equal(g.ok, false);
  assert.match(g.error, /guarded/);
});

test('removing the only transition and sole state property leaves valid code', () => {
  const r = edit(SRC, { op: 'removeTransition', from: 'idle', event: 'SUBMIT' });
  assert.ok(r.ok, r.error);
  assert.equal(shape(r.source).edges.filter((e) => e.startsWith('idle-')).length, 0);
});

test('nested states: add child, cross-level transitions need an explicit id', () => {
  const src = `export const m = createMachine({
  id: 'p', initial: 'a',
  states: {
    a: { initial: 'a1', states: { a1: { on: { N: 'a2' } }, a2: {} } },
    b: {},
  },
});`;
  const c = edit(src, { op: 'addState', parent: 'a', name: 'a3' });
  assert.ok(c.ok, c.error);
  assert.ok(shape(c.source).states.includes('a.a3'));
  const x = edit(src, { op: 'addTransition', from: 'a.a2', event: 'OUT', target: 'b' });
  assert.ok(x.ok, x.error);
  assert.ok(x.source.includes("'#p.b'"));
  const noId = src.replace("id: 'p', ", '');
  assert.equal(edit(noId, { op: 'addTransition', from: 'a.a2', event: 'OUT', target: 'b' }).ok, false);
});

test('unsupported machines and unknown ops are refused, source untouched', () => {
  const bad = `const base = {}; export const m = createMachine({ ...base, states: { a: {} } });`;
  assert.equal(edit(bad, { op: 'addState', name: 'x' }).ok, false);
  assert.equal(edit(SRC, { op: 'nuke' }).ok, false);
  assert.equal(editWorkflow(SRC, { machine: 5, op: 'addState', name: 'x' }).ok, false);
});
