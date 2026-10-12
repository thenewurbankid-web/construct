import assert from 'node:assert/strict';
import { Checkbox } from '../../library/components/Checkbox';
import type { Ctx, Kit } from '../kit/harness';

const box = (c: Ctx) => c.screen.getByRole('checkbox', { name: 'Accept terms' });

export const kit: Kit = {
  name: 'Checkbox',
  render: (props) => <Checkbox label="Accept terms" {...props} />,
  states: {
    default: { check: (c) => assert.equal(box(c).getAttribute('aria-checked'), 'false') },
    checked: { props: { defaultChecked: true }, check: (c) => assert.equal(box(c).getAttribute('aria-checked'), 'true') },
    indeterminate: { props: { indeterminate: true }, check: (c) => assert.equal(box(c).getAttribute('aria-checked'), 'mixed') },
    disabled: { props: { disabled: true }, check: (c) => assert.equal((box(c) as HTMLButtonElement).disabled, true) },
    required: { props: { required: true }, check: (c) => assert.equal(box(c).getAttribute('aria-required'), 'true') },
    invalid: { props: { error: 'You must accept the terms.' }, check: (c) => { assert.equal(box(c).getAttribute('aria-invalid'), 'true'); assert.equal(c.screen.getByRole('alert').textContent, 'You must accept the terms.'); } },
    readOnly: { props: (spy) => ({ readOnly: true, defaultChecked: true, onCheckedChange: spy }), act: (c) => c.user.click(box(c)), check: (c) => { assert.equal(box(c).getAttribute('aria-readonly'), 'true'); assert.equal(box(c).getAttribute('aria-checked'), 'true'); assert.equal(c.spy.mock.callCount(), 0); } },
    value: { props: { value: 'terms-v2', name: 'consent' }, check: (c) => assert.equal(box(c).getAttribute('value'), 'terms-v2') },
  },
  events: {
    change: { act: (c) => c.user.click(box(c)), expect: (calls) => assert.deepEqual(calls[0], [true]) },
  },
  keys: {
    Space: { act: async (c) => { box(c).focus(); await c.user.keyboard(' '); }, check: (c) => assert.equal(box(c).getAttribute('aria-checked'), 'true') },
  },
};
