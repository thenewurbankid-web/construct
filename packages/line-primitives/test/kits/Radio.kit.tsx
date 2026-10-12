import assert from 'node:assert/strict';
import { waitFor } from '@testing-library/react';
import { Radio } from '../../library/components/Radio';
import type { Ctx, Kit } from '../kit/harness';

const OPTIONS = [{ value: 'standard', label: 'Standard' }, { value: 'express', label: 'Express' }, { value: 'pickup', label: 'Pick up' }];
const group = (c: Ctx) => c.screen.getByRole('radiogroup', { name: 'Delivery' });
const radio = (c: Ctx, name: string) => c.screen.getByRole('radio', { name });
// Radix moves focus a tick after the key goes down and checks the option only while an arrow is held, as a person's
// key press does: hold the key, wait for the move, then let go.
const arrow = async (c: Ctx, from: string, key: string, to: string) => {
  radio(c, from).focus();
  await c.user.keyboard(`{${key}>}`);
  await waitFor(() => assert.equal(radio(c, to).getAttribute('aria-checked'), 'true'));
  await c.user.keyboard(`{/${key}}`);
};

export const kit: Kit = {
  name: 'Radio',
  render: (props) => <Radio label="Delivery" options={OPTIONS} {...props} />,
  states: {
    default: { check: (c) => { assert.ok(group(c)); assert.equal(c.screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true').length, 0); } },
    value: { props: { defaultValue: 'express' }, check: (c) => assert.equal(radio(c, 'Express').getAttribute('aria-checked'), 'true') },
    disabled: { props: { disabled: true }, check: (c) => assert.ok(c.screen.getAllByRole('radio').every((r) => (r as HTMLButtonElement).disabled)) },
    required: { props: { required: true }, check: (c) => assert.equal(group(c).getAttribute('aria-required'), 'true') },
    invalid: { props: { error: 'Choose a delivery option.' }, check: (c) => { assert.equal(group(c).getAttribute('aria-invalid'), 'true'); assert.equal(c.screen.getByRole('alert').textContent, 'Choose a delivery option.'); } },
    orientation: { props: { orientation: 'horizontal' }, check: (c) => assert.equal(group(c).getAttribute('aria-orientation'), 'horizontal') },
    readOnly: { props: (spy) => ({ readOnly: true, defaultValue: 'standard', onValueChange: spy }), act: (c) => c.user.click(radio(c, 'Express')), check: (c) => { assert.equal(group(c).getAttribute('aria-readonly'), 'true'); assert.equal(radio(c, 'Standard').getAttribute('aria-checked'), 'true'); assert.equal(c.spy.mock.callCount(), 0); } },
  },
  events: {
    change: { act: (c) => c.user.click(radio(c, 'Pick up')), expect: (calls) => assert.deepEqual(calls[0], ['pickup']) },
  },
  keys: {
    ArrowDown: { props: { defaultValue: 'standard' }, act: (c) => arrow(c, 'Standard', 'ArrowDown', 'Express'), check: (c) => assert.equal(radio(c, 'Express').getAttribute('aria-checked'), 'true') },
    ArrowUp: { props: { defaultValue: 'express' }, act: (c) => arrow(c, 'Express', 'ArrowUp', 'Standard'), check: (c) => assert.equal(radio(c, 'Standard').getAttribute('aria-checked'), 'true') },
    Space: { act: async (c) => { radio(c, 'Express').focus(); await c.user.keyboard(' '); }, check: (c) => assert.equal(radio(c, 'Express').getAttribute('aria-checked'), 'true') },
    Tab: { props: { defaultValue: 'pickup' }, act: (c) => c.user.tab(), check: (c) => assert.equal(document.activeElement, radio(c, 'Pick up')) },
  },
};
