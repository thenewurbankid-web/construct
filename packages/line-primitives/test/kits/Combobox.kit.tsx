import assert from 'node:assert/strict';
import { Combobox } from '../../library/components/Combobox';
import type { Ctx, Kit } from '../kit/harness';

const OPTIONS = [{ value: 'ams', label: 'Amsterdam' }, { value: 'ber', label: 'Berlin' }, { value: 'bom', label: 'Mumbai' }];
const input = (c: Ctx) => c.screen.getByRole('combobox', { name: /City/ }) as HTMLInputElement;
const listbox = (c: Ctx) => c.screen.queryByRole('listbox');
const activeLabel = (c: Ctx) => document.getElementById(input(c).getAttribute('aria-activedescendant') ?? '')?.textContent;

export const kit: Kit = {
  name: 'Combobox',
  render: (props) => <Combobox label="City" options={OPTIONS} {...props} />,
  states: {
    default: { check: (c) => { assert.equal(input(c).getAttribute('aria-expanded'), 'false'); assert.equal(listbox(c), null); } },
    open: { act: (c) => c.user.type(input(c), 'b'), check: (c) => { assert.equal(input(c).getAttribute('aria-expanded'), 'true'); assert.deepEqual(c.screen.getAllByRole('option').map((o) => o.textContent), ['Berlin', 'Mumbai']); } },
    value: { props: { value: 'ber' }, check: (c) => assert.equal(input(c).value, 'Berlin') },
    empty: { act: (c) => c.user.type(input(c), 'zzz'), check: (c) => { assert.equal(listbox(c), null); assert.equal(c.screen.getByRole('status').textContent, 'No results'); } },
    disabled: { props: { disabled: true }, check: (c) => assert.equal(input(c).disabled, true) },
    invalid: { props: { error: 'Pick a city from the list.' }, check: (c) => { assert.equal(input(c).getAttribute('aria-invalid'), 'true'); assert.equal(c.screen.getByRole('alert').textContent, 'Pick a city from the list.'); } },
    required: { props: { required: true }, check: (c) => assert.equal(input(c).required, true) },
  },
  events: {
    change: { act: async (c) => { await c.user.type(input(c), 'mum'); await c.user.click(c.screen.getByRole('option', { name: 'Mumbai' })); }, expect: (calls) => assert.deepEqual(calls[0], ['bom']) },
    inputChange: { act: (c) => c.user.type(input(c), 'a'), expect: (calls) => assert.deepEqual(calls[0], ['a']) },
    openChange: { act: (c) => c.user.type(input(c), 'a'), expect: (calls) => assert.deepEqual(calls[0], [true]) },
  },
  keys: {
    ArrowDown: { act: async (c) => { await c.user.click(input(c)); await c.user.keyboard('{ArrowDown}{ArrowDown}'); }, check: (c) => assert.equal(activeLabel(c), 'Berlin') },
    ArrowUp: { act: async (c) => { await c.user.click(input(c)); await c.user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}'); }, check: (c) => assert.equal(activeLabel(c), 'Berlin') },
    Enter: { props: (spy) => ({ onValueChange: spy }), act: async (c) => { await c.user.type(input(c), 'ber'); await c.user.keyboard('{Enter}'); }, check: (c) => { assert.deepEqual(c.spy.mock.calls[0]?.arguments, ['ber']); assert.equal(input(c).value, 'Berlin'); assert.equal(listbox(c), null); } },
    Escape: { act: async (c) => { await c.user.type(input(c), 'a'); await c.user.keyboard('{Escape}'); }, check: (c) => assert.equal(input(c).getAttribute('aria-expanded'), 'false') },
  },
};
