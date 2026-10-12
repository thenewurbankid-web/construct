import assert from 'node:assert/strict';
import { fireEvent, waitFor } from '@testing-library/react';
import { Toast } from '../../library/components/Toast';
import type { Ctx, Kit } from '../kit/harness';

const toast = (c: Ctx) => c.screen.queryByText('Order placed');

export const kit: Kit = {
  name: 'Toast',
  render: (props) => <Toast title="Order placed" description="We will email you when it ships." duration={60000} {...props} />,
  states: {
    default: { check: (c) => assert.equal(toast(c), null) },
    open: { props: { defaultOpen: true, dismissible: false }, check: (c) => { assert.ok(toast(c)); assert.equal(c.screen.queryByRole('button', { name: 'Close' }), null); assert.ok(c.screen.getByRole('region', { name: /Notification/ })); } },
    dismissible: { props: { defaultOpen: true }, check: (c) => assert.ok(c.screen.getByRole('button', { name: 'Close' })) },
  },
  events: {
    openChange: { props: { defaultOpen: true }, act: (c) => c.user.click(c.screen.getByRole('button', { name: 'Close' })), expect: (calls) => assert.deepEqual(calls[0], [false]) },
    press: { props: { defaultOpen: true, actionLabel: 'Undo' }, act: (c) => c.user.click(c.screen.getByRole('button', { name: 'Undo' })) },
  },
  keys: {
    // Radix listens for the hotkey by event.code, which user-event leaves unset for F-keys.
    F8: { props: { defaultOpen: true }, act: () => { fireEvent.keyDown(document, { key: 'F8', code: 'F8' }); }, check: (c) => assert.ok(c.screen.getByRole('region', { name: /Notification/ }).contains(document.activeElement)) },
    Escape: { props: (spy) => ({ defaultOpen: true, onOpenChange: spy }), act: async (c) => { c.screen.getByRole('button', { name: 'Close' }).focus(); await c.user.keyboard('{Escape}'); }, check: (c) => waitFor(() => assert.deepEqual(c.spy.mock.calls[0]?.arguments, [false])) },
  },
};
