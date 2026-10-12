import assert from 'node:assert/strict';
import { EmptyState } from '../../library/components/EmptyState';
import type { Kit } from '../kit/harness';

export const kit: Kit = {
  name: 'EmptyState',
  render: (props) => <EmptyState title="No orders yet" description="Orders you place show up here." icon="📦" {...props} />,
  states: {
    default: { check: (c) => { assert.ok(c.screen.getByRole('region', { name: 'No orders yet' })); assert.equal(c.screen.queryByRole('button'), null); } },
    interactive: { props: { actionLabel: 'Browse products' }, check: (c) => assert.ok(c.screen.getByRole('button', { name: 'Browse products' })) },
  },
  events: {
    press: { props: { actionLabel: 'Browse products' }, act: (c) => c.user.click(c.screen.getByRole('button', { name: 'Browse products' })) },
  },
  keys: {
    Enter: { props: (spy) => ({ actionLabel: 'Browse products', onAction: spy }), act: async (c) => { c.screen.getByRole('button').focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.equal(c.spy.mock.callCount(), 1) },
  },
};
