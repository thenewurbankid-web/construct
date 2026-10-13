// #945 -- the Line LSP's fixes() (fixMissingImport, unresolved import paths re-pointed at the one project file that
// matches, single-candidate spelling fixes; packages/engine/lsp/index.mjs) applied to a spliced file before tsc runs.
// The edits stay inside the file; a fix that would change the stub's locked signature, or leave a body that does not
// parse, is dropped whole. Edits another file would need are only reported.
import { fixes, applyFixEdits } from '../../lsp/index.mjs';
import { stubParts } from '../path/stubs.mjs';
import { lspMode, shadowLog } from './profile.mjs';

/**
 * Deterministic fixes for one spliced file.
 * @param {string} root Project root (needs a tsconfig.json; without one nothing is fixed).
 * @param {string} file Root-relative file.
 * @param {string} source The file as the splice left it.
 * @param {{fn?: string|null}} [o] `fn`: the stub whose signature must not change.
 * @returns {{source: string, applied: any[], other: any[], unfixed: string[], dropped?: string}}
 */
export function fixSpliced(root, file, source, o = {}) {
  const f = fixes(root, file, { text: source });
  if (!f.ok || !f.edits.length) return { source, applied: [], other: f.ok ? f.other : [], unfixed: f.ok ? f.unfixed : [], ...(f.ok ? {} : { dropped: f.reason }) };
  const fixed = applyFixEdits(source, f.edits);
  if (o.fn) {
    const a = stubParts(source, o.fn); const b = stubParts(fixed, o.fn);
    if (!b || (a && a.signature !== b.signature)) return { source, applied: [], other: f.other, unfixed: f.unfixed, dropped: 'the fix would change the locked signature' };
  }
  return { source: fixed, applied: f.applied, other: f.other, unfixed: f.unfixed };
}

/**
 * fixSpliced under the lsp.fixes switch: on returns the fixed source, shadow logs what it would apply and keeps the
 * source, off does nothing.
 * @param {string} root @param {string} file @param {string} source
 * @param {{fn?: string|null, lsp?: Record<string, unknown>|null, id?: string}} [o]
 * @returns {{source: string, applied: any[], mode: string}}
 */
export function fixesStep(root, file, source, o = {}) {
  const mode = lspMode(root, 'fixes', o.lsp ?? null);
  if (mode === 'off') return { source, applied: [], mode };
  const r = fixSpliced(root, file, source, o);
  if (mode === 'shadow') {
    if (r.applied.length) shadowLog(root, 'fixes', { id: o.id ?? file, file, would: r.applied });
    return { source, applied: [], mode };
  }
  return { source: r.source, applied: r.applied, mode };
}
