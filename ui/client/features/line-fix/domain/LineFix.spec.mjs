// ca2 screen: the fix panel's states, from the pure parts it renders from (the panel itself only lays these out).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLabel, canApply, fixOptions, fixResult } from './FixOptions.ts';
import { applyFixReducer, idleFix, refusalOf } from '../workflows/ApplyFix.ts';

const setBase = { id: 'LINE-BASE/set-base:components/Card', sentence: 'Base InvoiceCard.tsx on the library component Card, which it already uses.', rank: 1, step: { tool: 'line.setBase', args: { file: 'f', libraryId: 'components/Card' } } };
const promote = { id: 'LINE-BASE/promote', sentence: 'Move InvoiceCard.tsx into the library.', rank: 2, step: { tool: 'line.promote', args: { featureItemId: 'billing/components/InvoiceCard' } } };
const advice = { id: 'LINE-WRITER/use-writer', sentence: 'Send the writeFileSync() call in a.ts through Construct\'s writer.', rank: 1, step: null };

test('recommended first, the rest as other ways; no fixes means nothing to show', () => {
  assert.deepEqual(fixOptions({ fixes: [promote, setBase] }), { recommended: setBase, others: [promote] }, 'sorted by rank whatever the order');
  assert.deepEqual(fixOptions({ fixes: [setBase] }), { recommended: setBase, others: [] }, 'one fix: no "Other ways to fix"');
  assert.deepEqual(fixOptions({}), { recommended: null, others: [] }, 'a finding with no fixes (not LINE-*) shows no panel');
  assert.deepEqual(fixOptions({ fixes: [] }), { recommended: null, others: [] });
});

test('a fix with a step gets Apply (named by what it does); advice only gets no button', () => {
  assert.equal(canApply(setBase), true);
  assert.equal(canApply(advice), false);
  assert.equal(applyLabel(setBase), 'Apply: Base InvoiceCard.tsx on the library component Card, which it already uses.');
});

test('every answer says "Saved." or "Nothing was saved: ..."', () => {
  const saved = fixResult({ ok: true, sentence: 'Saved. Bases InvoiceCard on Card.', files: ['features/billing/components/InvoiceCard.tsx'], findings: [] });
  assert.equal(saved.ok, true);
  assert.match(saved.sentence, /^Saved\./);
  assert.deepEqual(saved.files, ['features/billing/components/InvoiceCard.tsx']);
  const blocked = fixResult({ ok: false, sentence: 'Nothing was saved: the change adds a problem.', files: [], findings: [{ rule: 'LINE-DIR' }] });
  assert.equal(blocked.sentence, 'Nothing was saved: the change adds a problem.');
  assert.equal(blocked.findings.length, 1);
  assert.equal(fixResult({ ok: false, sentence: 'That fix no longer applies to this problem.', code: 'UNKNOWN_FIX' }).sentence, 'Nothing was saved: that fix no longer applies to this problem.');
  assert.match(fixResult(null).sentence, /^Nothing was saved: /, 'an unreadable answer is a refusal sentence too');
});

test('idle -> applying -> done; a second Apply while applying is ignored; only a refusal stays in the panel', () => {
  const applying = applyFixReducer(idleFix, { type: 'APPLY', fixId: setBase.id });
  assert.deepEqual(applying, { phase: 'applying', fixId: setBase.id });
  assert.equal(applyFixReducer(applying, { type: 'APPLY', fixId: promote.id }), applying, 'double click sends one request');
  const landed = applyFixReducer(applying, { type: 'DONE', result: fixResult({ ok: true, sentence: 'Saved. x' }) });
  assert.equal(landed.phase, 'done');
  assert.equal(refusalOf(landed), null, 'a landed fix is the screen notice, not the panel');
  const refused = applyFixReducer(applying, { type: 'DONE', result: fixResult({ ok: false, sentence: 'Nothing was saved: no.' }) });
  assert.equal(refusalOf(refused), 'Nothing was saved: no.');
  assert.equal(applyFixReducer(idleFix, { type: 'DONE', result: fixResult({ ok: true }) }), idleFix, 'a stray answer changes nothing');
  assert.equal(refusalOf(idleFix), null);
});
