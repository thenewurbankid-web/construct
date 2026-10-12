import assert from 'node:assert/strict';
import { Link } from '../../library/components/Link';
import type { Ctx, Kit, Spy } from '../kit/harness';

const link = (c: Ctx) => c.screen.getByRole('link', { name: /Orders/ });
// jsdom does not navigate; a press handler that prevents the default keeps the test on the page.
const stay = (spy: Spy) => ({ onClick: (e: { preventDefault: () => void }) => { e.preventDefault(); spy(e); } });

export const kit: Kit = {
  name: 'Link',
  render: (props) => <Link href="/orders" {...props}>Orders</Link>,
  states: {
    default: { check: (c) => assert.equal(link(c).getAttribute('href'), '/orders') },
    current: { props: { current: true }, check: (c) => assert.equal(link(c).getAttribute('aria-current'), 'page') },
    disabled: { props: { disabled: true }, check: (c) => { assert.equal(link(c).getAttribute('aria-disabled'), 'true'); assert.equal(link(c).hasAttribute('href'), false); } },
  },
  events: {
    press: { act: async (c) => { link(c).addEventListener('click', (e) => e.preventDefault()); await c.user.click(link(c)); } },
  },
  keys: {
    Enter: { props: stay, act: async (c) => { link(c).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.equal(c.spy.mock.callCount(), 1) },
  },
};

