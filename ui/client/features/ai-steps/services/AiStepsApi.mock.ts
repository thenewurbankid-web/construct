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

export const mockAiStepsApi: AiStepsApi = { getAiProfiles: async () => SAMPLE };
