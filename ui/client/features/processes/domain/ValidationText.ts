// Pure (DOMAIN-001): the check that runs after an approval, in plain words. The gate never reverts
// anything, so neither does this wording claim it did.
import type { Validation } from './ReviewTypes.ts';

export function validationText(v: Validation | null): { text: string | null; violations: string[]; ok: boolean } {
  if (!v) return { text: null, violations: [], ok: true };
  if (!v.ran) return { text: `The architecture check could not run after applying: ${v.error ?? 'unknown reason'}. Nothing was reverted.`, violations: [], ok: false };
  if (v.newViolations.length === 0) return { text: 'Checked after applying: no new architecture violations.', violations: [], ok: true };
  return {
    text: `Checked after applying: ${v.newViolations.length} new architecture violation(s). Nothing was reverted; fix them or undo the change yourself.`,
    violations: v.newViolations.map((x) => `${x.rule ?? 'rule'} ${x.file ?? ''}: ${x.message ?? ''}`.trim()),
    ok: false,
  };
}
