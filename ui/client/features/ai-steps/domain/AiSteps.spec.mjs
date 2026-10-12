import test from 'node:test';
import assert from 'node:assert/strict';
import { readAiProfiles } from '../../../../../packages/core/ai-profiles.mjs';
import { aiStepRows } from './AiStepRows.ts';
import { howItWorks, modelText } from './AiStepText.ts';
import { aiStepsView } from './AiStepsView.ts';
import { memoryRows } from './MemoryRows.ts';

const profiles = () => readAiProfiles({ traceConfig: null, status: () => ({ ok: true, packages: [{ name: '@mx/reason', ok: true, message: 'ok' }] }) });

test('aiStepRows: the real profile set, Cockpit first, then Trace, then Construct, every row in plain English', () => {
  const rows = aiStepRows(profiles());
  assert.deepEqual([...new Set(rows.map((r) => r.app))], ['Cockpit', 'Trace', 'Construct']);
  for (const row of rows) {
    assert.match(row.label, /^[A-Z].*\.$/);
    assert.match(row.how, /^[A-Z].*\.$/);
    assert.match(row.details.step, /^Step id: /);
  }
});

test("modelText and howItWorks: the 1.5B is Line's default; hosted and jev steps say what happens", () => {
  const all = profiles().profiles;
  const choose = all.find((p) => p.step === 'trace.choose');
  assert.equal(modelText(choose), "qwen2.5-coder:1.5b (Line's default)");
  assert.match(howItWorks(choose), /jev decides/);
  const plan = all.find((p) => p.step === 'cockpit.planAnalysis');
  assert.equal(modelText(plan), 'The hosted model you choose');
  assert.match(howItWorks(plan), /hosted model/);
});

test('aiStepsView: loading, a refusal sentence, and the ready rows each give one status sentence', () => {
  assert.deepEqual(aiStepsView({ phase: 'loading' }), { status: 'Reading the AI steps.', rows: [] });
  assert.deepEqual(aiStepsView({ phase: 'error', sentence: 'No.' }), { status: 'No.', rows: [] });
  const p = profiles();
  const v = aiStepsView({ phase: 'ready', profiles: p, rows: aiStepRows(p) });
  assert.equal(v.status, p.reason.sentence);
  assert.equal(v.rows.length, p.profiles.length);
});

test('memoryRows (im3 + j5): each memory step with its size in words; Forget only where there is something to forget', () => {
  assert.deepEqual(memoryRows(null), []);
  const rows = memoryRows({ ok: true, total: 4, sentence: 's', steps: [{ step: 'drafter.route', label: 'Which drafted route you pick', size: 3 }, { step: 'plan.step', label: 'What happens', size: 1 }, { step: 'plan.fix', label: 'Which fix', size: 0 }] });
  assert.deepEqual(rows.map((r) => [r.sizeText, r.canForget]), [['3 remembered decisions', true], ['1 remembered decision', true], ['0 remembered decisions', false]]);
});
