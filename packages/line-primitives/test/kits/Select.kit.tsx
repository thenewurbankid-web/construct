import assert from 'node:assert/strict';
import { Select } from '../../library/components/Select';
import type { Ctx, Kit } from '../kit/harness';

const OPTIONS = [{ value: 'nl', label: 'Netherlands' }, { value: 'in', label: 'India' }, { value: 'us', label: 'United States' }];
// While open, Radix hides everything outside the list from assistive tech, so the trigger query includes hidden nodes.
const trigger = (c: Ctx) => c.screen.getByRole('combobox', { name: /Country/, hidden: true });
const open = async (c: Ctx) => { trigger(c).focus(); await c.user.keyboard('{Enter}'); };
const expanded = (c: Ctx) => trigger(c).getAttribute('aria-expanded');

export const kit: Kit = {
  name: 'Select',
  render: (props) => <Select label="Country" options={OPTIONS} placeholder="Choose a country" {...props} />,
  states: {
    default: { check: (c) => { assert.match(trigger(c).textContent ?? '', /Choose a country/); assert.equal(expanded(c), 'false'); } },
    value: { props: { defaultValue: 'in' }, check: (c) => assert.match(trigger(c).textContent ?? '', /India/) },
    open: { act: open, check: (c) => { assert.equal(expanded(c), 'true'); assert.equal(c.screen.getAllByRole('option').length, 3); } },
    disabled: { props: { disabled: true }, check: (c) => assert.equal((trigger(c) as HTMLButtonElement).disabled, true) },
    required: { props: { required: true }, check: (c) => assert.equal(trigger(c).getAttribute('aria-required'), 'true') },
    invalid: { props: { error: 'Choose where we ship to.' }, check: (c) => { assert.equal(trigger(c).getAttribute('aria-invalid'), 'true'); assert.equal(c.screen.getByRole('alert').textContent, 'Choose where we ship to.'); } },
    readOnly: { props: (spy) => ({ readOnly: true, defaultValue: 'in', onOpenChange: spy }), act: open, check: (c) => { assert.equal(trigger(c).getAttribute('aria-readonly'), 'true'); assert.equal(expanded(c), 'false'); assert.equal(c.spy.mock.callCount(), 0); } },
    loading: { props: { loading: true }, check: (c) => { assert.equal(trigger(c).getAttribute('aria-busy'), 'true'); assert.equal(c.screen.getByRole('status').textContent, 'Loading'); } },
  },
  events: {
    change: { act: async (c) => { await open(c); await c.user.click(c.screen.getByRole('option', { name: 'India' })); }, expect: (calls) => assert.deepEqual(calls[0], ['in']) },
    openChange: { act: open, expect: (calls) => assert.deepEqual(calls[0], [true]) },
  },
  keys: {
    Enter: { props: (spy) => ({ onValueChange: spy }), act: async (c) => { await open(c); await c.user.keyboard('{ArrowDown}{Enter}'); }, check: (c) => { assert.equal(c.spy.mock.callCount(), 1); assert.equal(expanded(c), 'false'); } },
    Space: { act: async (c) => { trigger(c).focus(); await c.user.keyboard(' '); }, check: (c) => assert.equal(expanded(c), 'true') },
    ArrowDown: { act: async (c) => { trigger(c).focus(); await c.user.keyboard('{ArrowDown}'); }, check: (c) => assert.equal(expanded(c), 'true') },
    ArrowUp: { props: { defaultValue: 'us' }, act: async (c) => { await open(c); await c.user.keyboard('{ArrowUp}'); }, check: (c) => assert.equal(document.activeElement?.textContent?.replace('✓', ''), 'India') },
    Escape: { props: (spy) => ({ onValueChange: spy }), act: async (c) => { await open(c); await c.user.keyboard('{Escape}'); }, check: (c) => { assert.equal(expanded(c), 'false'); assert.equal(c.spy.mock.callCount(), 0); } },
  },
};
