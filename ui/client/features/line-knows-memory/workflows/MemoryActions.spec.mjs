// "What Line knows", Memory tab: each person's action against the page's http, answered as {view, message}.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockKnows } from '../../../../../packages/engine/line/knows/mock.mjs';
import { loadMemoryTab, runMemoryAction } from './MemoryActions.ts';

/** The page's http over the contract's mock (the same shapes the server answers). */
function mockHttp() {
  const m = createMockKnows();
  const later = (v) => Promise.resolve(v);
  return {
    m,
    http: {
      memoryRecords: (step) => later(m.records(step ? { step } : {})),
      memoryEdit: (id, chosen) => later(m.edit({ id, chosen })),
      memoryForgetStep: (step) => { m.forgetStep({ step }); return later(m.memory()); },
      memoryForgetRecord: (id) => later(m.forgetRecord({ id })),
      memoryForgetAll: () => later(m.forgetAll()),
      memoryExport: () => later(m.exportMemory()),
      memoryImport: (file) => later(m.importMemory(file)),
      memoryEmbeddings: (on) => later(m.setEmbeddings({ on })),
    },
  };
}

test('load: the records view, or the refusal sentence when it cannot be read', async () => {
  const { http } = mockHttp();
  const a = await loadMemoryTab(http);
  assert.equal(a.view?.records.length, 6);
  const down = await loadMemoryTab({ ...http, memoryRecords: () => Promise.reject(new Error('x')) });
  assert.equal(down.view, null);
  assert.match(down.sentence, /could not be read/);
  const refused = await loadMemoryTab({ ...http, memoryRecords: () => Promise.resolve({ ok: false, code: 'NO_PROJECT', sentence: 'No project is open.' }) });
  assert.equal(refused.sentence, 'No project is open.');
});

test('forget one, edit, forget a step, forget all, embeddings: each answers the new view and what was done', async () => {
  const { http, m } = mockHttp();
  let a = await loadMemoryTab(http);
  a = await runMemoryAction(http, { kind: 'forgetRecord', id: 'm-mock0002' }, a);
  assert.ok(!a.view?.records.some((r) => r.id === 'm-mock0002'));
  assert.equal(a.message, 'Line forgot that decision.');
  a = await runMemoryAction(http, { kind: 'edit', id: 'm-mock0001', chosen: 'base-on:ui:L>F' }, a);
  assert.equal(a.view?.records.find((r) => r.id === 'm-mock0001')?.chosen, 'base-on:ui:L>F');
  assert.equal(a.message, "Saved: Line now remembers 'a new item based on the library' for that decision.");
  a = await runMemoryAction(http, { kind: 'forgetStep', step: 'plan.fix' }, a);
  assert.ok(!a.view?.records.some((r) => r.step === 'plan.fix'));
  assert.equal(a.message, "Line forgot everything for 'Which fix you pick for a refused step'.");
  a = await runMemoryAction(http, { kind: 'embeddings', on: true }, a);
  assert.equal(a.view?.embeddings.on, true);
  assert.match(a.message ?? '', /slotted decision text/);
  a = await runMemoryAction(http, { kind: 'forgetAll' }, a);
  assert.equal(a.view?.records.length, 0);
  assert.equal(a.message, 'Line forgot everything it remembered for this project.');
  assert.equal(m.records().records.length, 0);
});

test('export then import: the file round-trips; a bad file or a refusal keeps the view and says why', async () => {
  const { http } = mockHttp();
  let a = await loadMemoryTab(http);
  const out = await runMemoryAction(http, { kind: 'export' }, a);
  assert.ok(out.file);
  assert.match(out.file?.name ?? '', /^line-memory-\d{4}-\d{2}-\d{2}\.json$/);
  const text = out.file?.text ?? '';
  a = await runMemoryAction(http, { kind: 'forgetAll' }, a);
  a = await runMemoryAction(http, { kind: 'import', text }, a);
  assert.equal(a.view?.records.length, 6);
  assert.match(a.message ?? '', /^Imported/);
  const bad = await runMemoryAction(http, { kind: 'import', text: 'nope' }, a);
  assert.equal(bad.view, a.view);
  assert.match(bad.message ?? '', /not a Line memory file/);
  const refused = await runMemoryAction({ ...http, memoryForgetAll: () => Promise.resolve({ ok: false, code: 'NOT_COCKPIT', sentence: 'Only a person in Cockpit can do that.' }) }, { kind: 'forgetAll' }, a);
  assert.equal(refused.view, a.view);
  assert.equal(refused.message, 'Only a person in Cockpit can do that.');
  const thrown = await runMemoryAction({ ...http, memoryForgetAll: () => Promise.reject(new Error('down')) }, { kind: 'forgetAll' }, a);
  assert.equal(thrown.message, 'Line could not do that; nothing was changed.');
});
