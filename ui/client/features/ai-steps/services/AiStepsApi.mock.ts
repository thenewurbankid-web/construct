import type { AiProfiles, AiStepsApi, StepProfile } from '../types';

// A sample in the contract's shape (packages/core/ai-profiles.json holds the real set; the server reads it).
const ladder = (jev: boolean): StepProfile['ladder'] => ({ static: { target: 1 }, options: { on: jev, target: 0.6 }, review: { on: false, target: 0.7 }, measured: null });
const SAMPLE: AiProfiles = {
  defaultModel: 'qwen2.5-coder:1.5b',
  reason: { linked: false, sentence: 'jev and the ladder are not linked, so every AI step uses its static path.' },
  profiles: [
    { step: 'cockpit.importFill', label: "Fills one imported file's gaps, shown as a diff you approve.", kind: 'draft', provider: 'ollama', model: 'qwen2.5-coder:1.5b', modelFrom: "Line's default", maxTokens: 800, fallback: 'static', ladder: ladder(false), source: 'cockpit' },
    { step: 'trace.choose', label: 'Picks where one part of a page gets its data from, citing a fact that settles it.', kind: 'decide', provider: 'ollama', model: 'qwen2.5-coder:1.5b', modelFrom: "Line's default", maxTokens: 120, fallback: 'static', ladder: ladder(true), source: 'trace' },
    { step: 'construct.chooser', label: 'Suggests the next step a developer most likely wants from the steps on offer.', kind: 'decide', provider: 'ollama', model: 'qwen2.5-coder:1.5b', modelFrom: "Line's default", maxTokens: 800, fallback: 'static', ladder: ladder(true), source: 'construct' },
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

export const mockAiStepsApi: AiStepsApi = {
  getAiProfiles: async () => SAMPLE,
  getMemory: async () => memoryView(),
  forgetMemory: async (step) => {
    const n = memory[step] ?? 0;
    memory[step] = 0;
    return { ...memoryView(), message: n ? `Line forgot ${n} remembered decisions for this step.` : 'There was nothing to forget for this step.' };
  },
};
