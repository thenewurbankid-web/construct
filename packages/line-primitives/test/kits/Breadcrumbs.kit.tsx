import assert from 'node:assert/strict';
import { Breadcrumbs } from '../../library/components/Breadcrumbs';
import type { Kit, Spy } from '../kit/harness';

const ITEMS = [{ label: 'Home', href: '/' }, { label: 'Orders', href: '/orders' }, { label: '#1042', href: '/orders/1042' }];
// jsdom does not navigate; the handler prevents the default, as a client-side router would.
const route = (spy: Spy) => ({ onNavigate: (href: string, e: { preventDefault: () => void }) => { e.preventDefault(); spy(href); } });

export const kit: Kit = {
  name: 'Breadcrumbs',
  render: (props) => <Breadcrumbs items={ITEMS} {...props} />,
  states: {
    default: { check: (c) => { assert.ok(c.screen.getByRole('navigation', { name: 'Breadcrumb' })); assert.equal(c.screen.getAllByRole('link').length, 2); } },
    current: { check: (c) => { const cur = c.screen.getByText('#1042'); assert.equal(cur.getAttribute('aria-current'), 'page'); assert.equal(cur.tagName, 'SPAN'); } },
  },
  events: {
    press: { act: async (c) => { c.screen.getByRole('link', { name: 'Orders' }).addEventListener('click', (e) => e.preventDefault()); await c.user.click(c.screen.getByRole('link', { name: 'Orders' })); }, expect: (calls) => assert.equal(calls[0][0], '/orders') },
  },
  keys: {
    Enter: { props: route, act: async (c) => { c.screen.getByRole('link', { name: 'Home' }).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.deepEqual(c.spy.mock.calls[0]?.arguments, ['/']) },
  },
};
