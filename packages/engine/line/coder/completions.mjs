// #945 -- the coder's closed choice at a known tsc failure point: the Line LSP's completionsAt (packages/engine/lsp)
// at the failing spot, with its Ollama `format` enum, so the model picks a name or an import path instead of typing
// one (lsp-r1 L-enum 6/9, against 0/9 free text). Points: TS2307 (import path), TS2305/TS2724 (imported name),
// TS2339/TS2551 (member), TS2304 (unknown name: which module to import it from). Import paths are ranked by whether
// the module exports the names the import needs (the one L-enum miss left). Read-only; nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import { completionsAt, completionSchema } from '../../lsp/index.mjs';
import { ts } from '../../lsp/host.mjs';
import { lspMode, shadowLog } from '../lsp/profile.mjs';

export const HOLE = '/*HOLE*/';
const KIND_OF = { 2307: 'path', 2305: 'name', 2724: 'name', 2339: 'member', 2551: 'member', 2304: 'import-source' };
const parse = (text, file) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const offsetOf = (text, line, col) => text.split('\n').slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0) + col - 1;

/**
 * The failure point of one tsc error: what is wrong there and the file with a hole where the answer goes.
 * @param {string} text The file.
 * @param {{line: number, col: number, code: number|string}} err tsc's line and column (1-based) and code (2307 or 'TS2307').
 * @param {string} [file]
 * @returns {{kind: string, code: number, wrong: string, text: string, names: string[]} | null}
 */
export function failurePoint(text, err, file = 'x.tsx') {
  const code = Number(String(err.code).replace(/^TS/, ''));
  const kind = KIND_OF[code];
  if (!kind || !err.line || !err.col) return null;
  const pos = offsetOf(text, err.line, err.col);
  if (kind === 'path') {
    const q = text[pos];
    if (q !== '"' && q !== "'") return null;
    const end = text.indexOf(q, pos + 1);
    const sf = parse(text, file);
    const decl = sf.statements.find((s) => ts.isImportDeclaration(s) && s.moduleSpecifier.getStart(sf) === pos);
    const names = /** @type {any} */ (decl)?.importClause?.namedBindings?.elements?.map((e) => (e.propertyName ?? e.name).text) ?? [];
    return { kind, code, wrong: text.slice(pos + 1, end), text: `${text.slice(0, pos + 1)}${HOLE}${text.slice(end)}`, names };
  }
  const w = /^[\w$]+/.exec(text.slice(pos))?.[0];
  if (!w) return null;
  if (kind === 'import-source') {
    const sf = parse(text, file);
    const first = sf.statements.find((s) => ts.isImportDeclaration(s))?.getStart(sf) ?? 0;
    return { kind, code, wrong: w, text: `${text.slice(0, first)}import { ${w} } from '${HOLE}';\n${text.slice(first)}`, names: [w] };
  }
  return { kind, code, wrong: w, text: `${text.slice(0, pos)}${HOLE}${text.slice(pos + w.length)}`, names: kind === 'name' ? [w] : [] };
}

/**
 * The names a project module exports (its own declarations and `export { }` lists), or null when it is not a file.
 * @param {string} abs An absolute file.
 * @returns {Set<string>|null}
 */
export function exportsOf(abs) {
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const out = new Set();
  const sf = parse(text, abs);
  for (const st of sf.statements) {
    const exp = /** @type {any} */ (st).modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exp && /** @type {any} */ (st).name?.text) out.add(/** @type {any} */ (st).name.text);
    if (exp && ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.add(d.name.text);
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) out.add(e.name.text);
  }
  return out;
}

const EXT = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
/** A relative specifier from `file` as a project file, or null. */
function resolveSpec(root, file, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(root, path.dirname(file), spec);
  return EXT.map((e) => base + e).find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) ?? null;
}

/** An auto-import source as an import specifier from `file`: a root-relative project file becomes `./..`; a package stays. */
function specifierOf(root, file, from) {
  const abs = path.resolve(root, from);
  if (from.startsWith('.') || !fs.existsSync(abs)) return from;
  let s = path.relative(path.dirname(path.resolve(root, file)), abs).split(path.sep).join('/').replace(/\.(tsx?|jsx?)$/, '').replace(/\/index$/, '');
  if (!s.startsWith('.')) s = `./${s}`;
  return s;
}

/**
 * Import-path candidates ranked: the modules that export every needed name first, then by how many they export,
 * the LSP's own order kept within a tie.
 * @param {string} root @param {string} file @param {string[]} specs @param {string[]} needed
 * @returns {string[]}
 */
export function rankImportPaths(root, file, specs, needed) {
  if (!needed.length) return specs;
  const score = (s) => { const ex = (() => { const f = resolveSpec(root, file, s); return f ? exportsOf(f) : null; })(); return ex ? needed.filter((n) => ex.has(n)).length : 0; };
  return specs.map((s, i) => ({ s, i, k: score(s) })).sort((a, b) => b.k - a.k || a.i - b.i).map((x) => x.s);
}

/**
 * The closed choice at one tsc failure: { kind, wrong, items, schema } where `schema` is the Ollama `format` whose enum
 * is exactly `items`.
 * @param {string} root Project root (with a tsconfig.json).
 * @param {string} file Root-relative file.
 * @param {string} text The file as it failed.
 * @param {{line: number, col: number, code: number|string}} err
 * @returns {{ok: true, kind: string, code: number, wrong: string, items: string[], schema: object, ms: number} | {ok: false, reason: string}}
 */
export function completionsForFailure(root, file, text, err) {
  const t0 = Date.now();
  const p = failurePoint(text, err, file);
  if (!p) return { ok: false, reason: `TS${String(err.code).replace(/^TS/, '')} is not a failure point a closed choice answers` };
  let items = [];
  if (p.kind === 'import-source') {
    const probe = `${text}\n;${p.wrong}`;
    const c = completionsAt(root, file, probe.length, { text: probe });
    items = [...new Set((c.items ?? []).filter((i) => i.name === p.wrong && i.from).map((i) => specifierOf(root, file, i.from)))];
    if (!items.length) items = (completionsAt(root, file, HOLE, { text: p.text }).items ?? []).map((i) => i.name);
  } else {
    const c = completionsAt(root, file, HOLE, { text: p.text });
    if (!c.ok) return c;
    items = (c.items ?? []).map((i) => i.name);
  }
  if (p.kind === 'path' || p.kind === 'import-source') items = rankImportPaths(root, file, items, p.names);
  items = items.filter((x) => x !== p.wrong);
  return { ok: true, kind: p.kind, code: p.code, wrong: p.wrong, items, schema: completionSchema(items), ms: Date.now() - t0 };
}

/**
 * completionsForFailure under the lsp.completions switch. on: the choice is offered (returned); shadow: computed and
 * logged, not offered (null); off: not computed.
 * @param {string} root @param {string} file @param {string} text @param {{line: number, col: number, code: number|string}} err
 * @param {{lsp?: Record<string, unknown>|null, id?: string}} [o]
 * @returns {{mode: string, offer: any|null}}
 */
export function completionsStep(root, file, text, err, o = {}) {
  const mode = lspMode(root, 'completions', o.lsp ?? null);
  if (mode === 'off') return { mode, offer: null };
  let c;
  try { c = completionsForFailure(root, file, text, err); } catch (e) { c = { ok: false, reason: String(/** @type {any} */ (e)?.message ?? e).slice(0, 200) }; }
  if (!c.ok) return { mode, offer: null };
  const items = c.items.slice(0, 30);
  const offer = { kind: c.kind, code: `TS${c.code}`, wrong: c.wrong, items, schema: completionSchema(items) };
  if (mode === 'shadow') { shadowLog(root, 'completions', { id: o.id ?? file, file, kind: c.kind, wrong: c.wrong, items: items.slice(0, 10) }); return { mode, offer: null }; }
  return { mode, offer };
}
