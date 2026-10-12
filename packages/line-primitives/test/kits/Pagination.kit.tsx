import assert from 'node:assert/strict';
import { Pagination, pageItems } from '../../library/components/Pagination';
import type { Ctx, Kit } from '../kit/harness';

const page = (c: Ctx, n: number) => c.screen.getByRole('button', { name: `Page ${n}` });

export const kit: Kit = {
  name: 'Pagination',
  render: (props) => <Pagination page={5} pageCount={10} {...props} />,
  states: {
    default: { check: (c) => { assert.ok(c.screen.getByRole('navigation', { name: 'Pagination' })); assert.deepEqual(pageItems(5, 10), [1, 'gap', 4, 5, 6, 'gap', 10]); } },
    current: { check: (c) => assert.equal(page(c, 5).getAttribute('aria-current'), 'page') },
    disabled: { props: { page: 1 }, check: (c) => { assert.equal((c.screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled, true); assert.equal((c.screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled, false); } },
  },
  events: {
    change: { act: (c) => c.user.click(c.screen.getByRole('button', { name: 'Next' })), expect: (calls) => assert.deepEqual(calls[0], [6]) },
  },
  keys: {
    Enter: { props: (spy) => ({ onPageChange: spy }), act: async (c) => { page(c, 10).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.deepEqual(c.spy.mock.calls[0]?.arguments, [10]) },
    Tab: { act: async (c) => { await c.user.tab(); await c.user.tab(); }, check: (c) => assert.equal(document.activeElement, page(c, 1)) },
  },
};
