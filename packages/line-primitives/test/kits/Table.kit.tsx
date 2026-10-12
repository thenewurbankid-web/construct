import assert from 'node:assert/strict';
import { Table } from '../../library/components/Table';
import type { Ctx, Kit } from '../kit/harness';

const COLUMNS = [{ key: 'name', header: 'Name', sortable: true }, { key: 'total', header: 'Total' }];
const ROWS = [{ id: 'o1', name: 'Ada', total: '€12' }, { id: 'o2', name: 'Grace', total: '€30' }];
const table = (c: Ctx) => c.screen.getByRole('table', { name: 'Orders' });
const nameHeader = (c: Ctx) => c.screen.getByRole('columnheader', { name: /Name/ });

export const kit: Kit = {
  name: 'Table',
  render: (props) => <Table caption="Orders" columns={COLUMNS} rows={ROWS} {...props} />,
  states: {
    default: { check: (c) => { assert.equal(c.screen.getAllByRole('row').length, 3); assert.equal(nameHeader(c).getAttribute('aria-sort'), 'none'); } },
    empty: { props: { rows: [], emptyText: 'No orders yet.' }, check: (c) => assert.match(table(c).textContent ?? '', /No orders yet\./) },
    loading: { props: { loading: true, rows: [] }, check: (c) => { assert.equal(table(c).getAttribute('aria-busy'), 'true'); assert.match(table(c).textContent ?? '', /Loading/); } },
    sorted: { props: { sort: { column: 'name', direction: 'descending' } }, check: (c) => assert.equal(nameHeader(c).getAttribute('aria-sort'), 'descending') },
    selected: { props: { selectable: true, selected: ['o2'] }, check: (c) => { assert.equal((c.screen.getByRole('checkbox', { name: 'Select Grace' }) as HTMLInputElement).checked, true); assert.equal(c.screen.getAllByRole('row')[2].getAttribute('aria-selected'), 'true'); } },
  },
  events: {
    sortChange: { act: (c) => c.user.click(c.screen.getByRole('button', { name: /Name/ })), expect: (calls) => assert.deepEqual(calls[0], [{ column: 'name', direction: 'ascending' }]) },
    selectionChange: { props: { selectable: true }, act: (c) => c.user.click(c.screen.getByRole('checkbox', { name: 'Select Ada' })), expect: (calls) => assert.deepEqual(calls[0], [['o1']]) },
  },
  keys: {
    Enter: { props: (spy) => ({ onSortChange: spy, sort: { column: 'name', direction: 'ascending' } }), act: async (c) => { c.screen.getByRole('button', { name: /Name/ }).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.deepEqual(c.spy.mock.calls[0]?.arguments, [{ column: 'name', direction: 'descending' }]) },
    Space: { props: (spy) => ({ selectable: true, onSelectionChange: spy }), act: async (c) => { c.screen.getByRole('checkbox', { name: 'Select Grace' }).focus(); await c.user.keyboard(' '); }, check: (c) => assert.deepEqual(c.spy.mock.calls[0]?.arguments, [['o2']]) },
  },
};
