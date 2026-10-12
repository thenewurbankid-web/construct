import assert from 'node:assert/strict';
import { Switch } from '../../library/components/Switch';
import type { Ctx, Kit } from '../kit/harness';

const sw = (c: Ctx) => c.screen.getByRole('switch', { name: 'Email me updates' });

export const kit: Kit = {
  name: 'Switch',
  render: (props) => <Switch label="Email me updates" {...props} />,
  states: {
    default: { check: (c) => assert.equal(sw(c).getAttribute('aria-checked'), 'false') },
    checked: { props: { defaultChecked: true }, check: (c) => assert.equal(sw(c).getAttribute('aria-checked'), 'true') },
    disabled: { props: { disabled: true }, check: (c) => assert.equal((sw(c) as HTMLButtonElement).disabled, true) },
    readOnly: { props: (spy) => ({ readOnly: true, onCheckedChange: spy }), act: (c) => c.user.click(sw(c)), check: (c) => { assert.equal(sw(c).getAttribute('aria-readonly'), 'true'); assert.equal(sw(c).getAttribute('aria-checked'), 'false'); assert.equal(c.spy.mock.callCount(), 0); } },
    value: { props: { value: 'weekly', name: 'digest' }, check: (c) => assert.equal(sw(c).getAttribute('value'), 'weekly') },
    invalid: { props: { error: 'Turn this on to continue.' }, check: (c) => { assert.equal(sw(c).getAttribute('aria-invalid'), 'true'); assert.equal(c.screen.getByRole('alert').textContent, 'Turn this on to continue.'); } },
    required: { props: { required: true }, check: (c) => assert.equal(sw(c).getAttribute('aria-required'), 'true') },
  },
  events: {
    change: { act: (c) => c.user.click(sw(c)), expect: (calls) => assert.deepEqual(calls[0], [true]) },
  },
  keys: {
    Space: { act: async (c) => { sw(c).focus(); await c.user.keyboard(' '); }, check: (c) => assert.equal(sw(c).getAttribute('aria-checked'), 'true') },
    Enter: { act: async (c) => { sw(c).focus(); await c.user.keyboard('{Enter}'); }, check: (c) => assert.equal(sw(c).getAttribute('aria-checked'), 'true') },
  },
};
