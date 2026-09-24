// Shared "ask an LLM for one file's full text, but never trust it blindly"
// step, used by both import.mjs's per-file fill and generators.mjs's
// fillGeneratedFile (#144). callLlm (llm.mjs) stays a dumb prompt->text
// pipe; this module owns what to do with the text: pull the code out of a
// prose-wrapped response, refuse anything that doesn't parse as TypeScript/
// JavaScript, and give a model one bounded chance to correct itself. It
// never writes files — callers decide what a rejection/failure leaves behind.
import { callLlm, stripCodeFence } from './llm.mjs';
import { parseToAst } from './parser.mjs';

// Appended to every fill prompt. The `claude -p` CLI, unprompted, has replied
// "I wasn't able to write directly to the file, please apply manually" around
// a code block: it reasons about tools it does not have and does not need.
export const OUTPUT_CONTRACT = [
  'How your reply is used: it is captured from stdout and written, byte for byte, as the file. You have no file or tool access and never need any — do NOT try to write, edit or save a file, and do NOT apologise, explain, or ask for anything.',
  'Reply with ONLY the complete new file content, as raw source code. No markdown code fences, no prose before or after.',
].join('\n');

const FENCE_RE = /```[a-zA-Z0-9]*[ \t]*\n([\s\S]*?)\n?```/g;

/** Pull the file text out of a model response. Order: the whole response is
 * one fence -> its content; exactly one fenced block amid prose -> that
 * block's content (`how: 'fence-in-prose'`); no fence at all -> the raw
 * trimmed text; two or more fences -> ambiguous, so not guessed at (raw text
 * is returned and will fail validation unless it happens to be code). */
export function extractCode(raw) {
  const text = String(raw ?? '');
  const fences = [...text.matchAll(FENCE_RE)];
  if (fences.length > 1) return { code: text.trim(), how: 'ambiguous-fences' };
  if (fences.length === 0) return { code: text.trim(), how: 'raw' };
  const whole = stripCodeFence(text) !== text.trim();
  return { code: fences[0][1].trim(), how: whole ? 'fence' : 'fence-in-prose' };
}

/** null when `code` parses as TS/JS(X), else a short human-readable reason. */
export function whyNotCode(code) {
  if (!code.trim()) return 'the response was empty';
  try {
    const ast = parseToAst(code);
    // A lone word of prose ("Done", "OK") parses as an expression statement;
    // a real file body has at least one declaration/import/export.
    if (!ast.body.some((n) => n.type !== 'ExpressionStatement')) {
      return 'it parses, but contains no declarations, imports or exports — it is not a file body';
    }
    return null;
  } catch (e) {
    const where = e.lineNumber ? ` (line ${e.lineNumber})` : '';
    return `it does not parse as TypeScript/JavaScript${where}: ${String(e.message).split('\n')[0]}`;
  }
}

/** Run `prompt` through `llm` and return one of:
 *   { status: 'filled', code, attempts }
 *   { status: 'rejected', reason, attempts, preview }  — model answered, output isn't valid code
 *   { status: 'failed', reason, attempts }             — the provider call itself threw (#141)
 *   { status: 'cancelled', reason, attempts }          — the caller's AbortSignal fired (#599); never retried
 * At most ONE retry, and only after a *rejection* (a model that just proved
 * it can be non-deterministic gets one corrected re-ask with the reason
 * appended). A thrown provider error is never retried: a missing CLI, dead
 * daemon or rate limit won't fix itself in the next second and a retry
 * would double the cost of every failing file. Unknown-provider config
 * errors (USAGE_ERROR) are rethrown — that's a mistake in the command, not
 * a per-file failure. */
export async function requestFileText(llm, prompt, llmOptions, { retryOnReject = true } = {}) {
  let attempts = 0;
  let currentPrompt = `${prompt}\n\n${OUTPUT_CONTRACT}`;
  for (;;) {
    attempts++;
    let raw;
    try {
      raw = await callLlm(llm, currentPrompt, llmOptions);
    } catch (e) {
      if (e?.exitCode === 2) throw e;
      // #599 -- a person cancelling is not a failure: report it as its own status so callers stop
      // (rather than move on to the next file) and a UI can show "cancelled", not "failed".
      if (e?.cancelled) return { status: 'cancelled', reason: 'cancelled', attempts };
      return { status: 'failed', reason: e?.message || String(e), attempts };
    }
    const { code } = extractCode(raw);
    const reason = whyNotCode(code);
    if (!reason) return { status: 'filled', code, attempts };
    if (!retryOnReject || attempts >= 2) {
      return { status: 'rejected', reason, attempts, preview: String(raw ?? '').trim().slice(0, 120) };
    }
    currentPrompt = `${prompt}\n\nYour previous reply was rejected because ${reason}. Start over.\n\n${OUTPUT_CONTRACT}`;
  }
}
