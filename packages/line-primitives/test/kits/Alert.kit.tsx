import assert from 'node:assert/strict';
import { Alert } from '../../library/components/Alert';
import type { Ctx, Kit } from '../kit/harness';

const dismiss = (c: Ctx) => c.screen.getByRole('button', { name: 'Dismiss' });

export const kit: Kit = {
  name: 'Alert',
  render: (props) => <Alert title="Payment failed" variant="error" {...props}>Your card was declined.</Alert>,
  states: {
    default: { check: (c) => { assert.match(c.screen.getByRole('alert').textContent ?? '', /Payment failed/); assert.equal(c.screen.queryByRole('button'), null); } },
    dismissible: { props: { onDismiss: () => {} }, check: (c) => assert.ok(dismiss(c)) },
  },
  events: {
    dismiss: { act: (c) => c.user.click(dismiss(c)) },
  },
  keys: {
    Enter: { props: (spy) => ({ onDismiss: spy }), act: async (c) => { dismiss(c).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.equal(c.spy.mock.callCount(), 1) },
  },
};
