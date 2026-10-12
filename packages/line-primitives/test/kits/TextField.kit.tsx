import assert from 'node:assert/strict';
import { TextField } from '../../library/components/TextField';
import type { Ctx, Kit } from '../kit/harness';

const input = (c: Ctx) => c.screen.getByRole('textbox', { name: /Email/ }) as HTMLInputElement;

export const kit: Kit = {
  name: 'TextField',
  render: (props) => <TextField label="Email" {...props} />,
  states: {
    default: { check: (c) => { assert.equal(input(c).value, ''); assert.equal(input(c).getAttribute('aria-invalid'), null); } },
    value: { props: { defaultValue: 'ada@example.com' }, check: (c) => assert.equal(input(c).value, 'ada@example.com') },
    disabled: { props: { disabled: true }, check: (c) => assert.equal(input(c).disabled, true) },
    readOnly: { props: { readOnly: true, defaultValue: 'x' }, check: (c) => assert.equal(input(c).readOnly, true) },
    required: { props: { required: true }, check: (c) => assert.equal(input(c).required, true) },
    invalid: { props: { error: 'Enter an email address.' }, check: (c) => { assert.equal(input(c).getAttribute('aria-invalid'), 'true'); assert.equal(c.screen.getByRole('alert').textContent, 'Enter an email address.'); assert.ok(input(c).getAttribute('aria-describedby')?.includes(c.screen.getByRole('alert').id)); } },
    described: { props: { description: 'We never share it.' }, check: (c) => { const id = input(c).getAttribute('aria-describedby') ?? ''; assert.equal(document.getElementById(id)?.textContent, 'We never share it.'); } },
  },
  events: {
    change: { act: (c) => c.user.type(input(c), 'a'), expect: (calls) => assert.deepEqual(calls.at(-1), ['a']) },
    focus: { act: (c) => c.user.click(input(c)) },
    blur: { act: async (c) => { await c.user.click(input(c)); await c.user.tab(); } },
  },
  keys: {
    Tab: { act: (c) => c.user.tab(), check: (c) => assert.equal(document.activeElement, input(c)) },
    Type: { props: (spy) => ({ onValueChange: spy }), act: (c) => c.user.type(input(c), 'hi'), check: (c) => { assert.equal(input(c).value, 'hi'); assert.equal(c.spy.mock.callCount(), 2); } },
  },
};
