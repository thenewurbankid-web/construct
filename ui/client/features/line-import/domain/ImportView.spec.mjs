import test from 'node:test';
import assert from 'node:assert/strict';
import { foundGroups, orderedOptions, pickedOption } from './ImportGroups.ts';
import { scanSummary } from './ImportText.ts';
import { isRefusal } from './ImportRefusal.ts';
import { importView } from './ImportView.ts';
import { importReducer, initialImport } from '../workflows/ImportFlow.ts';
import { createMockImport } from '../../../../../packages/engine/line/mockImport.mjs';

const mock = createMockImport();
const scan = mock.scan({ folder: 'src/alerts' });
const q = scan.questions[0];

test('the scan reads as groups (library first, then each feature) and one summary sentence', () => {
  assert.deepEqual(foundGroups(scan).map((g) => g.title), ['To the library', 'To feature alerts']);
  assert.equal(scanSummary(scan), 'Line found 6 items in src/alerts; it needs your answer to one question.');
  const view = importView({ phase: 'scanned', folders: null, folder: 'src/alerts', scan, answers: {}, plan: null, result: null, error: null });
  assert.equal(view.groups[0].rows[0].details[0], 'src/alerts/fixtures/alerts.json', 'file paths only under Details');
  assert.deepEqual(view.questions[0].options.map((o) => [o.id, o.recommended, o.picked]), [['library', true, true], ['feature:alerts', false, false]]);
});

test('a question shows the recommended option first and counts as picked until answered', () => {
  const flipped = { ...q, options: [...q.options].reverse() };
  assert.equal(orderedOptions(flipped)[0].id, q.recommended);
  assert.equal(pickedOption(q, {}), 'library');
  assert.equal(pickedOption(q, { [q.id]: 'feature:alerts' }), 'feature:alerts');
});

test('the flow: scan -> answer -> plan -> apply; an answer drops the old plan; a refusal returns with its sentence', () => {
  let s = importReducer(initialImport, { type: 'SET_FOLDER', folder: 'src/alerts' });
  s = importReducer(s, { type: 'SCAN' });
  assert.equal(s.phase, 'scanning');
  s = importReducer(s, { type: 'SCANNED', scan });
  s = importReducer(s, { type: 'PLAN' });
  s = importReducer(s, { type: 'PLANNED', plan: mock.plan({ folder: 'src/alerts', answers: {} }) });
  assert.equal(s.phase, 'planned');
  s = importReducer(s, { type: 'ANSWER', questionId: q.id, optionId: 'feature:alerts' });
  assert.equal(s.phase, 'scanned');
  assert.equal(s.plan, null);
  s = importReducer(importReducer(s, { type: 'PLAN' }), { type: 'PLANNED', plan: mock.plan({ folder: 'src/alerts', answers: s.answers }) });
  s = importReducer(s, { type: 'APPLY' });
  s = importReducer(s, { type: 'APPLIED', result: mock.apply({ folder: 'src/alerts', answers: s.answers }) });
  assert.equal(s.phase, 'applied');
  const r = importReducer(importReducer(importReducer(initialImport, { type: 'SET_FOLDER', folder: 'x' }), { type: 'SCAN' }), { type: 'REFUSED', sentence: 'No.' });
  assert.deepEqual([r.phase, r.error], ['pick', 'No.']);
  assert.ok(isRefusal({ ok: false, sentence: 'No.', code: 'X' }));
  assert.ok(!isRefusal({ ok: false, sentence: 'Stopped.', steps: [] }), 'a refused apply is an answer, not a refusal');
});

test('a late refusal waits for Undo or Leave; Undo ends with the folder back and no error', () => {
  const planned = { ...initialImport, phase: 'planned', folder: 'src/opp', plan: mock.plan({ folder: 'src/alerts', answers: {} }) };
  const refused = { ok: false, sentence: 'Stopped at "x": no.', files: [], findings: [], steps: [], pending: { planStepId: 'p3', rest: [], landed: 2 } };
  let s = importReducer(importReducer(planned, { type: 'APPLY' }), { type: 'APPLIED', result: refused });
  assert.deepEqual([s.phase, s.error], ['planned', 'Stopped at "x": no.']);
  assert.equal(importReducer(planned, { type: 'UNDO' }), planned, 'nothing to undo without a pending refusal');
  s = importReducer(s, { type: 'UNDO' });
  assert.equal(s.phase, 'applying');
  s = importReducer(s, { type: 'APPLIED', result: { ok: false, undone: true, sentence: 'Undone: src/opp is back.', files: [], findings: [], steps: [] } });
  assert.deepEqual([s.phase, s.error, s.result.undone], ['planned', null, true]);
});
