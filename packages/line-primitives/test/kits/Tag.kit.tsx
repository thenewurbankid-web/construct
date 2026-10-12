import assert from 'node:assert/strict';
import { Tag } from '../../library/components/Tag';
import type { Ctx, Kit, Spy } from '../kit/harness';

const remove = (c: Ctx) => c.screen.getByRole('button', { name: 'Remove Vegan' });
const removeBy = (k: string) => ({ props: (spy: Spy) => ({ onRemove: spy }), act: async (c: Ctx) => { remove(c).focus(); await c.user.keyboard(k); }, check: (c: Ctx) => assert.equal(c.spy.mock.callCount(), 1) });

export const kit: Kit = {
  name: 'Tag',
  render: (props) => <Tag label="Vegan" {...props} />,
  states: {
    default: { check: (c) => { assert.ok(c.screen.getByText('Vegan')); assert.equal(c.screen.queryByRole('button'), null); } },
    selected: { props: { onPress: () => {}, selected: true }, check: (c) => assert.equal(c.screen.getByRole('button', { name: 'Vegan' }).getAttribute('aria-pressed'), 'true') },
    dismissible: { props: { onRemove: () => {} }, check: (c) => assert.ok(remove(c)) },
    disabled: { props: { onRemove: () => {}, disabled: true }, check: (c) => assert.equal((remove(c) as HTMLButtonElement).disabled, true) },
  },
  events: {
    remove: { act: (c) => c.user.click(remove(c)) },
    press: { act: (c) => c.user.click(c.screen.getByRole('button', { name: 'Vegan' })) },
    change: { props: { selected: true }, act: (c) => c.user.click(c.screen.getByRole('button', { name: 'Vegan' })), expect: (calls) => assert.deepEqual(calls[0], [false]) },
  },
  keys: {
    Backspace: removeBy('{Backspace}'),
    Delete: removeBy('{Delete}'),
    Enter: { props: (spy) => ({ onPress: spy }), act: async (c) => { c.screen.getByRole('button', { name: 'Vegan' }).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.equal(c.spy.mock.callCount(), 1) },
  },
};
