// Pure (DOMAIN-001): a finding's typed fixes laid out for the panel, and any server answer as one ApplyResult.
import type { ApplyResult, FixOptions, LineFinding, LineFix } from '../types.ts';

/** The fixes come sorted by rank (contract.mjs); the first is the recommended one, the rest are other ways. */
export function fixOptions(finding: Pick<LineFinding, 'fixes'>): FixOptions {
  const fixes = Array.isArray(finding.fixes) ? [...finding.fixes].sort((a, b) => a.rank - b.rank) : [];
  return { recommended: fixes[0] ?? null, others: fixes.slice(1) };
}

/** True when the fix has a step Cockpit can apply; false for advice only (do it by hand). */
export function canApply(fix: LineFix): boolean {
  return fix.step !== null && typeof fix.step === 'object';
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Any answer as an ApplyResult whose sentence starts "Saved." or "Nothing was saved: ..." (a refusal such as
 * "advice only" or "that problem is gone" arrives as a bare sentence; it is said the same way). */
export function fixResult(body: unknown): ApplyResult {
  const b = (body && typeof body === 'object' ? body : {}) as Partial<ApplyResult>;
  const ok = b.ok === true;
  const raw = typeof b.sentence === 'string' && b.sentence ? b.sentence : ok ? 'Saved.' : 'Cockpit could not do that.';
  const sentence = ok || raw.startsWith('Nothing was saved') ? raw : `Nothing was saved: ${lowerFirst(raw)}`;
  return { ok, sentence, files: Array.isArray(b.files) ? b.files : [], findings: Array.isArray(b.findings) ? b.findings : [] };
}

/** The accessible name of a fix's Apply button: what it will do. */
export function applyLabel(fix: LineFix): string {
  return `Apply: ${fix.sentence}`;
}
