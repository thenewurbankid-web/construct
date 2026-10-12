import assert from 'node:assert/strict';
import { Button } from '../../library/components/Button';
import { Popover } from '../../library/components/Popover';
import type { Ctx, Kit } from '../kit/harness';

const trigger = (c: Ctx) => c.screen.getByRole('button', { name: 'Share' });

export const kit: Kit = {
  name: 'Popover',
  render: (props) => <Popover label="Share options" trigger={<Button label="Share" />} {...props}><p>Copy the link to share this list.</p></Popover>,
  states: {
    default: { check: (c) => { assert.equal(c.screen.queryByRole('dialog'), null); assert.equal(trigger(c).getAttribute('aria-expanded'), 'false'); } },
    open: { act: (c) => c.user.click(trigger(c)), check: (c) => { assert.ok(c.screen.getByRole('dialog', { name: 'Share options' })); assert.equal(trigger(c).getAttribute('aria-expanded'), 'true'); } },
    disabled: { props: { disabled: true }, act: (c) => c.user.click(trigger(c)), check: (c) => { assert.equal((trigger(c) as HTMLButtonElement).disabled, true); assert.equal(c.screen.queryByRole('dialog'), null); } },
  },
  events: {
    openChange: { act: (c) => c.user.click(trigger(c)), expect: (calls) => assert.deepEqual(calls[0], [true]) },
    dismiss: { act: async (c) => { await c.user.click(trigger(c)); await c.user.keyboard('{Escape}'); } },
  },
  keys: {
    Enter: { act: async (c) => { trigger(c).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.ok(c.screen.getByRole('dialog')) },
    Escape: { act: async (c) => { await c.user.click(trigger(c)); await c.user.keyboard('{Escape}'); }, check: (c) => { assert.equal(c.screen.queryByRole('dialog'), null); assert.equal(document.activeElement, trigger(c)); } },
  },
};
