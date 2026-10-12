import assert from 'node:assert/strict';
import { Field } from '../../library/components/Field';
import type { Ctx, Kit } from '../kit/harness';

const input = (c: Ctx) => c.screen.getByRole('spinbutton', { name: /Quantity/ }) as HTMLInputElement;

export const kit: Kit = {
  name: 'Field',
  render: (props) => <Field label="Quantity" {...props}>{(control) => <input type="number" {...control} />}</Field>,
  states: {
    default: { check: (c) => { assert.ok(input(c)); assert.ok(c.screen.getByRole('group', { name: /Quantity/ })); } },
    described: { props: { description: 'Up to 10 per order.' }, check: (c) => assert.equal(document.getElementById(input(c).getAttribute('aria-describedby') ?? '')?.textContent, 'Up to 10 per order.') },
    invalid: { props: { error: 'Enter 1 to 10.', description: 'Up to 10.' }, check: (c) => { assert.equal(input(c).getAttribute('aria-invalid'), 'true'); const ids = (input(c).getAttribute('aria-describedby') ?? '').split(' '); assert.equal(ids.length, 2); assert.equal(c.screen.getByRole('alert').id, ids[1]); } },
    required: { props: { required: true }, check: (c) => assert.equal(input(c).required, true) },
    disabled: { props: { disabled: true }, check: (c) => assert.equal(input(c).disabled, true) },
    readOnly: { props: { readOnly: true }, check: (c) => assert.equal(input(c).readOnly, true) },
    loading: { props: { loading: true }, check: (c) => { assert.equal(c.screen.getByRole('status').textContent, 'Loading'); assert.equal(input(c).getAttribute('aria-busy'), 'true'); } },
  },
  events: {},
  keys: {},
};
