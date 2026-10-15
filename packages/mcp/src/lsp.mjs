// #945 -- the Line LSP tools (line_next_steps, line_completions, line_symbol_info, line_smith_check, line_fixes) as
// plain functions over packages/engine/line/lsp/tools.mjs. Each takes `(ctx, input)`; a file is project-relative and
// checked to stay inside the root (no "..", no absolute path, no link out) before anything is read. All read;
// line_fixes returns edits and applies none. The engine is imported inside each call, so tools/list loads none of it.
import fs from 'node:fs';
import path from 'node:path';
import { ToolError, LIMITS } from './limits.mjs';
import { assertContained } from './guard.mjs';

import { startLiveIndex } from './liveIndex.mjs';

const tools = () => import('@line/construct-engine/line/lsp-tools');
/** #950: a line_* call starts the session's live index READ-ONLY (it writes nothing; plan_* makes it read-write). */
const withLive = (ctx) => { startLiveIndex(ctx, 'read'); };

/**
 * A project-relative file a client sent, as the same relative path when it stays inside the root and exists.
 * @param {string} root The real project root.
 * @param {string} file What the client sent.
 * @returns {string}
 * @throws {ToolError} PATH_OUTSIDE_ROOT or NOT_FOUND.
 */
export function projectFile(root, file) {
  const f = String(file ?? '').trim().replace(/^\.\//, '');
  if (!f || path.isAbsolute(f) || /^~|^[A-Za-z]:/.test(f) || f.split(/[\\/]/).includes('..')) throw new ToolError('PATH_OUTSIDE_ROOT', 'Name a file inside the project by its project-relative path, for example features/book/domains/formatPages.ts.');
  assertContained(root);
  const abs = path.join(root, f);
  let real;
  try { real = fs.realpathSync(abs); } catch { throw new ToolError('NOT_FOUND', `There is no file ${f.slice(0, 120)} in the project.`); }
  if (real !== root && !real.startsWith(root + path.sep)) throw new ToolError('PATH_OUTSIDE_ROOT', `${f.slice(0, 120)} leaves the project root, so nothing was read.`);
  return f;
}

/** An LSP answer, or its refusal as a typed error. */
const answer = (r) => {
  if (r && r.ok === false) throw new ToolError('NOT_FOUND', String(r.reason ?? 'The Line LSP could not answer.').slice(0, LIMITS.lineChars));
  return r;
};

/**
 * `line_next_steps`: the Trace step legal next for a stable id, in Line order, plus the Ollama enum of the options.
 * @param {{root: string}} ctx The server context (its real root).
 * @param {{need: string, from: string}} args The checked input.
 * @returns {Promise<any>} The answer.
 * @throws {ToolError} PATH_OUTSIDE_ROOT, NOT_FOUND.
 */
export async function lineNextSteps(ctx, { need, from }) {
  withLive(ctx);
  assertContained(ctx.root);
  return answer((await tools()).lspNextSteps(ctx.root, { need, from }));
}

/**
 * `line_completions`: the names valid at a point (a marker, an offset, line/col) or at a tsc failure (code).
 * @param {{root: string}} ctx The server context (its real root).
 * @param {{file: string, text?: string, at?: any, line?: number, col?: number, code?: number|string}} args The checked input.
 * @returns {Promise<any>} The answer.
 * @throws {ToolError} PATH_OUTSIDE_ROOT, NOT_FOUND.
 */
export async function lineCompletions(ctx, args) {
  withLive(ctx);
  const file = projectFile(ctx.root, args.file);
  return answer((await tools()).lspCompletions(ctx.root, { ...args, file }));
}

/**
 * `line_symbol_info`: one symbol's type and declaration, or every export of the file.
 * @param {{root: string}} ctx The server context (its real root).
 * @param {{file: string, symbol?: string}} args The checked input.
 * @returns {Promise<any>} The answer.
 * @throws {ToolError} PATH_OUTSIDE_ROOT, NOT_FOUND.
 */
export async function lineSymbolInfo(ctx, { file, symbol }) {
  withLive(ctx);
  return answer((await tools()).lspSymbolInfo(ctx.root, { file: projectFile(ctx.root, file), symbol }));
}

/**
 * `line_smith_check`: a function's Smith sentences against its Smith test plan (exact match).
 * @param {{root: string}} ctx The server context (its real root).
 * @param {{file: string, fn: string, plan: string[], text?: string}} args The checked input.
 * @returns {Promise<any>} The answer.
 * @throws {ToolError} PATH_OUTSIDE_ROOT, NOT_FOUND.
 */
export async function lineSmithCheck(ctx, { file, fn, plan, text }) {
  withLive(ctx);
  return answer(await (await tools()).lspSmithCheck(ctx.root, { file: projectFile(ctx.root, file), fn, plan, text }));
}

/**
 * `line_fixes`: the deterministic fixes as edits, never applied.
 * @param {{root: string}} ctx The server context (its real root).
 * @param {{file: string, text?: string}} args The checked input.
 * @returns {Promise<any>} The answer.
 * @throws {ToolError} PATH_OUTSIDE_ROOT, NOT_FOUND.
 */
export async function lineFixes(ctx, { file, text }) {
  withLive(ctx);
  return answer((await tools()).lspFixes(ctx.root, { file: projectFile(ctx.root, file), text }));
}
