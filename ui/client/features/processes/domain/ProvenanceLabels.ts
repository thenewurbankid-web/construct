// Pure (DOMAIN-001): what each log badge means, as the hover text on the badge.
import type { Provenance } from '../types.ts';

export const PROVENANCE_MEANING: Record<Provenance, string> = {
  ok: 'A deterministic block did this',
  llm: 'A local model was involved: review before trusting it',
  warn: 'Needs your attention',
};
