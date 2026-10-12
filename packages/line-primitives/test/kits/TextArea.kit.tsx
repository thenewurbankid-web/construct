import assert from 'node:assert/strict';
import { TextArea } from '../../library/components/TextArea';
import type { Ctx, Kit } from '../kit/harness';

const area = (c: Ctx) => c.screen.getByRole('textbox', { name: /Notes/ }) as HTMLTextAreaElement;

export const kit: Kit = {
  name: 'TextArea',
  render: (props) => <TextArea label="Notes" {...props} />,
  states: {
    default: { check: (c) => assert.equal(area(c).value, '') },
    value: { props: { defaultValue: 'Leave at the door', maxLength: 40 }, check: (c) => { assert.equal(area(c).value, 'Leave at the door'); assert.match(c.container.textContent ?? '', /17 \/ 40/); } },
    disabled: { props: { disabled: true }, check: (c) => assert.equal(area(c).disabled, true) },
    readOnly: { props: { readOnly: true }, check: (c) => assert.equal(area(c).readOnly, true) },
    required: { props: { required: true }, check: (c) => assert.equal(area(c).required, true) },
    invalid: { props: { error: 'Too long.' }, check: (c) => { assert.equal(area(c).getAttribute('aria-invalid'), 'true'); assert.equal(c.screen.getByRole('alert').textContent, 'Too long.'); } },
    described: { props: { description: 'Shown to the courier.' }, check: (c) => assert.equal(document.getElementById(area(c).getAttribute('aria-describedby') ?? '')?.textContent, 'Shown to the courier.') },
    loading: { props: { loading: true }, check: (c) => { assert.equal(c.screen.getByRole('status').textContent, 'Loading'); assert.equal(document.querySelector('[aria-busy="true"]') !== null, true); } },
  },
  events: {
    change: { act: (c) => c.user.type(area(c), 'x'), expect: (calls) => assert.deepEqual(calls.at(-1), ['x']) },
    focus: { act: (c) => c.user.click(area(c)) },
    blur: { act: async (c) => { await c.user.click(area(c)); await c.user.tab(); } },
  },
  keys: {
    Tab: { act: (c) => c.user.tab(), check: (c) => assert.equal(document.activeElement, area(c)) },
    Type: { act: (c) => c.user.type(area(c), 'a{Enter}b'), check: (c) => assert.equal(area(c).value, 'a\nb') },
  },
};
