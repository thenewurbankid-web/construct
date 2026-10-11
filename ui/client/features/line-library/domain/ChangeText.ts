// Pure (DOMAIN-001): the words and defaults around a Line change.
import type { ApplyResult } from '../types.ts';

/** A default name for a new feature item: the feature in PascalCase plus the library item's name ("orders" + Button -> OrdersButton). */
export function suggestName(feature: string, libraryName: string): string {
  const pascal = feature.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return `${pascal}${libraryName}`;
}

/** The sentence under the Promote confirm: what will happen, before anything is written. */
export function promoteText(name: string, library: string): string {
  return `This moves ${name} into ${library}/ and points every file that uses it at the library copy.`;
}

/** Any server answer as the contract's ApplyResult: a refusal `{ok:false, sentence, code}` has no files or findings. */
export function toApplyResult(body: unknown): ApplyResult {
  const b = (body && typeof body === 'object' ? body : {}) as Partial<ApplyResult>;
  return {
    ok: b.ok === true,
    sentence: typeof b.sentence === 'string' && b.sentence ? b.sentence : 'Cockpit could not do that; nothing was changed.',
    files: Array.isArray(b.files) ? b.files : [],
    findings: Array.isArray(b.findings) ? b.findings : [],
  };
}
