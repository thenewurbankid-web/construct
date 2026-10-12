import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, multiStepFlow, toXStateConfig, currentStep, progress, positionOf } from './index.ts';
import type { Step } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);
type Order = { address: string; card: string; terms: boolean };
const steps: Step<Order>[] = [
  { id: 'address', canLeave: (d) => d.address !== '' },
  { id: 'shipping' },
  { id: 'payment', canLeave: (d) => d.card.length === 16 },
  { id: 'review', canLeave: (d) => d.terms },
];
const blank: Order = { address: '', card: '', terms: false };

test('NEXT is blocked by a step check, then walks first -> middle -> last -> done', () => {
  let s = kit.init({ steps, data: blank });
  assert.equal(s.status, 'first');
  assert.equal(kit.send(s, { type: 'BACK' }), s, 'no step before the first');
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.status, 'first');
  assert.equal(s.blocked, 'address');
  s = kit.send(s, { type: 'NEXT', data: { address: '1 Main St' } });
  assert.equal(currentStep(s), 'shipping');
  assert.equal(s.blocked, null);
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.status, 'middle');
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.status, 'middle', 'blocked on payment');
  assert.equal(s.blocked, 'payment');
  s = kit.send(s, { type: 'NEXT', data: { card: '4242424242424242' } });
  assert.equal(s.status, 'last');
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.status, 'last');
  assert.equal(s.blocked, 'review');
  s = kit.send(s, { type: 'NEXT', data: { terms: true } });
  assert.equal(s.status, 'done');
  assert.equal(currentStep(s), 'done');
  assert.equal(progress(s), 1);
  assert.equal(kit.send(s, { type: 'BACK' }), s, 'done is final');
  s = kit.send(s, { type: 'RESET' });
  assert.equal(s.status, 'first');
  assert.equal(s.data.terms, true, 'RESET keeps the data and starts at the first step');
});

test('BACK and GO_TO only go to steps already reached', () => {
  const full: Order = { address: 'x', card: '4242424242424242', terms: false };
  let s = kit.run(kit.init({ steps, data: full }), [{ type: 'NEXT' }, { type: 'NEXT' }, { type: 'NEXT' }]);
  assert.equal(s.status, 'last');
  s = kit.send(s, { type: 'BACK' });
  assert.equal(currentStep(s), 'payment');
  s = kit.send(s, { type: 'BACK' });
  assert.equal(s.status, 'middle');
  s = kit.send(s, { type: 'BACK' });
  assert.equal(s.status, 'first');
  s = kit.send(s, { type: 'GO_TO', step: 'review' });
  assert.equal(s.status, 'last', 'review was reached before');
  s = kit.send(s, { type: 'GO_TO', step: 'shipping' });
  assert.equal(s.status, 'middle');
  s = kit.send(s, { type: 'GO_TO', step: 'address' });
  assert.equal(s.status, 'first');
  assert.equal(kit.send(s, { type: 'GO_TO', step: 'address' }), s, 'the current step is a no-op');
  assert.equal(kit.send(s, { type: 'GO_TO', step: 'nowhere' }), s);
  const fresh = kit.init({ steps, data: full });
  assert.equal(kit.send(fresh, { type: 'GO_TO', step: 'payment' }), fresh, 'a step not reached yet cannot be jumped to');
  let two = kit.init({ steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], data: {} });
  two = kit.run(two, [{ type: 'NEXT' }, { type: 'NEXT' }]);
  two = kit.send(two, { type: 'BACK' });
  assert.equal(two.status, 'middle');
  two = kit.send(two, { type: 'NEXT' });
  two = kit.send(two, { type: 'GO_TO', step: 'a' });
  two = kit.send(two, { type: 'GO_TO', step: 'b' });
  assert.equal(two.status, 'middle');
  let short = kit.init({ steps: [{ id: 'a' }, { id: 'b' }], data: {} });
  short = kit.send(short, { type: 'NEXT' });
  assert.equal(short.status, 'last');
  short = kit.send(short, { type: 'BACK' });
  assert.equal(short.status, 'first');
});

test('a one-step flow: its only step is the last one', () => {
  let s = kit.init({ steps: [{ id: 'confirm' }], data: {} });
  assert.equal(s.status, 'last');
  assert.equal(positionOf(0, 1), 'last');
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.status, 'done');
  s = kit.send(s, { type: 'RESET' });
  assert.equal(s.status, 'last');
  assert.throws(() => machine.init({ steps: [], data: {} }), /at least one step/);
});

test('multiStepFlow walks a list of events', () => {
  assert.equal(multiStepFlow(steps, { address: 'x', card: '4242424242424242', terms: true }, [{ type: 'NEXT' }, { type: 'NEXT' }, { type: 'NEXT' }, { type: 'NEXT' }]).status, 'done');
});

test('toXStateConfig runs as a real xstate actor and agrees with the pure machine (when xstate is installed)', async (t) => {
  let x: any;
  try { x = await import('xstate'); } catch { t.skip('xstate is not installed here'); return; }
  const actor = x.createActor(x.createMachine(toXStateConfig('checkout', steps, blank, x.assign))).start();
  const events: any[] = [{ type: 'NEXT' }, { type: 'NEXT', data: { address: '1 Main St' } }, { type: 'NEXT' }, { type: 'BACK' }, { type: 'NEXT' }, { type: 'NEXT', data: { card: '4242424242424242' } }, { type: 'NEXT', data: { terms: true } }];
  let pure = machine.init({ steps, data: blank });
  for (const e of events) {
    actor.send(e);
    pure = machine.send(pure, e);
    assert.equal(actor.getSnapshot().value, currentStep(pure), `after ${JSON.stringify(e)}`);
  }
  assert.equal(actor.getSnapshot().status, 'done');
  actor.stop();
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
