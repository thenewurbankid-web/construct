import assert from 'node:assert/strict';
import { Stepper } from '../../library/components/Stepper';
import type { Ctx, Kit } from '../kit/harness';

const STEPS = [{ label: 'Cart' }, { label: 'Address' }, { label: 'Payment' }];
const item = (c: Ctx, i: number) => c.screen.getAllByRole('listitem')[i];

export const kit: Kit = {
  name: 'Stepper',
  render: (props) => <Stepper label="Checkout" steps={STEPS} current={0} {...props} />,
  states: {
    default: { check: (c) => { assert.ok(c.screen.getByRole('list', { name: 'Checkout' })); assert.equal(item(c, 0).getAttribute('aria-current'), 'step'); } },
    current: { props: { current: 2 }, check: (c) => assert.equal(item(c, 2).getAttribute('aria-current'), 'step') },
    complete: { props: { current: 2 }, check: (c) => { assert.match(item(c, 0).textContent ?? '', /\(completed\)/); assert.equal(item(c, 0).getAttribute('data-state'), 'complete'); } },
  },
  events: {
    change: { props: { current: 2 }, act: (c) => c.user.click(c.screen.getByRole('button', { name: /Cart/ })), expect: (calls) => assert.deepEqual(calls[0], [0]) },
  },
  keys: {
    Enter: { props: (spy) => ({ current: 2, onStepChange: spy }), act: async (c) => { c.screen.getByRole('button', { name: /Address/ }).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.deepEqual(c.spy.mock.calls[0]?.arguments, [1]) },
  },
};
