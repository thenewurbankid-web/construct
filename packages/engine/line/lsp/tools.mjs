// #945 -- the five Line LSP calls a coding harness (Claude Code, OpenCode, Line's own coder) calls by name, from a
// project root: construct-mcp's line_next_steps, line_completions, line_symbol_info, line_smith_check and line_fixes.
// All read; lspFixes returns edits and never applies them. Each takes a project-relative file (checked by the caller)
// and an optional unsaved `text`; none writes, none logs.
import fs from 'node:fs';
import path from 'node:path';
import { completionsAt, completionSchema, quickInfo, definition, fixes } from '../../lsp/index.mjs';
import { traceStep } from './traceStep.mjs';
import { smithCheck } from './smithCheck.mjs';
import { completionsForFailure } from '../coder/completions.mjs';
import { gatherSymbols } from '../coder/symbols.mjs';

const textOf = (root, file, text) => (typeof text === 'string' ? text : fs.readFileSync(path.join(root, file), 'utf8'));
const offsetOf = (text, line, col) => text.split('\n').slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0) + col - 1;

/** line_next_steps: the Trace step for a stable id, every legal option, and the Ollama enum. */
export const lspNextSteps = (root, { need, from }) => traceStep(root, { need, from });

/**
 * line_completions: the names valid at a point, with the Ollama `format` enum. `code` (a tsc error code) asks for the
 * closed choice at that failure (import paths ranked by exports); else `at` (a marker in `text`, or an offset) or
 * line/col is the point.
 */
export function lspCompletions(root, { file, text, at, line, col, code }) {
  const t = textOf(root, file, text);
  if (code !== undefined) return completionsForFailure(root, file, t, { line, col, code });
  const point = at ?? (line ? offsetOf(t, line, col ?? 1) : null);
  if (point === null || point === undefined) return { ok: false, reason: 'give at (a marker or an offset), line and col, or a tsc code' };
  const c = completionsAt(root, file, point, { text: t });
  return c.ok ? { ...c, schema: completionSchema(c.items.map((i) => i.name)) } : c;
}

/** line_symbol_info: one symbol's exact type and where it is declared, or (no symbol) every export of the file. */
export function lspSymbolInfo(root, { file, symbol }) {
  if (!symbol) return gatherSymbols(root, [file]);
  const q = quickInfo(root, file, symbol); const d = definition(root, file, symbol);
  if (!q.ok && !d.ok) return q;
  return { ok: true, symbol, type: q.ok ? q.type : null, kind: q.ok ? q.kind : null, locations: d.ok ? d.locations : [] };
}

/** line_smith_check: a function's Smith sentences against a Smith test plan, exact match only. */
export const lspSmithCheck = (root, { file, fn, plan, text }) => smithCheck(file, textOf(root, file, text), fn, plan);

/** line_fixes: the deterministic fixes as edits against the text (start, end, newText), never applied. */
export function lspFixes(root, { file, text }) {
  const f = fixes(root, file, typeof text === 'string' ? { text } : {});
  return f.ok ? { ok: true, file: f.file, edits: f.edits, applied: f.applied, other: f.other, unfixed: f.unfixed, applies: false } : f;
}
