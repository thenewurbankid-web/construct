import assert from 'node:assert/strict';
import { Tabs } from '../../library/components/Tabs';
import type { Ctx, Kit } from '../kit/harness';

const TABS = [
  { value: 'details', label: 'Details', content: 'Order details' },
  { value: 'items', label: 'Items', content: 'Three items' },
  { value: 'history', label: 'History', content: 'Placed yesterday' },
];
const tab = (c: Ctx, name: string) => c.screen.getByRole('tab', { name });
const selected = (c: Ctx) => c.screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;
const from = (start: string, k: string) => ({ act: async (c: Ctx) => { tab(c, start).focus(); await c.user.keyboard(k); } });

export const kit: Kit = {
  name: 'Tabs',
  render: (props) => <Tabs label="Order" tabs={TABS} {...props} />,
  states: {
    default: { check: (c) => { assert.equal(selected(c), 'Details'); assert.equal(c.screen.getByRole('tabpanel').textContent, 'Order details'); assert.ok(c.screen.getByRole('tablist', { name: 'Order' })); } },
    selected: { props: { defaultValue: 'items' }, check: (c) => { assert.equal(selected(c), 'Items'); assert.equal(c.screen.getByRole('tabpanel', { name: 'Items' }).textContent, 'Three items'); } },
    disabled: { props: { tabs: [...TABS, { value: 'returns', label: 'Returns', content: '-', disabled: true }] }, check: (c) => assert.equal((tab(c, 'Returns') as HTMLButtonElement).disabled, true) },
    orientation: { props: { orientation: 'vertical' }, check: (c) => assert.equal(c.screen.getByRole('tablist').getAttribute('aria-orientation'), 'vertical') },
  },
  events: {
    change: { act: (c) => c.user.click(tab(c, 'History')), expect: (calls) => assert.deepEqual(calls[0], ['history']) },
  },
  keys: {
    ArrowRight: { ...from('Details', '{ArrowRight}'), check: (c) => assert.equal(selected(c), 'Items') },
    ArrowLeft: { ...from('Details', '{ArrowLeft}'), check: (c) => assert.equal(selected(c), 'History') },
    Home: { props: { defaultValue: 'history' }, ...from('History', '{Home}'), check: (c) => assert.equal(selected(c), 'Details') },
    End: { ...from('Details', '{End}'), check: (c) => assert.equal(selected(c), 'History') },
  },
};
