// #937 (epic #934) -- the coder's read tools: thin English wrappers over blocks Construct already has, so a small model
// reads a feature, a file's import scope and the logic atoms as a few sentences instead of raw code. Each is a registry
// entry (toolRegistry.mjs: line.featureSummary, line.scope, line.atoms; mcp feature_summary, scope, atoms).
//
//   featureSummary(root, {name})       readLineFeature (feature.mjs): summary sentences, each item with its base and the
//                                      files it imports, spec coverage, findings; one compact English text
//   scopeOf(root, {file})              what `file` may import (importableFor), each with its import specifier, a one-
//                                      sentence summary (contextPicker staticSummarizer) and its export names (spec.mjs
//                                      moduleContract)
//   atomsFor({request})                matchAtoms (@line/atoms) + each atom's inputs and outputs sentences, and the
//                                      plan_add line.useAtom call that copies it in
//   selectReadTools({openStep, point, kind, lastRefusal})   the 3-6 read tools (registry ids) a builder turn needs
//
// Static and deterministic: no model, no network, nothing written.
import fs from 'node:fs';
import path from 'node:path';
import { LineOpError } from '../contract.mjs';
import { readLineProject } from '../model.mjs';
import { readLineFeature } from '../feature.mjs';
import { staticSummarizer } from '../contextPicker.mjs';
import { moduleContract } from '../spec.mjs';
import { importableFiles } from '../typeGate.mjs';
import { moduleScope } from '../scope/moduleScope.mjs';
import { matchRequest } from '../traceMatch.mjs';
import { matchAtoms, getAtom, listAtoms } from '@line/atoms';
import { lspMode } from '../lsp/profile.mjs';
import { gatherSymbols } from './symbols.mjs';

const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const MAX_SCOPE = 40;
const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
const noExt = (f) => f.replace(/\.[^./]+$/, '');
const end = (s) => (/[.?!]$/.test(s) ? s : `${s}.`);

/**
 * A project-relative file a client named, checked: never absolute, never `..`, never a home path.
 * @param {unknown} file
 * @returns {string}
 * @throws {LineOpError} BAD_REQUEST
 */
export function projectFile(file) {
  const f = String(file ?? '').trim().replace(/^\.\//, '');
  if (!f || path.isAbsolute(f) || /^~|^[A-Za-z]:/.test(f) || f.split(/[\\/]/).includes('..')) throw new LineOpError('Name a project file by its project-relative path, for example features/loans/pages/LoansPage.tsx.', 'BAD_REQUEST');
  return f;
}

/** Whether the project maps `@/*` to its root (Next.js' default), so imports read `@/library/...`. */
function hasAtAlias(root) {
  const t = read(root, 'tsconfig.json');
  return t !== null && /"@\/\*"\s*:\s*\[\s*"\.\/\*"/.test(t);
}

/** The specifier `file` imports `target` by: `@/<target>` when the project maps `@/*`, else a relative path. */
function specifierFor(root, file, target) {
  if (hasAtAlias(root)) return `@/${noExt(target)}`;
  let s = path.posix.relative(path.posix.dirname(file), noExt(target));
  if (!s.startsWith('.')) s = `./${s}`;
  return s;
}

/**
 * The project files a code file imports (relative and `@/` specifiers), resolved to files that exist.
 * @param {string} root The project root.
 * @param {string} file The root-relative code file.
 * @returns {string[]} Root-relative files.
 */
export function importsOfFile(root, file) {
  const text = read(root, file);
  if (text === null) return [];
  const out = new Set();
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]((?:\.{1,2}\/|@\/)[^'"]+)['"]/g)) {
    const base = m[1].startsWith('@/') ? m[1].slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
    const hit = ['', ...CODE_EXT, ...CODE_EXT.map((e) => `/index${e}`)].map((e) => base + e)
      .find((c) => !c.startsWith('..') && fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile());
    if (hit) out.add(hit);
  }
  return [...out];
}

/**
 * One feature in compact English: what it has, each item with its base and its imports, spec coverage, findings.
 * @param {string} root
 * @param {{name: string}} a
 * @returns {{ok: true, name: string, lines: string[], sentence: string}}
 */
export function featureSummary(root, { name }) {
  const d = readLineFeature(root, String(name ?? ''));
  const lines = [...d.summary.sentences];
  for (const items of Object.values(d.items)) {
    for (const it of items) {
      const imports = importsOfFile(root, it.file);
      lines.push(end(`${it.name} (${it.file})${it.base?.libraryId ? ` is based on ${it.base.libraryId}` : ' has no base'}${imports.length ? `; imports ${imports.join(', ')}` : ''}${it.status === 'problem' ? '; it has a problem' : ''}`));
    }
  }
  if (d.spec) {
    const points = d.spec.stories.flatMap((s) => s.points);
    const open = points.filter((p) => !p.covered);
    lines.push(`Spec ${d.spec.file}: ${points.length - open.length} of ${points.length} points covered.`);
    for (const p of open.slice(0, 8)) lines.push(end(`Open: ${p.id} ${p.text}`));
  } else lines.push(`${d.name} has no spec.md.`);
  for (const f of d.findings.slice(0, 6)) lines.push(end(`${f.rule} at ${f.file}:${f.line}: ${f.sentence.replace(/[.?!]$/, '')}`));
  if (d.findings.length > 6) lines.push(`${d.findings.length - 6} more findings.`);
  return { ok: true, name: d.name, lines, sentence: lines.join('\n') };
}

/**
 * The files `file` may import: the library and the file's own feature (typeGate importableFiles), plus, for a feature
 * file, every other feature's public index as #935's `moduleScope(root, feature)` reads it (the one way into a feature).
 * @param {string} root @param {{library: string, features: string}} layout @param {string} file
 * @returns {string[]}
 */
export function importableFor(root, layout, file) {
  const fp = `${layout.features}/`;
  const own = file.startsWith(fp) ? file.slice(fp.length).split('/')[0] : null;
  const local = importableFiles(root, layout, file).filter((r) => !r.startsWith(fp) || (own && r.startsWith(`${fp}${own}/`)));
  if (!own) return local;
  let others = [];
  try { others = fs.readdirSync(path.join(root, layout.features), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== own).map((d) => d.name).sort(); } catch { others = []; }
  const indexes = others.map((o) => { try { return moduleScope(root, o).index; } catch { return null; } }).filter((x) => typeof x === 'string');
  return [...local, ...indexes];
}

/**
 * What one file may import, in English: each importable file's specifier, one sentence and its exports.
 * @param {string} root
 * @param {{file: string}} a
 * @returns {{ok: true, file: string, entries: {file: string, import: string, sentence: string, exports: string[]}[], sentence: string}}
 */
export function scopeOf(root, { file }) {
  const f = projectFile(file);
  const p = readLineProject(root);
  if (!p.isLine) throw new LineOpError('This project is not a Line project, so it has no import scope.', 'NOT_LINE');
  /** @type {Map<string, any>} */
  const items = new Map(/** @type {[string, any][]} */ ([...p.library.map((l) => [l.file, { kind: l.kind }]), ...p.features.flatMap((x) => x.items.map((i) => [i.file, i]))]));
  const own = f.startsWith(`${p.layout.features}/`) ? `${p.layout.features}/${f.split('/')[p.layout.features.split('/').length]}/` : null;
  const all = importableFor(root, p.layout, f).filter((x) => x !== f && !TEST_FILE.test(x));
  // Own feature first, then the library; each group in path order.
  const ordered = [...all.filter((x) => own && x.startsWith(own)).sort(), ...all.filter((x) => !(own && x.startsWith(own))).sort()];
  const entries = ordered.slice(0, MAX_SCOPE).map((x) => {
    // The summarizer names up to 4 exports; the full list follows, so its own copy is dropped.
    const sentence = staticSummarizer.summarize(root, x, { item: items.get(x) }).sentence.replace(/, exporting [^.]*\./, '.');
    let exports = [];
    try { exports = moduleContract(path.join(root, x)).exports; } catch { exports = []; }
    return { file: x, import: specifierFor(root, f, x), sentence, exports };
  });
  // #945 lsp.gatherer on: each export with its exact type (Line LSP definition + quickInfo), not only its name. A read
  // never writes, so shadow here is the plain list (the research read_file logs the shadow rows).
  if (lspMode(root, 'gatherer') === 'on' && fs.existsSync(path.join(root, 'tsconfig.json'))) {
    for (const e of entries) { try { const g = gatherSymbols(root, [e.file]); if (g.lines.length) e.types = g.lines.map((l) => l.replace(/^\S+ /, '')); } catch { /* names only */ } }
  }
  const head = `${f} may import ${ordered.length} file${ordered.length === 1 ? '' : 's'}: ${own ? `its own feature (${own.slice(0, -1)}) and ` : ''}the library${ordered.length > MAX_SCOPE ? ` (the first ${MAX_SCOPE} are listed)` : ''}.${own ? ' Another feature only through its index (features/<name>/index.ts), never its inner files.' : ' Nothing else: a feature is never imported.'}`;
  const lines = entries.map((e) => `- ${e.import}: ${e.sentence}${e.types ? ` Exports: ${e.types.join('; ')}.` : e.exports.length ? ` Exports: ${e.exports.join(', ')}.` : ''}`);
  return { ok: true, file: f, entries, sentence: [head, ...lines].join('\n') };
}

/**
 * The atoms a request means, with what each takes and gives, and the step that copies it into the library.
 * @param {{request: string}} a
 * @returns {{ok: true, atoms: {id: string, sentence: string}[], sentence: string}}
 */
export function atomsFor({ request }) {
  const matches = matchAtoms(String(request ?? ''), { limit: 3 });
  if (!matches.length) {
    const all = listAtoms().map((a) => `${a.id} (${a.title.toLowerCase()})`);
    return { ok: true, atoms: [], sentence: `No atom fits "${String(request ?? '').slice(0, 120)}". The atoms are: ${all.join(', ')}.` };
  }
  const atoms = matches.map((m) => {
    const a = getAtom(m.id);
    const io = (xs) => (xs ?? []).map((x) => `${x.name}${x.optional ? ' (optional)' : ''}: ${x.sentence.replace(/[.?!]$/, '')}`).join('; ');
    const sentence = [end(`${m.id}: ${m.sentence.replace(/[.?!]$/, '')}`), a ? `Inputs: ${io(a.inputs) || 'none'}.` : '', a ? `Outputs: ${io(a.outputs) || 'none'}.` : '',
      `Add it with plan_add {"tool": "line.useAtom", "args": {"atom": "${m.id}"}}.`].filter(Boolean).join(' ');
    return { id: m.id, sentence };
  });
  return { ok: true, atoms, sentence: atoms.map((x) => x.sentence).join('\n') };
}

// ------------------------------------------------------------------------------------------------- per-turn selection
/** What each write tool Trace names needs to be read first (registry ids). */
const READS_FOR_TOOL = Object.freeze({
  'line.setCode': ['line.scope', 'line.featureSummary'],
  'line.baseOn': ['line.scope', 'line.featureSummary'],
  'line.addRoute': ['line.featureSummary', 'line.pageTree'],
  'line.createFeature': ['line.atoms', 'line.trace'],
  'line.useAtom': ['line.atoms', 'line.scope'],
  'line.setPageProp': ['line.pageTree'],
  'line.bindInteraction': ['line.pageBinding'],
  'line.bindPart': ['line.pageBinding'],
  'line.setFragment': ['line.fragments'],
  'line.fix': ['line.featureSummary', 'line.scope'],
  'line.promote': ['line.featureSummary'],
  'line.project': ['line.featureSummary'],
});
/** What each open-work kind (openWork.mjs) needs, first first. */
const READS_FOR_KIND = Object.freeze({
  page: ['line.featureSummary', 'line.scope', 'line.pageTree', 'line.pageBinding'],
  data: ['line.scope', 'line.featureSummary', 'line.atoms'],
  fixture: ['line.scope', 'line.featureSummary', 'line.atoms'],
  point: ['line.featureSummary', 'line.scope', 'line.atoms'],
  route: ['line.featureSummary', 'line.pageTree', 'line.scope'],
  spec: ['line.featureSummary', 'line.atoms', 'line.trace'],
  feature: ['line.atoms', 'line.trace', 'line.workflows'],
});
const DEFAULT_READS = Object.freeze(['line.featureSummary', 'line.scope', 'line.atoms']);
/** A refusal about imports or types: what the file may import comes first. */
const IMPORT_REFUSAL = /\b(cannot find module|has no exported member|import|imports|TS2307|TS2305|TS2724|not exported)\b/i;

/**
 * The read tools one builder turn is offered: 3 to 6 registry ids, deterministic, most useful first.
 * Order: a refusal's need (TYPE_ERROR or an import problem -> line.scope; a rule refusal -> line.scope and
 * line.featureSummary), then the open step's tool, then the open item's kind, then what Trace (line.trace's static
 * matcher) says the point's or step's words need; padded from line.featureSummary, line.scope, line.atoms.
 * @param {{openStep?: {kind?: string, file?: string, sentence?: string, point?: {text?: string}, step?: {tool?: string, args?: any}} | null,
 *   point?: {id?: string, text?: string} | null, kind?: string | null, lastRefusal?: {code?: string|null, sentence?: string} | null}} o
 * @returns {string[]}
 */
export function selectReadTools({ openStep = null, point = null, kind = null, lastRefusal = null } = {}) {
  const out = [];
  const add = (...ids) => { for (const id of ids) if (!out.includes(id)) out.push(id); };
  const code = String(lastRefusal?.code ?? '');
  const said = String(lastRefusal?.sentence ?? '');
  if (code === 'TYPE_ERROR' || (code && IMPORT_REFUSAL.test(said))) add('line.scope');
  else if (code && /^(LINE-|RULE|REFUSED|CHECKS?_FAILED)/.test(code)) add('line.scope', 'line.featureSummary');
  const tool = openStep?.step?.tool;
  const file = String(openStep?.file ?? openStep?.step?.args?.file ?? openStep?.step?.args?.page ?? '');
  if (tool && READS_FOR_TOOL[tool]) add(...READS_FOR_TOOL[tool]);
  if (tool === 'line.setCode' && /\/pages\//.test(file)) add('line.pageTree');
  const k = kind ?? openStep?.kind ?? null;
  if (k && READS_FOR_KIND[k]) add(...READS_FOR_KIND[k]);
  for (const m of matchRequest(String(point?.text ?? openStep?.point?.text ?? openStep?.sentence ?? ''))) add(...(READS_FOR_TOOL[m.toolId] ?? []));
  for (const id of DEFAULT_READS) { if (out.length >= 3) break; add(id); }
  return out.slice(0, 6);
}
