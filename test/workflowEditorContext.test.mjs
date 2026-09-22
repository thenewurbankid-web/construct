// Epic #223 -- deterministic XState source edits for a machine's context,
// actions and guards (workflowEditor.mjs), read back by the extractor and
// narrated in plain English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { editWorkflow } from '../packages/engine/workflowEditor.mjs';
import { extractMachines } from '../packages/engine/workflowExtractor.mjs';
import { compileWorkflow } from '../packages/engine/workflowGenerator.mjs';
import { narrateMachine } from '../packages/engine/workflowNarrator.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/workflow-graphs/checkout.json', import.meta.url), 'utf8'));
const SRC = compileWorkflow(fixture, { name: 'Checkout' }).source;

const edit = (source, req) => editWorkflow(source, { machine: 0, ...req });
const machine0 = (source) => extractMachines(source).machines[0];
const edges = (source) => machine0(source).transitions.map((t) => `${t.from}-${t.event}->${t.target}`);
const must = (source, req) => {
  const r = edit(source, req);
  assert.ok(r.ok, `${JSON.stringify(req)}: ${r.error}`);
  return r.source;
};

test('context: add/set/remove round-trips to the original bytes and keeps the interface in sync', () => {
  const added = must(SRC, { op: 'addContextField', name: 'coupon', initial: "'SAVE10'", type: 'string' });
  assert.ok(added.includes("context: { quantity: 1, error: null, coupon: 'SAVE10' }"));
  assert.ok(added.includes('    coupon: string;'));
  assert.deepEqual(machine0(added).context.map((f) => [f.name, f.initial, f.type]), [['quantity', '1', 'number'], ['error', 'null', 'string | null'], ['coupon', "'SAVE10'", 'string']]);
  const changed = must(added, { op: 'setContextField', name: 'quantity', initial: '2', type: 'number | null' });
  assert.equal(machine0(changed).context[0].initial, '2');
  assert.equal(machine0(changed).context[0].type, 'number | null');
  assert.equal(must(added, { op: 'removeContextField', name: 'coupon' }), SRC);
});

test('context: creates the context object when the machine has none, and works untyped', () => {
  const tiny = `export const m = createMachine({ id: 'm', initial: 'a', states: { a: {} } });`;
  const r = must(tiny, { op: 'addContextField', name: 'count', initial: '0' });
  assert.ok(r.includes('context: { count: 0 },'));
  assert.deepEqual(machine0(r).context, [{ name: 'count', initial: '0' }]);
  assert.equal(machine0(must(r, { op: 'removeContextField', name: 'count' })).context.length, 0);
});

test('context: refusals (non-literal, injection, duplicate, missing type, unknown field)', () => {
  assert.match(edit(SRC, { op: 'addContextField', name: 'x', initial: 'process.exit(1)', type: 'number' }).error, /plain literal/);
  assert.match(edit(SRC, { op: 'addContextField', name: 'x', initial: '1); evil(', type: 'number' }).error, /not a (valid|plain) literal/);
  assert.match(edit(SRC, { op: 'addContextField', name: 'x', initial: '1', type: 'number; y: string' }).error, /valid type|single/);
  assert.match(edit(SRC, { op: 'addContextField', name: 'quantity', initial: '1', type: 'number' }).error, /already/);
  assert.match(edit(SRC, { op: 'addContextField', name: 'x', initial: '1' }).error, /type is required/);
  assert.match(edit(SRC, { op: 'addContextField', name: 'bad name', initial: '1', type: 'number' }).error, /not a valid/);
  assert.match(edit(SRC, { op: 'removeContextField', name: 'nope' }).error, /no "nope"/);
  const spread = `export const m = createMachine({ id: 'm', initial: 'a', context: { ...base }, states: { a: {} } });`;
  assert.match(edit(spread, { op: 'addContextField', name: 'x', initial: '1' }).error, /plain object literal/);
});

test('actions: declare, assign to entry/exit/transition, unassign, remove -- read back by extractor and narrator', () => {
  let s = must(SRC, { op: 'declareAction', name: 'track' });
  s = must(s, { op: 'declareAction', name: 'audit' });
  s = must(s, { op: 'declareGuard', name: 'hasError' });
  assert.deepEqual(machine0(s).declared, { actions: ['track', 'audit'], guards: ['hasError'] });
  s = must(s, { op: 'assignAction', name: 'track', where: 'entry', path: 'idle' });
  s = must(s, { op: 'assignAction', name: 'audit', where: 'entry', path: 'idle' });
  s = must(s, { op: 'assignAction', name: 'audit', where: 'exit', path: 'submitting' });
  s = must(s, { op: 'assignAction', name: 'track', where: 'transition', from: 'idle', event: 'SUBMIT' });
  s = must(s, { op: 'assignAction', name: 'audit', where: 'transition', from: 'idle', event: 'SUBMIT' });
  const m = machine0(s);
  assert.deepEqual(m.states[0].entry, ['track', 'audit']);
  assert.deepEqual(m.states[1].exit, ['audit']);
  assert.deepEqual(m.transitions[0].actions, ['track', 'audit']);
  const text = narrateMachine(m).text;
  assert.match(text, /On entering, it runs `track` and `audit`\./);
  assert.match(text, /On leaving, it runs `audit`\./);
  assert.match(text, /moves to \*submitting\* and then runs `track` and `audit`/);
  assert.deepEqual(edges(s), edges(SRC));
  s = must(s, { op: 'unassignAction', name: 'track', where: 'transition', from: 'idle', event: 'SUBMIT' });
  s = must(s, { op: 'unassignAction', name: 'audit', where: 'transition', from: 'idle', event: 'SUBMIT' });
  s = must(s, { op: 'unassignAction', name: 'track', where: 'entry', path: 'idle' });
  s = must(s, { op: 'unassignAction', name: 'audit', where: 'entry', path: 'idle' });
  s = must(s, { op: 'unassignAction', name: 'audit', where: 'exit', path: 'submitting' });
  s = must(s, { op: 'removeAction', name: 'track' });
  s = must(s, { op: 'removeAction', name: 'audit' });
  assert.match(edit(s, { op: 'removeGuard', name: 'hasError' }).error, /still used by submitting/);
  s = must(s, { op: 'setGuard', from: 'submitting', event: 'FAILURE', name: '' });
  s = must(s, { op: 'removeGuard', name: 'hasError' });
  assert.deepEqual(machine0(s).declared, { actions: [], guards: [] });
  assert.deepEqual(machine0(s).transitions.map((t) => t.actions), machine0(SRC).transitions.map((t) => t.actions));
});

test('actions: refusals (undeclared, duplicate, still used, no setup, branches)', () => {
  assert.match(edit(SRC, { op: 'assignAction', name: 'ghost', where: 'entry', path: 'idle' }).error, /declare it first/);
  let s = must(SRC, { op: 'declareAction', name: 'track' });
  assert.match(edit(s, { op: 'declareAction', name: 'track' }).error, /already declared/);
  s = must(s, { op: 'assignAction', name: 'track', where: 'entry', path: 'idle' });
  assert.match(edit(s, { op: 'assignAction', name: 'track', where: 'entry', path: 'idle' }).error, /already runs/);
  assert.match(edit(s, { op: 'removeAction', name: 'track' }).error, /still used by entry of idle/);
  assert.match(edit(s, { op: 'unassignAction', name: 'track', where: 'exit', path: 'idle' }).error, /does not run there/);
  assert.match(edit(s, { op: 'assignAction', name: 'track', where: 'transition', from: 'idle', event: 'NOPE' }).error, /No single/);
  assert.match(edit(s, { op: 'assignAction', name: 'track', where: 'sideways', path: 'idle' }).error, /entry, exit or transition/);
  const plain = `export const m = createMachine({ id: 'm', initial: 'a', states: { a: {} } });`;
  assert.match(edit(plain, { op: 'declareAction', name: 'x' }).error, /setup/);
  assert.ok(machine0(must(plain, { op: 'assignAction', name: 'x', where: 'entry', path: 'a' })).states[0].entry.includes('x'));
  const branched = `export const m = createMachine({ id: 'm', initial: 'a', states: { a: { on: { GO: [{ target: 'b', guard: 'g' }, { target: 'b' }] } }, b: {} } });`;
  assert.match(edit(branched, { op: 'assignAction', name: 'x', where: 'transition', from: 'a', event: 'GO' }).error, /No single|several branches/);
});

test('guards: set on a plain and an object transition, replace, clear; narration follows', () => {
  let s = must(SRC, { op: 'declareGuard', name: 'isValid' });
  s = must(s, { op: 'declareGuard', name: 'hasError' });
  s = must(s, { op: 'setGuard', from: 'idle', event: 'SUBMIT', name: 'isValid' });
  assert.equal(machine0(s).transitions[0].guard, 'isValid');
  assert.match(narrateMachine(machine0(s)).text, /only if it is valid/);
  s = must(s, { op: 'setGuard', from: 'submitting', event: 'FAILURE', name: 'isValid' });
  assert.equal(machine0(s).transitions[2].guard, 'isValid');
  s = must(s, { op: 'setGuard', from: 'idle', event: 'SUBMIT', name: '' });
  assert.equal(machine0(s).transitions[0].guard, undefined);
  assert.match(edit(s, { op: 'setGuard', from: 'idle', event: 'SUBMIT', name: '' }).error, /no guard/);
  assert.match(edit(SRC, { op: 'setGuard', from: 'idle', event: 'SUBMIT', name: 'ghost' }).error, /declare it first/);
});

test('narrator: context sentences use plain English for types and initial values', () => {
  const n = narrateMachine(machine0(SRC));
  assert.deepEqual(n.context, ['It remembers quantity (a number), starting as 1.', 'It remembers error (text that can be empty), starting as empty.']);
  const s = must(SRC, { op: 'addContextField', name: 'tags', initial: '[]', type: 'string[]' });
  assert.match(narrateMachine(machine0(s)).context[2], /It remembers tags \(of type `string\[\]`\), starting as an empty list\./);
});
