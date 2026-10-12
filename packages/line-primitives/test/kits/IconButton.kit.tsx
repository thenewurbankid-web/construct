import assert from 'node:assert/strict';
import { IconButton } from '../../library/components/IconButton';
import type { Ctx, Kit } from '../kit/harness';

const btn = (c: Ctx) => c.screen.getByRole('button', { name: 'Delete order' });

export const kit: Kit = {
  name: 'IconButton',
  render: (props) => <IconButton label="Delete order" icon="🗑" {...props} />,
  states: {
    default: { check: (c) => assert.equal(btn(c).getAttribute('aria-label'), 'Delete order') },
    disabled: { props: { disabled: true }, check: (c) => assert.equal((btn(c) as HTMLButtonElement).disabled, true) },
    loading: { props: (spy) => ({ loading: true, onClick: spy }), act: (c) => c.user.click(btn(c)), check: (c) => { assert.equal(btn(c).getAttribute('aria-busy'), 'true'); assert.equal(c.spy.mock.callCount(), 0); } },
  },
  events: { press: { act: (c) => c.user.click(btn(c)) } },
  keys: {
    Enter: { props: (spy) => ({ onClick: spy }), act: async (c) => { btn(c).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.equal(c.spy.mock.callCount(), 1) },
    Space: { props: (spy) => ({ onClick: spy }), act: async (c) => { btn(c).focus(); await c.user.keyboard(' '); }, check: (c) => assert.equal(c.spy.mock.callCount(), 1) },
  },
};
