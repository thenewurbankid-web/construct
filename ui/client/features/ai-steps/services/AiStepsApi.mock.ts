import type { AiProfiles, AiStepsApi, MissReportView, StepProfile } from '../types';

// A sample in the contract's shape (packages/core/ai-profiles.json holds the real set; the server reads it).
const ladder = (on: boolean): StepProfile['ladder'] => ({ static: { target: 1 }, options: { on, target: 0.8 }, measured: on ? '9/10 with typed fixes vs 6/10 static.' : null });
const SAMPLE: AiProfiles = {
  defaultModel: 'qwen2.5-coder:1.5b',
  reason: { linked: false, sentence: 'jev and the ladder are not linked, so every AI step uses its static path.' },
  profiles: [
    { step: 'cockpit.importFill', label: "Fills one imported file's gaps, shown as a diff you approve.", kind: 'draft', provider: 'ollama', model: 'qwen2.5-coder:1.5b', modelFrom: "Line's default", maxTokens: 800, fallback: 'static', ladder: ladder(false), source: 'cockpit', onRequest: true, on: false, win: 'off (runs only when you ask)' },
    { step: 'trace.choose', label: 'Picks where one part of a page gets its data from, citing a fact that settles it.', kind: 'decide', provider: 'ollama', model: 'qwen2.5-coder:1.5b', modelFrom: "Line's default", maxTokens: 120, fallback: 'static', ladder: ladder(false), source: 'trace', on: false, win: 'off' },
    { step: 'construct.fix', label: 'After Construct refuses a change, picks which of its typed fixes to try next.', kind: 'decide', provider: 'ollama', model: 'qwen2.5-coder:1.5b', modelFrom: "Line's default", maxTokens: 800, fallback: 'static', ladder: ladder(true), source: 'construct', on: true, win: '9/10 with typed fixes vs 6/10 static.' },
  ],
};

// im3 + j5: a small in-memory memory, one step with three picks; Forget clears it.
const memory = { 'drafter.route': 3, 'plan.step': 0 } as Record<string, number>;
const LABELS: Record<string, string> = { 'drafter.route': 'Which drafted route you pick', 'plan.step': 'What happens to a proposed plan step' };
const memoryView = () => {
  const steps = Object.entries(memory).map(([step, size]) => ({ step, label: LABELS[step] ?? step, size }));
  const total = steps.reduce((s, x) => s + x.size, 0);
  return { ok: true as const, steps, total, sentence: total ? `Line remembers ${total} remembered decisions for this project, on this computer only.` : 'Line has no memory for this project yet; it learns from what you pick, approve and change.' };
};

const MISSES: MissReportView = {
  ok: true,
  total: { misses: 2, absent: 1, picked: 1 },
  steps: [{ step: 'line.promote', absent: 1, picked: 1, total: 2, sentence: 'The line.promote step: 1 miss where the right answer was not offered, 1 where it was offered but not recommended.' }],
  topAbsent: [{ pattern: 'share <component> with <feature> -> line.promote + line.baseOn', step: 'line.promote', count: 1, sources: ['drafter-eval'], examples: ['drafter-eval:ls-v04'], sentence: '1 miss: "share <component> with <feature>" needed the line.promote + line.baseOn route, which Line did not offer.' }],
  sentence: "2 misses: 1 where the right answer was not among Line's options (a static tool is missing), 1 where it was offered but another was recommended.",
  from: 'From Train Line and the drafter eval (measured 2026-10-12).',
  numbers: null,
};

export const mockAiStepsApi: AiStepsApi = {
  getAiProfiles: async () => SAMPLE,
  getMisses: async () => MISSES,
  getMemory: async () => memoryView(),
  forgetMemory: async (step) => {
    const n = memory[step] ?? 0;
    memory[step] = 0;
    return { ...memoryView(), message: n ? `Line forgot ${n} remembered decisions for this step.` : 'There was nothing to forget for this step.' };
  },
};
