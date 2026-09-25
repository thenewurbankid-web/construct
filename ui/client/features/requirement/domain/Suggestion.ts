// Pure (DOMAIN-001): what the decision provider suggested for a closed question (#633), as the words the screen shows. The
// server asks the project's provider (rules by default, or a plugin) and sends `suggestions` by question id; nothing here
// decides anything, and a suggestion is never applied: the person still clicks an option.
import type { SuggestionView } from '../types.ts';
import type { ReadResult } from './RequirementTypes.ts';

/** "suggested by rules", or "suggested by rules (jev did not answer)" when the rules answered in place of a plugin that failed. */
export function suggestedByLabel(provider: string, fellBackFrom?: string): string {
  return fellBackFrom ? `suggested by ${provider} (${fellBackFrom} did not answer)` : `suggested by ${provider}`;
}

/**
 * The suggestion for one question, or null when the provider gave none (`off`, or it abstained). `legacy` is what an older
 * server put on the offer itself (rules only): used only when the response has no `suggestions` field at all, so a project
 * that switched the provider off never shows a suggestion.
 */
export function suggestionView(result: ReadResult, id: string, legacy?: { option: string; reason: string; provider: string }): SuggestionView | null {
  const s = result.suggestions?.[id];
  if (s) return { option: s.option, label: suggestedByLabel(s.provider.name, s.fellBackFrom), reason: s.reason };
  if (result.suggestions === undefined && legacy) return { option: legacy.option, label: suggestedByLabel(legacy.provider), reason: legacy.reason };
  return null;
}
