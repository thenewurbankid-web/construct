// #945 -- the deterministic gatherer: a file's exports as one line each (`file:line name: exact type`, the Line LSP's
// definition + quickInfo) in place of the file's text in a model's context (lsp-r1 L-gather-det: 12/12 coverage at
// 1392 against 4313 tokens). Used by the research sub-agent's read_file and the coder's scope read, under lsp.gatherer.
import fs from 'node:fs';
import path from 'node:path';
import { definition, quickInfo, approxTokens } from '../../lsp/index.mjs';
import { ts } from '../../lsp/host.mjs';
import { lspMode, shadowLog } from '../lsp/profile.mjs';

const CODE = /\.(tsx?|mts|cts)$/;
const declName = (st) => {
  if (st.name && ts.isIdentifier(st.name)) return st.name.text;
  if (ts.isVariableStatement(st)) { const d = st.declarationList.declarations[0]; return d && ts.isIdentifier(d.name) ? d.name.text : null; }
  return null;
};

/** The names one TS file exports by declaration. */
export function exportedNames(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return sf.statements.filter((s) => /** @type {any} */ (s).modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map(declName).filter(Boolean);
}

/**
 * Each export of each file, as `file:line name: type`.
 * @param {string} root Project root (with a tsconfig.json).
 * @param {string[]} files Root-relative TypeScript files.
 * @returns {{ok: true, lines: string[], text: string, tokens: number, filesTokens: number, lookups: number, ms: number}}
 */
export function gatherSymbols(root, files) {
  const t0 = Date.now();
  const lines = []; let filesTokens = 0; let lookups = 0;
  for (const rel of files.filter((f) => CODE.test(f))) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    filesTokens += approxTokens(text);
    for (const n of exportedNames(rel, text)) {
      const d = definition(root, rel, n); const q = quickInfo(root, rel, n); lookups += 2;
      const at = d.ok && d.locations?.[0] ? `${d.locations[0].file}:${d.locations[0].line}` : rel;
      lines.push(`${at} ${q.ok ? q.type : n}`);
    }
  }
  const text = lines.join('\n');
  return { ok: true, lines, text, tokens: approxTokens(text), filesTokens, lookups, ms: Date.now() - t0 };
}

/**
 * gatherSymbols under the lsp.gatherer switch, for one file a model asked to read. on: the symbol lines replace the
 * text (a file with no exports, or not TypeScript, keeps its text); shadow: the text is used and both sizes are logged.
 * @param {string} root @param {string} rel @param {string} text The file's text (what would be pasted).
 * @param {{lsp?: Record<string, unknown>|null, where?: string}} [o]
 * @returns {{mode: string, symbols: string|null}}
 */
export function gatherStep(root, rel, text, o = {}) {
  const mode = lspMode(root, 'gatherer', o.lsp ?? null);
  if (mode === 'off' || !CODE.test(rel) || !fs.existsSync(path.join(root, 'tsconfig.json'))) return { mode, symbols: null };
  let g;
  try { g = gatherSymbols(root, [rel]); } catch { return { mode, symbols: null }; }
  if (!g.lines.length) return { mode, symbols: null };
  if (mode === 'shadow') { shadowLog(root, 'gatherer', { where: o.where ?? 'read', file: rel, tokens: g.tokens, textTokens: approxTokens(text) }); return { mode, symbols: null }; }
  return { mode, symbols: g.text };
}
