import test from 'node:test';
import assert from 'node:assert/strict';
import { promoteText, suggestName, toApplyResult } from './ChangeText.ts';
import { idleChange, lineChangeReducer } from '../workflows/LineChange.ts';
import { createMockLineApi } from '../services/LineApi.mock.ts';

const run = (events, from = idleChange) => events.reduce(lineChangeReducer, from);
const ok = { ok: true, sentence: 'Saved.', files: ['a'], findings: [] };
const refused = { ok: false, sentence: 'Feature "orders" already has OrderButton; pick another name.', files: [], findings: [] };

test('base on: open with a suggested name, edit, submit; a refusal reopens the form with the sentence, a landing closes it', () => {
  const open = run([{ type: 'OPEN_BASE_ON', libraryId: 'components/Button', libraryName: 'Button', feature: 'orders', name: 'OrdersButton' }]);
  assert.deepEqual(open, { status: 'base-on', libraryId: 'components/Button', libraryName: 'Button', feature: 'orders', name: 'OrdersButton', error: null });
  const edited = run([{ type: 'SET_FEATURE', feature: 'billing', name: 'BillingButton' }, { type: 'SET_NAME', name: 'PayButton' }], open);
  assert.equal(edited.name, 'PayButton');
  const saving = run([{ type: 'SUBMIT' }], edited);
  assert.equal(saving.status, 'base-on-saving');
  assert.deepEqual(run([{ type: 'OPEN_PROMOTE', featureItemId: 'x', name: 'X' }, { type: 'CANCEL' }], saving), saving, 'nothing else starts or cancels while saving');
  const back = run([{ type: 'DONE', result: refused }], saving);
  assert.deepEqual([back.status, back.error, back.name], ['base-on', refused.sentence, 'PayButton']);
  assert.equal(run([{ type: 'SET_NAME', name: 'Other' }], back).error, null, 'editing clears the refusal');
  assert.deepEqual(run([{ type: 'SUBMIT' }, { type: 'DONE', result: ok }], back), idleChange);
});

test('promote: open (confirm), cancel, or submit; a refusal keeps the confirm open with the sentence', () => {
  const open = run([{ type: 'OPEN_PROMOTE', featureItemId: 'orders/components/OrderButton', name: 'OrderButton' }]);
  assert.deepEqual(open, { status: 'promote', featureItemId: 'orders/components/OrderButton', name: 'OrderButton', error: null });
  assert.deepEqual(run([{ type: 'CANCEL' }], open), idleChange);
  const back = run([{ type: 'SUBMIT' }, { type: 'DONE', result: refused }], open);
  assert.deepEqual([back.status, back.error], ['promote', refused.sentence]);
  assert.deepEqual(run([{ type: 'SUBMIT' }, { type: 'DONE', result: ok }], open), idleChange);
  assert.deepEqual(run([{ type: 'SUBMIT' }, { type: 'SET_NAME', name: 'x' }]), idleChange, 'events that do not apply change nothing');
});

test('words: suggested names, the promote sentence, and any answer as an ApplyResult', () => {
  assert.equal(suggestName('orders', 'Button'), 'OrdersButton');
  assert.equal(suggestName('order-history', 'Card'), 'OrderHistoryCard');
  assert.equal(promoteText('OrderButton', 'library'), 'This moves OrderButton into library/ and points every file that uses it at the library copy.');
  assert.deepEqual(toApplyResult({ ok: false, sentence: 'No.', code: 'X' }), { ok: false, sentence: 'No.', files: [], findings: [] });
  assert.deepEqual(toApplyResult(null), { ok: false, sentence: 'Cockpit could not do that; nothing was changed.', files: [], findings: [] });
  assert.deepEqual(toApplyResult(ok), ok);
});

test('mock API: base on raises the library card\'s count; a taken name is one sentence; promote clears the cross-feature finding', async () => {
  const api = createMockLineApi();
  const count = async (id) => (await api.getLineProject()).project.library.find((l) => l.id === id).usedBy.length;
  assert.equal(await count('components/TextField'), 0);
  const landed = await api.baseOn({ libraryId: 'components/TextField', feature: 'billing', name: 'AmountField' });
  assert.equal(landed.ok, true);
  assert.match(landed.sentence, /^Saved\. Creates AmountField in feature billing/);
  assert.equal(await count('components/TextField'), 1);
  const taken = await api.baseOn({ libraryId: 'components/Button', feature: 'orders', name: 'OrderButton' });
  assert.deepEqual([taken.ok, taken.files], [false, []]);
  assert.match(taken.sentence, /already has OrderButton/);
  assert.equal((await api.getLineProject()).project.findings.some((f) => f.rule === 'LINE-DIR'), true);
  const promoted = await api.promote({ featureItemId: 'orders/components/OrderButton' });
  assert.equal(promoted.ok, true, promoted.sentence);
  assert.equal((await api.getLineProject()).project.findings.some((f) => f.rule === 'LINE-DIR'), false);
});
