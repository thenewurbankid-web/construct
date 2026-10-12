import assert from 'node:assert/strict';
import { Button } from '../../library/components/Button';
import type { Kit } from '../kit/harness';

const btn = (ctx: { screen: { getByRole: (r: string, o?: object) => HTMLElement } }) => ctx.screen.getByRole('button', { name: /Save/ });

export const kit: Kit = {
  name: 'Button',
  render: (props) => <Button label="Save" {...props} />,
  states: {
    default: { check: (c) => { assert.equal(btn(c).getAttribute('type'), 'button'); assert.equal(btn(c).hasAttribute('disabled'), false); } },
    disabled: { props: { disabled: true }, check: (c) => assert.equal((btn(c) as HTMLButtonElement).disabled, true) },
    loading: { props: (spy) => ({ loading: true, onClick: spy }), act: (c) => c.user.click(btn(c)), check: (c) => { assert.equal(btn(c).getAttribute('aria-busy'), 'true'); assert.equal(c.spy.mock.callCount(), 0); } },
    pressed: { props: { pressed: true }, check: (c) => assert.equal(btn(c).getAttribute('aria-pressed'), 'true') },
  },
  events: {
    press: { act: (c) => c.user.click(btn(c)) },
  },
  keys: {
    Enter: { props: (spy) => ({ onClick: spy }), act: async (c) => { btn(c).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.equal(c.spy.mock.callCount(), 1) },
    Space: { props: (spy) => ({ onClick: spy }), act: async (c) => { btn(c).focus(); await c.user.keyboard(' '); }, check: (c) => assert.equal(c.spy.mock.callCount(), 1) },
  },
};
