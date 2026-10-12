import assert from 'node:assert/strict';
import { Button } from '../../library/components/Button';
import { Drawer } from '../../library/components/Drawer';
import type { Ctx, Kit } from '../kit/harness';

const trigger = (c: Ctx) => c.screen.getByRole('button', { name: 'Filters' });

export const kit: Kit = {
  name: 'Drawer',
  render: (props) => <Drawer title="Filters" trigger={<Button label="Filters" />} {...props}><Button label="Apply" /></Drawer>,
  states: {
    default: { check: (c) => assert.equal(c.screen.queryByRole('dialog'), null) },
    open: { props: { side: 'left' }, act: (c) => c.user.click(trigger(c)), check: (c) => { const d = c.screen.getByRole('dialog', { name: 'Filters' }); assert.equal(d.getAttribute('data-side'), 'left'); } },
    modal: { props: { defaultOpen: true }, check: (c) => assert.ok(c.screen.getByRole('dialog').contains(document.activeElement)) },
    dismissible: { props: { dismissible: false, defaultOpen: true }, act: (c) => c.user.keyboard('{Escape}'), check: (c) => { assert.ok(c.screen.getByRole('dialog')); assert.equal(c.screen.queryByRole('button', { name: 'Close' }), null); } },
  },
  events: {
    openChange: { act: (c) => c.user.click(trigger(c)), expect: (calls) => assert.deepEqual(calls[0], [true]) },
    dismiss: { props: { defaultOpen: true }, act: (c) => c.user.keyboard('{Escape}') },
  },
  keys: {
    Escape: { act: async (c) => { await c.user.click(trigger(c)); await c.user.keyboard('{Escape}'); }, check: (c) => assert.equal(c.screen.queryByRole('dialog'), null) },
    Tab: { act: async (c) => { await c.user.click(trigger(c)); for (let i = 0; i < 3; i += 1) await c.user.tab(); }, check: (c) => assert.ok(c.screen.getByRole('dialog').contains(document.activeElement)) },
  },
};
