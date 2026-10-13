// #945 -- the Line LSP's smithDiagnostics (packages/engine/lsp/smith.mjs) as a check step after a fill lands, against
// the step's Smith test plan (`smith`). Owner rule: logic exact, pages per element. A logic unit's sentences must
// equal the plan's exactly, in canonical mode (to-english {canonical: true}: an equivalent form reads the same); a
// page or component (returns JSX) passes when every element the plan names has its sentence (extra elements are
// fine), and a miss is named by its element. No embed fallback (lsp-r1: exact 12/12, embed 8/12). No plan, or
// atomic-codemod not linked: skipped, with why.
import { smithIndexFile, smithDiagnostics, smithReady, returnsJsx } from '../../lsp/smith.mjs';
import { lspMode, shadowLog } from './profile.mjs';

/**
 * Compare one filled function with its Smith test plan.
 * @param {string} rel Root-relative file of the function.
 * @param {string} source The file's text.
 * @param {string} fn The function's name.
 * @param {string[]|null|undefined} plan The Smith test plan sentences.
 * @param {{ready?: () => boolean}} [o]
 * @returns {Promise<{ok: true, skipped: string} | {ok: true, pass: boolean, exact: number, missing: any[], extra: any[], sentence: string}>}
 */
export async function smithCheck(rel, source, fn, plan, o = {}) {
  if (!Array.isArray(plan) || !plan.length) return { ok: true, skipped: 'the step has no Smith test plan' };
  if (!(o.ready ?? smithReady)()) return { ok: true, skipped: 'atomic-codemod is not linked, so Smith cannot read the code' };
  const index = await smithIndexFile(rel, source, { canonical: true });
  const entry = index.find((e) => e.name === fn);
  if (!entry) return { ok: true, skipped: `Smith found no function ${fn} in ${rel}` };
  if (!entry.elements && /\.[jt]sx$/.test(rel) && returnsJsx(source)) return { ok: true, skipped: 'this Smith cannot read a page per element (atomic-codemod smith-hardening reads TSX as written)' };
  const d = await smithDiagnostics({ [fn]: plan }, index);
  const mode = Object.values(d.modes ?? {})[0] ?? 'exact';
  const pass = !d.missing.length && !d.extra.length;
  const sentence = pass ? `${fn} does what its Smith test plan says.` : mode === 'elements'
    ? `${fn} is missing ${d.missing.map((m) => `${m.element ?? 'an element'} ("${m.sentence}")`).join(', ')} from its Smith test plan.`
    : [
      d.missing.length ? `The plan says ${d.missing.map((m) => `"${m.sentence}"`).join(', ')}, which the code does not do` : '',
      d.extra.length ? `the code does ${d.extra.map((m) => `"${m.sentence}"`).join(', ')}, which the plan does not say` : '',
    ].filter(Boolean).join('; ').replace(/^t/, 'T') + '.';
  return { ok: true, pass, mode, exact: d.exact, missing: d.missing, extra: d.extra, sentence };
}

/**
 * smithCheck under the lsp.smithCheck switch. on: a mismatch is a failure (layer smith); shadow: logged, never fails.
 * @returns {Promise<{mode: string, failure: object|null, result: any}>}
 */
export async function smithCheckStep(root, unit, source, o = {}) {
  const mode = lspMode(root, 'smithCheck', o.lsp ?? null);
  if (mode === 'off') return { mode, failure: null, result: null };
  let result;
  try { result = await smithCheck(unit.file, source, unit.fn, unit.smith, o); } catch (e) { result = { ok: false, reason: String(/** @type {any} */ (e)?.message ?? e).slice(0, 200) }; }
  if (mode === 'shadow') {
    if (result && !result.skipped) shadowLog(root, 'smithCheck', { id: unit.id, pass: result.pass ?? null, missing: result.missing ?? [], extra: result.extra ?? [] });
    return { mode, failure: null, result };
  }
  const failure = result?.ok && result.pass === false ? { layer: 'smith', sentence: result.sentence, missing: result.missing, extra: result.extra } : null;
  return { mode, failure, result };
}
