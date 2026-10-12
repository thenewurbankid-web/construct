import assert from 'node:assert/strict';
import { waitFor } from '@testing-library/react';
import { Menu } from '../../library/components/Menu';
import type { Ctx, Kit } from '../kit/harness';

const ITEMS = [{ id: 'edit', label: 'Edit' }, { id: 'duplicate', label: 'Duplicate' }, { id: 'delete', label: 'Delete', danger: true }];
const trigger = (c: Ctx) => c.screen.getByRole('button', { name: /Actions/ });
// Radix moves focus to the first item after the menu mounts; wait for it before the next key.
const openByKey = async (c: Ctx, k = '{Enter}') => { trigger(c).focus(); await c.user.keyboard(k); await waitFor(() => assert.equal(document.activeElement?.getAttribute('role'), 'menuitem')); };

export const kit: Kit = {
  name: 'Menu',
  render: (props) => <Menu label="Actions" items={ITEMS} {...props} />,
  states: {
    default: { check: (c) => { assert.equal(trigger(c).getAttribute('aria-haspopup'), 'menu'); assert.equal(trigger(c).getAttribute('aria-expanded'), 'false'); } },
    open: { act: (c) => openByKey(c), check: (c) => { assert.ok(c.screen.getByRole('menu')); assert.equal(c.screen.getAllByRole('menuitem').length, 3); } },
    disabled: { props: { items: [...ITEMS, { id: 'archive', label: 'Archive', disabled: true }] }, act: (c) => openByKey(c), check: (c) => assert.equal(c.screen.getByRole('menuitem', { name: 'Archive' }).getAttribute('aria-disabled'), 'true') },
  },
  events: {
    select: { act: async (c) => { await openByKey(c); await c.user.click(c.screen.getByRole('menuitem', { name: 'Duplicate' })); }, expect: (calls) => assert.deepEqual(calls[0], ['duplicate']) },
    openChange: { act: (c) => openByKey(c), expect: (calls) => assert.deepEqual(calls[0], [true]) },
  },
  keys: {
    Enter: { props: (spy) => ({ onSelect: spy }), act: async (c) => { await openByKey(c); await c.user.keyboard('{Enter}'); }, check: (c) => assert.deepEqual(c.spy.mock.calls[0]?.arguments, ['edit']) },
    Space: { act: (c) => openByKey(c, ' '), check: (c) => assert.ok(c.screen.getByRole('menu')) },
    ArrowDown: { act: async (c) => { await openByKey(c, '{ArrowDown}'); await c.user.keyboard('{ArrowDown}'); }, check: (c) => assert.equal(document.activeElement?.textContent, 'Duplicate') },
    ArrowUp: { act: async (c) => { await openByKey(c); await c.user.keyboard('{ArrowDown}'); await waitFor(() => assert.equal(document.activeElement?.textContent, 'Duplicate')); await c.user.keyboard('{ArrowUp}'); }, check: (c) => waitFor(() => assert.equal(document.activeElement?.textContent, 'Edit')) },
    Escape: { act: async (c) => { await openByKey(c); await c.user.keyboard('{Escape}'); }, check: (c) => { assert.equal(c.screen.queryByRole('menu'), null); assert.equal(document.activeElement, trigger(c)); } },
  },
};
