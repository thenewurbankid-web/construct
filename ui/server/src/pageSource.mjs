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
