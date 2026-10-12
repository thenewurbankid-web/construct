import test from 'node:test';
import assert from 'node:assert/strict';
import { readAiProfiles } from '../../../../../packages/core/ai-profiles.mjs';
import { aiStepRows } from './AiStepRows.ts';
import { howItWorks, modelText } from './AiStepText.ts';
import { aiStepsView } from './AiStepsView.ts';
import { memoryRows } from './MemoryRows.ts';
import { missView } from './MissView.ts';

const profiles = () => readAiProfiles({ traceConfig: null, status: () => ({ ok: true, packages: [{ name: '@mx/reason', ok: true, message: 'ok' }] }) });

test('aiStepRows: the real profile set, Cockpit first, then Trace, then Construct, every row in plain English', () => {
  const rows = aiStepRows(profiles());
  assert.deepEqual([...new Set(rows.map((r) => r.app))], ['Cockpit', 'Trace', 'Construct']);
  for (const row of rows) {
    assert.match(row.label, /^[A-Z].*\.$/);
    assert.match(row.how, /^[A-Z].*\.$/);
    assert.match(row.details.step, /^Step id: /);
  }
  // The profile is the only switch: each row shows its measured win, or off.
  const win = Object.fromEntries(rows.map((r) => [r.step, r.win]));
  assert.match(win['construct.fix'], /^Win over static: .*9\/10.*6\/10/);
  assert.match(win['construct.repair'], /^Win over static: .*7\/20/);
  for (const s of ['construct.chooser', 'construct.label-miss', 'trace.choose']) assert.equal(win[s], 'Win over static: off');
});

test("modelText and howItWorks: the 1.5B is Line's default; hosted and jev steps say what happens", () => {
  const all = profiles().profiles;
  const choose = all.find((p) => p.step === 'trace.choose');
  assert.equal(modelText(choose), "qwen2.5-coder:1.5b (Line's default)");
  assert.match(howItWorks(choose), /^Off: static checks decide/);
  const fix = all.find((p) => p.step === 'construct.fix');
  assert.match(howItWorks(fix), /the picker \(jev until Line-1 ships\)/);
  const hosted = { ...choose, provider: 'hosted', model: null };
  assert.equal(modelText(hosted), 'The hosted model you choose');
  assert.match(howItWorks(hosted), /hosted model/);
  // #871: memory embeddings are a recall step, not a decide step: no picker, off until a measured win.
  const embed = all.find((p) => p.step === 'construct.memory-embed');
  assert.equal(embed.kind, 'recall');
  assert.match(howItWorks(embed), /^Off until it measures a win: Line recalls past decisions without a model/);
  assert.doesNotMatch(howItWorks(embed), /picker/);
  assert.match(howItWorks({ ...embed, on: true }), /^A local embedding model also recalls past decisions/);
});

test('aiStepsView: loading, a refusal sentence, and the ready rows each give one status sentence', () => {
  assert.deepEqual(aiStepsView({ phase: 'loading' }), { status: 'Reading the AI steps.', rows: [], misses: null });
  assert.deepEqual(aiStepsView({ phase: 'error', sentence: 'No.' }), { status: 'No.', rows: [], misses: null });
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

test('missView (im1): the report in plain English, the steps, what Line did not offer, and the eval numbers', () => {
  const v = missView({
    ok: true, total: { misses: 1, absent: 1, picked: 0 },
    steps: [{ step: 'line.promote', absent: 1, picked: 0, total: 1, sentence: 'The line.promote step: 1 miss where the right answer was not offered, 0 where it was offered but not recommended.' }],
    topAbsent: [{ pattern: 'share <component> with <feature> -> line.promote', step: 'line.promote', count: 1, sources: ['drafter-eval'], examples: [], sentence: '1 miss: "share <component> with <feature>" needed the line.promote route, which Line did not offer.' }],
    sentence: "1 miss: 1 where the right answer was not among Line's options (a static tool is missing), 0 where it was offered but another was recommended.",
    from: 'From Train Line and the drafter eval (measured 2026-10-12).',
    numbers: { train: { n: 130, recall: 1, precision: 0.917, preferred: 1 }, drafter: { n: 55, recall: 0.927, precision: 0.958, preferred: 0.927 } },
  });
  assert.equal(v.steps.length, 1);
  assert.match(v.top[0], /did not offer\.$/);
  assert.equal(v.evals, 'Train Line held-out: 100% of the valid routes found, 100% picked the preferred one. Drafter eval: 93% route recall, 96% precision.');
});
