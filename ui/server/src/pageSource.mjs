// Pages Editor source view: the full text of one page file plus live
// diagnostics for it, and (#551) buffer-scoped linting + quick fixes for an
// unsaved edit in the code drill-down. Path scoping is exactly the editor's
// own guard (resolvePageFile: strictly inside features/<feature>/pages/);
// the diagnostics themselves come from the core (packages/engine/diagnostics.mjs).
import fs from 'node:fs';
import { collectDiagnostics, lintBuffer } from '../../../packages/engine/diagnostics.mjs';
import { applyMechanicalFix, mechanicalFixAvailable } from '../../../packages/core/ruleFixes.mjs';
import { callLlm, stripCodeFence } from '../../../packages/core/llm.mjs';
import { recordChoices } from '../../../packages/core/decision-trace-store.mjs';
import { choiceFromQuickFix } from '../../../packages/core/decision-trace-adapters.mjs';
import { resolvePageFile, hashOf } from './pagesEditor.mjs';
import { PagesEditorError } from './pagesEditor.mjs';
import { legacyIo } from '../../../packages/core/modelled-io.mjs';
import { functionsIn, functionAt, fillOne } from '../../../packages/engine/line/coder/prefill/index.mjs';

const diagKey = (d) => `${d.code}|${d.message}`;

/**
 * #948 -- the modelled AI quick fix: the model is asked for the ONE function the rule's line is in (its signature
 * prefilled, stopped at its closing brace), never the whole file. The buffer is re-linted after the splice; the fix is
 * refused while the rule still fires or a diagnostic appears that was not there before (one retry, carrying only that
 * first error). A rule outside any function gets no model call (LINE_LEGACY_IO=1: the old whole-file request).
 * @param {string} root @param {string} relPath @param {string} source @param {string} rule @param {string} llmProvider
 * @returns {Promise<{fixedSource: string, attribution: {provider: string, rule: string, fn: string}}>}
 */
export async function aiFixOneFunction(root, relPath, source, rule, llmProvider) {
  const before = lintBuffer(root, relPath, source);
  const violation = before.find((d) => d.code === rule);
  if (!violation) throw new PagesEditorError(`${rule} does not fire in this buffer, so there is nothing to fix.`, { status: 422 });
  const fn = functionAt(functionsIn(source, relPath), { line: violation.line });
  if (!fn) throw new PagesEditorError(`${rule} fires at line ${violation.line}, outside any function; the AI fix rewrites one function, so use the mechanical fix or edit it by hand.`, { status: 422 });
  const counts = new Map();
  for (const d of before) counts.set(diagKey(d), (counts.get(diagKey(d)) ?? 0) + 1);
  const gate = (next) => {
    const after = lintBuffer(root, relPath, next);
    const still = after.find((d) => d.code === rule);
    if (still) return { sentence: `${rule} still fires at line ${still.line}: ${still.message}` };
    const seen = new Map();
    for (const d of after) {
      seen.set(diagKey(d), (seen.get(diagKey(d)) ?? 0) + 1);
      if (seen.get(diagKey(d)) > (counts.get(diagKey(d)) ?? 0)) return { sentence: `the fix adds a new diagnostic at line ${d.line}: ${d.code} ${d.message}` };
    }
    return null;
  };
  const generate = async ({ system, user, prefill, stop }) => callLlm(llmProvider, user, { output: { system, prefill, stop } });
  const user = [`Fix exactly one lint violation inside the function ${fn.name} of ${relPath}.`, `Rule: ${rule} (line ${violation.line}): ${violation.message}`, '--- FILE (for reference; only the body of that one function is rewritten) ---', source].join('\n');
  const r = await fillOne({ source, file: relPath, target: { name: fn.name }, generate, user, gate, maxAttempts: 2 });
  if (!r.ok) throw new PagesEditorError(`The AI fix was refused: ${r.sentence.split('\n')[0]}`, { status: 422 });
  return { fixedSource: r.source, attribution: { provider: llmProvider, rule, fn: fn.name } };
}

export function readPageSource(root, feature, file) {
  const { absPath, relPath } = resolvePageFile(root, feature, file);
  const source = fs.readFileSync(absPath, 'utf8');
  return { source, contentHash: hashOf(source), diagnostics: collectDiagnostics(root, relPath, source) };
}

/** Diagnostics for an unsaved buffer (`source`), never written to disk on
 * the caller's behalf — the file itself is only ever touched (written, then
 * reverted) inside `lintBuffer` itself, for the duration of one call. */
export function lintPageBuffer(root, feature, file, source) {
  const { relPath } = resolvePageFile(root, feature, file);
  return { diagnostics: lintBuffer(root, relPath, source) };
}

/** One quick fix, "Mechanical" (the rule's own deterministic transform) or
 * "AI" (a model call scoped to just this violation) — returns the fixed
 * buffer text for the caller to diff and review, never writes to disk.
 * Records the Mechanical | AI choice as a decision-trace (#551, "AI-ready by
 * design"): the two closed options as offered for `rule`, and the mode picked. */
export async function quickFixPageBuffer(root, feature, file, source, rule, mode, llmProvider) {
  resolvePageFile(root, feature, file); // scope guard only; the fix runs on the in-memory buffer.
  const traced = mode === 'mechanical' || mode === 'ai';
  if (traced) recordChoices(root, [choiceFromQuickFix(rule, mechanicalFixAvailable(rule), mode)], { suggestWith: null }).catch(() => null);
  if (mode === 'mechanical') {
    const fixed = applyMechanicalFix(rule, source);
    if (fixed === null) throw new PagesEditorError(`No mechanical fix is known for ${rule}.`, { status: 422 });
    return { fixedSource: fixed };
  }
  if (mode === 'ai' && !legacyIo()) return aiFixOneFunction(root, resolvePageFile(root, feature, file).relPath, source, rule, llmProvider);
  if (mode === 'ai') {
    const diagnostics = lintBuffer(root, resolvePageFile(root, feature, file).relPath, source);
    const violation = diagnostics.find((d) => d.code === rule);
    const prompt = [
      'You are fixing exactly one lint violation in a TypeScript/TSX file. Reply with the complete fixed file contents only -- no explanation, no code fence.',
      `Rule: ${rule}${violation ? ` -- ${violation.message}` : ''}`,
      '--- FILE ---',
      source,
    ].join('\n');
    const response = await callLlm(llmProvider, prompt);
    return { fixedSource: stripCodeFence(response).trimEnd() + '\n', attribution: { provider: llmProvider, rule } };
  }
  throw new PagesEditorError(`Unknown quick-fix mode "${mode}".`, { status: 400 });
}
