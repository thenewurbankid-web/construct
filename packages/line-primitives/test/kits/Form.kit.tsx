import assert from 'node:assert/strict';
import { Form } from '../../library/components/Form';
import { TextField } from '../../library/components/TextField';
import type { Ctx, Kit } from '../kit/harness';

const form = (c: Ctx) => c.screen.getByRole('form', { name: 'Sign up' });
const email = (c: Ctx) => c.screen.getByRole('textbox', { name: /Email/ });

export const kit: Kit = {
  name: 'Form',
  render: (props) => <Form label="Sign up" submitLabel="Create account" {...props}><TextField label="Email" name="email" /></Form>,
  states: {
    default: { check: (c) => { assert.ok(form(c)); assert.equal((c.screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled, false); } },
    loading: { props: { submitting: true }, check: (c) => { assert.equal(form(c).getAttribute('aria-busy'), 'true'); assert.equal((c.screen.getByRole('group', { name: /Email/ }).closest('fieldset') as HTMLFieldSetElement).disabled, true); } },
    invalid: { props: { error: 'That email is already registered.' }, check: (c) => assert.equal(c.screen.getByRole('alert').textContent, 'That email is already registered.') },
  },
  events: {
    submit: { act: async (c) => { await c.user.type(email(c), 'ada@example.com'); await c.user.click(c.screen.getByRole('button', { name: 'Create account' })); }, expect: (calls) => assert.deepEqual(calls[0], [{ email: 'ada@example.com' }]) },
    reset: { props: { resetLabel: 'Clear' }, act: (c) => c.user.click(c.screen.getByRole('button', { name: 'Clear' })) },
  },
  keys: {
    Enter: { props: (spy) => ({ onSubmit: spy }), act: async (c) => { await c.user.type(email(c), 'a@b.co{Enter}'); }, check: (c) => assert.deepEqual(c.spy.mock.calls[0]?.arguments, [{ email: 'a@b.co' }]) },
  },
};
