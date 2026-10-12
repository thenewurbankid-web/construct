import assert from 'node:assert/strict';
import { Button } from '../../library/components/Button';
import { Dialog } from '../../library/components/Dialog';
import type { Ctx, Kit } from '../kit/harness';

const trigger = (c: Ctx) => c.screen.getByRole('button', { name: 'Delete order' });

export const kit: Kit = {
  name: 'Dialog',
  render: (props) => <Dialog title="Delete this order?" description="It cannot be undone." trigger={<Button label="Delete order" />} footer={<Button variant="danger" label="Delete" />} {...props} />,
  states: {
    default: { check: (c) => { assert.equal(c.screen.queryByRole('dialog'), null); assert.equal(trigger(c).getAttribute('aria-expanded'), 'false'); } },
    open: { act: (c) => c.user.click(trigger(c)), check: (c) => { const d = c.screen.getByRole('dialog', { name: 'Delete this order?' }); assert.ok(d.getAttribute('aria-describedby')); assert.ok(d.contains(document.activeElement)); } },
    modal: { props: { alert: true, defaultOpen: true }, check: (c) => assert.ok(c.screen.getByRole('alertdialog', { name: 'Delete this order?' })) },
  },
  events: {
    openChange: { act: (c) => c.user.click(trigger(c)), expect: (calls) => assert.deepEqual(calls[0], [true]) },
  },
  keys: {
    Escape: { act: async (c) => { await c.user.click(trigger(c)); await c.user.keyboard('{Escape}'); }, check: (c) => { assert.equal(c.screen.queryByRole('dialog'), null); assert.equal(document.activeElement, trigger(c)); } },
    Tab: { act: async (c) => { await c.user.click(trigger(c)); for (let i = 0; i < 4; i += 1) await c.user.tab(); }, check: (c) => assert.ok(c.screen.getByRole('dialog').contains(document.activeElement)) },
  },
};
