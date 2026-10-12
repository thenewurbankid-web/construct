import assert from 'node:assert/strict';
import { Card } from '../../library/components/Card';
import type { Ctx, Kit } from '../kit/harness';

const region = (c: Ctx) => c.screen.getByRole('region', { name: 'Order #1042' });

export const kit: Kit = {
  name: 'Card',
  render: (props) => <Card title="Order #1042" description="Placed today" footer="3 items" {...props}>Ships tomorrow</Card>,
  states: {
    default: { check: (c) => { assert.match(region(c).textContent ?? '', /Ships tomorrow/); assert.equal(c.screen.queryByRole('button'), null); } },
    interactive: { props: { onPress: () => {} }, check: (c) => assert.ok(c.screen.getByRole('button', { name: 'Order #1042' })) },
    selected: { props: { selected: true }, check: (c) => assert.equal(region(c).getAttribute('aria-current'), 'true') },
  },
  events: {
    press: { act: (c) => c.user.click(c.screen.getByRole('button', { name: 'Order #1042' })) },
  },
  keys: {
    Enter: { props: (spy) => ({ onPress: spy }), act: async (c) => { c.screen.getByRole('button').focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.equal(c.spy.mock.callCount(), 1) },
  },
};
