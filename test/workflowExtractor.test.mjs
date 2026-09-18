// Epic #57 / #60 -- static XState machine extraction from real source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractMachines } from '../src/engine/workflowExtractor.mjs';
import { compileWorkflow } from '../src/engine/workflowGenerator.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/workflow-graphs/checkout.json', import.meta.url), 'utf8'));

test('extracts the real generated checkout fixture (setup().createMachine form)', () => {
  const { source } = compileWorkflow(fixture, { name: 'Checkout' });
  const { machines, error } = extractMachines(source);
  assert.equal(error, null);
  assert.equal(machines.length, 1);
  const m = machines[0];
  assert.equal(m.error, null);
  assert.equal(m.id, 'checkout');
  assert.equal(m.exportName, 'CheckoutWorkflow');
  assert.equal(m.initial, 'idle');
  assert.deepEqual(m.states.map((s) => [s.path, s.initial, s.final]), [
    ['idle', true, false],
    ['submitting', false, false],
    ['done', false, true],
  ]);
  assert.deepEqual(
    m.transitions.map((t) => [t.from, t.event, t.target, t.guard]),
    [
      ['idle', 'SUBMIT', 'submitting', undefined],
      ['submitting', 'SUCCESS', 'done', undefined],
      ['submitting', 'FAILURE', 'idle', 'hasError'],
    ],
  );
});

test('handles plain createMachine({...})', () => {
  const src = `import { createMachine } from 'xstate';
export const m = createMachine({ id: 'toggle', initial: 'off', states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } } });`;
  const { machines } = extractMachines(src);
  assert.equal(machines[0].transitions.length, 2);
  assert.equal(machines[0].states[0].initial, true);
});

test('nested states, always/after/invoke, array transitions, ids, targetless', () => {
  const src = `export const m = createMachine({
    id: 'root', initial: 'a',
    states: {
      a: { initial: 'a1', states: { a1: { on: { NEXT: 'a2' } }, a2: { type: 'final' } }, onDone: 'b' },
      b: {
        always: [{ target: 'c', guard: ({ context }) => context.x > 1 }, { target: '#root.a' }],
        after: { 1000: 'c' },
        on: { PING: { actions: 'log' } },
        invoke: { src: 'x', onDone: 'c', onError: { target: 'c', guard: { type: 'isFatal' } } },
      },
      c: { on: { BACK: '#other', UP: [{ target: 'a', guard: 'g1' }, 'b'] } },
      other: { id: 'other' },
    },
  });`;
  const m = extractMachines(src).machines[0];
  assert.equal(m.error, null);
  assert.deepEqual(m.states.map((s) => s.path), ['a', 'a.a1', 'a.a2', 'b', 'c', 'other']);
  assert.equal(m.states.find((s) => s.path === 'a.a1').initial, true);
  assert.equal(m.states.find((s) => s.path === 'a').type, 'compound');
  const t = (from, event, i = 0) => m.transitions.filter((x) => x.from === from && x.event === event)[i];
  assert.equal(t('a.a1', 'NEXT').target, 'a.a2');
  assert.equal(t('a', 'onDone').target, 'b');
  assert.equal(t('b', 'always').guard, '(inline guard)');
  assert.equal(t('b', 'always', 1).target, 'a');
  assert.equal(t('b', '1000').target, 'c');
  assert.equal(t('b', 'PING').targetless, true);
  assert.equal(t('b', 'invoke.onError').guard, 'isFatal');
  assert.equal(t('c', 'BACK').target, 'other');
  assert.equal(t('c', 'UP', 1).target, 'b');
});

test('unresolvable target is flagged, not thrown', () => {
  const m = extractMachines(`export const m = createMachine({ initial: 'a', states: { a: { on: { GO: 'nowhere' } } } });`).machines[0];
  assert.equal(m.transitions[0].unresolved, true);
  assert.equal(m.transitions[0].target, null);
});

test('graceful degradation: spread config, variable config, unparseable file', () => {
  const spread = extractMachines(`const base = {}; export const m = createMachine({ ...base, initial: 'a', states: { a: {} } });`);
  assert.match(spread.machines[0].error, /spread/);
  const viaVar = extractMachines(`const cfg = { states: {} }; export const m = createMachine(cfg);`);
  assert.match(viaVar.machines[0].error, /not an object literal/);
  const broken = extractMachines(`export const m = createMachine({ initial: `);
  assert.match(broken.error, /Could not parse/);
  assert.deepEqual(broken.machines, []);
  assert.deepEqual(extractMachines('export const x = 1;').machines, []);
});

test('one bad machine does not hide the others in the same file', () => {
  const src = `export const good = createMachine({ initial: 'a', states: { a: {} } });
export const bad = createMachine(dynamicConfig());`;
  const { machines } = extractMachines(src);
  assert.equal(machines.length, 2);
  assert.equal(machines[0].error, null);
  assert.ok(machines[1].error);
});
