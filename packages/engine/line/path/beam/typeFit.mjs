// #949 Trace beam, prune stage 2 (types): is an existing function's signature ASSIGNABLE to the slot it would fill?
// One unsaved probe file per check on the shared LSP host (lsp/host.mjs withOverlay): it imports the function, passes
// what the caller has (the slot's `in`) and assigns the result to what the caller needs (the slot's `out`). Any
// semantic diagnostic in the probe is a type misfit; quickInfo gives the signature the compare package shows.
import path from 'node:path';
import { openProject, withOverlay, ts } from '../../../lsp/host.mjs';

export const PROBE_FILE = '__beam_probe__.ts';

/**
 * The probe text for one function and slot.
 * @param {string} root
 * @param {{file: string, name: string}} fn
 * @param {{in?: string, out?: string, types?: string}} slot `in` 'void' calls with no argument.
 * @returns {string}
 */
export function probeText(root, fn, slot) {
  let spec = path.posix.relative('.', fn.file.replace(/\.[cm]?[jt]sx?$/, ''));
  if (!spec.startsWith('.')) spec = `./${spec}`;
  const call = slot.in === 'void' ? '__f()' : '__f(__in)';
  return [`import { ${fn.name} as __f } from '${spec}';`, slot.types ?? '', slot.in === 'void' ? '' : `declare const __in: ${slot.in};`,
    `const __out: ${slot.out ?? 'unknown'} = ${call};`, 'void __out;', 'export {};', ''].join('\n');
}

/**
 * Check one function against one slot.
 * @param {string} root A project root with a tsconfig.json.
 * @param {{file: string, name: string}} fn The candidate function (beamFacts entry).
 * @param {{in?: string, out?: string, types?: string}} slot
 * @returns {{ok: boolean, skipped?: string, message?: string, signature?: string|null, ms: number}}
 */
export function typeFit(root, fn, slot) {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  if (!slot.in && !slot.out) return { ok: true, skipped: 'the slot names no types', ms: ms() };
  const pr = openProject(root);
  if (!pr.ok) return { ok: true, skipped: `no LSP host: ${/** @type {any} */ (pr).reason}`, ms: ms() };
  const file = path.join(path.resolve(root), PROBE_FILE);
  const text = probeText(root, fn, slot);
  return withOverlay(pr.entry, file, text, () => {
    const diags = pr.service.getSemanticDiagnostics(file).concat(pr.service.getSyntacticDiagnostics(file));
    const at = text.indexOf('__f');
    const q = pr.service.getQuickInfoAtPosition(file, at);
    const signature = q ? ts.displayPartsToString(q.displayParts).replace(/^\(alias\)\s*/, '').split('\n').pop() : null;
    if (!diags.length) return { ok: true, signature, ms: ms() };
    const message = ts.flattenDiagnosticMessageText(diags[0].messageText, ' ').slice(0, 240);
    return { ok: false, message, signature, ms: ms() };
  });
}
