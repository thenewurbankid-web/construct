// T7 -- the preview's pure parts: the server's RenderResult as what the panel shows, prop fields to values, rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { componentName } from './RenderName.ts';
import { inputFor, propValueFromInput, propsQuery } from './PropInput.ts';
import { propRows, valueText } from './PropRows.ts';
import { stateFromResult, stateProps } from './RenderState.ts';

const label = { name: 'label', type: 'string', kind: 'string', value: 'Label' };
const count = { name: 'count', type: 'number', kind: 'number', value: 1 };
const open = { name: 'open', type: 'boolean', kind: 'boolean', value: false };
const onClick = { name: 'onClick', type: '() => void', kind: 'other', value: null };

test('a rendered result is shown with its props; no renderer keeps the props and the reason; a refusal has none', () => {
  assert.deepEqual(stateFromResult({ ok: true, html: '<p>x</p>', props: [label], via: 'morpheus' }), { phase: 'shown', html: '<p>x</p>', props: [label] });
  const none = stateFromResult({ ok: false, code: 'NO_RENDERER', sentence: 'There is no picture of Button.', detail: 'link down', props: [label] });
  assert.deepEqual(none, { phase: 'no-picture', sentence: 'There is no picture of Button.', detail: 'link down', props: [label] });
  assert.deepEqual(stateProps(none), [label]);
  const refused = stateFromResult({ ok: false, code: 'OUTSIDE_LIBRARY', sentence: 'Only components in library/components/ can be previewed here.' });
  assert.equal(refused.phase, 'refused');
  assert.deepEqual(stateProps(refused), []);
  assert.equal(stateFromResult(null).phase, 'refused', 'an unreachable server is a sentence too');
  assert.equal(stateFromResult({}).phase, 'refused');
});

test('fields to values: text as is, a number only when it is one, a tick box as yes or no, nothing for other types', () => {
  assert.equal(propValueFromInput('string', 'Buy now'), 'Buy now');
  assert.equal(propValueFromInput('number', '3'), 3);
  assert.equal(propValueFromInput('number', 'three'), null);
  assert.equal(propValueFromInput('number', ''), null);
  assert.equal(propValueFromInput('boolean', true), true);
  assert.equal(propValueFromInput('other', 'x'), null);
  assert.equal(propsQuery({}), undefined);
  assert.equal(propsQuery({ label: 'Buy now' }), '{"label":"Buy now"}');
});

test('rows show the typed input once there is one, else the value used; the name comes from the file', () => {
  assert.equal(componentName('library/components/Button.tsx'), 'Button');
  assert.deepEqual([label, count, open, onClick].map(inputFor), ['Label', '1', false, '']);
  assert.deepEqual([label, count, open, onClick].map(valueText), ['"Label"', '1', 'no', 'no sample value']);
  const rows = propRows([label, count], { count: '7x' });
  assert.deepEqual(rows.map((r) => r.input), ['Label', '7x']);
});
