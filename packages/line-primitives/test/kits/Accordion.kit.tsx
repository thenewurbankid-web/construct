import assert from 'node:assert/strict';
import { Accordion } from '../../library/components/Accordion';
import type { Ctx, Kit } from '../kit/harness';

const ITEMS = [
  { value: 'shipping', title: 'Shipping', content: 'Ships in two days.' },
  { value: 'returns', title: 'Returns', content: 'Free within 30 days.' },
  { value: 'warranty', title: 'Warranty', content: 'Two years.' },
];
const head = (c: Ctx, name: string) => c.screen.getByRole('button', { name });
const open = (c: Ctx, name: string) => head(c, name).getAttribute('aria-expanded') === 'true';
const from = (start: string, k: string) => ({ act: async (c: Ctx) => { head(c, start).focus(); await c.user.keyboard(k); } });

export const kit: Kit = {
  name: 'Accordion',
  render: (props) => <Accordion items={ITEMS} {...props} />,
  states: {
    default: { check: (c) => assert.ok(ITEMS.every((i) => !open(c, i.title))) },
    expanded: { props: { defaultValue: ['returns'] }, check: (c) => { assert.ok(open(c, 'Returns')); assert.equal(c.screen.getByRole('region', { name: 'Returns' }).textContent, 'Free within 30 days.'); } },
    multiple: { props: { multiple: true }, act: async (c) => { await c.user.click(head(c, 'Shipping')); await c.user.click(head(c, 'Warranty')); }, check: (c) => assert.ok(open(c, 'Shipping') && open(c, 'Warranty')) },
    disabled: { props: { items: [...ITEMS, { value: 'faq', title: 'FAQ', content: '-', disabled: true }] }, check: (c) => assert.equal((head(c, 'FAQ') as HTMLButtonElement).disabled, true) },
  },
  events: {
    change: { act: (c) => c.user.click(head(c, 'Shipping')), expect: (calls) => assert.deepEqual(calls[0], [['shipping']]) },
  },
  keys: {
    Enter: { ...from('Shipping', '{Enter}'), check: (c) => assert.ok(open(c, 'Shipping')) },
    Space: { ...from('Shipping', ' '), check: (c) => assert.ok(open(c, 'Shipping')) },
    ArrowDown: { ...from('Shipping', '{ArrowDown}'), check: (c) => assert.equal(document.activeElement, head(c, 'Returns')) },
    ArrowUp: { ...from('Returns', '{ArrowUp}'), check: (c) => assert.equal(document.activeElement, head(c, 'Shipping')) },
    Home: { ...from('Warranty', '{Home}'), check: (c) => assert.equal(document.activeElement, head(c, 'Shipping')) },
    End: { ...from('Shipping', '{End}'), check: (c) => assert.equal(document.activeElement, head(c, 'Warranty')) },
  },
};
