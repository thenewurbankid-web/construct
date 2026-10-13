// #936 -- research's deterministic first pass: a closed-set classifier (keywords -> one question class) and, per class,
// the Construct block that answers it with no model. Each answer is a few facts (one sentence + cites) for the ledger.
//   feature  "what is in feature orders?"                 readLineFeature (feature.mjs) summary sentences
//   atom     "is there an atom for pagination?"           matchAtoms (line-atoms)
//   imports  "what can OrdersPage import?"                importableFor (coder/reads.mjs) + staticSummarizer
//   callers  "who uses OrderCard?"                        the stored graph's whoCalls (graph/query.mjs), else the
//                                                         reverse of contextPicker's importsOf over the code files
//   defines  "where is OrderCard defined?"                an export scan over the code files
// A question no class fits, or a class whose block finds nothing, goes to the sub-agent.
import fs from 'node:fs';
import path from 'node:path';
import { readLineFeature } from '../feature.mjs';
import { readLineProject } from '../model.mjs';
import { matchAtoms } from '@line/atoms';

// typeGate.mjs's codeFiles, mirrored (it is not exported). What a file may import is the coder's own read
// (coder/reads.mjs importableFor: typeGate importableFiles plus other features' index via #935 moduleScope), so the
// research answer and the coder's scope tool never disagree.
const TS_EXT = /\.(tsx?|mts|cts)$/;
const SCAN_SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'build', 'coverage', 'line']);
/**
 * Every TypeScript file of the project outside node_modules, build output and Line's state, root-relative.
 * @param {string} root
 * @returns {string[]}
 */
function codeFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SCAN_SKIP.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (TS_EXT.test(e.name) && !e.name.endsWith('.d.ts')) out.push(rel);
    }
  };
  walk('');
  return out;
}
import { importableFor } from '../coder/reads.mjs';
import { staticSummarizer, importsOf } from '../contextPicker.mjs';
import { readLineGraph } from '../graph/build.mjs';
import { queryGraph } from '../graph/query.mjs';

export const QUESTION_CLASSES = Object.freeze(['feature', 'atom', 'imports', 'callers', 'defines']);

/** The closed keyword table, checked in this order (the first class whose pattern matches wins). */
export const CLASS_PATTERNS = Object.freeze(/** @type {[string, RegExp][]} */ ([
  ['imports', /\b(?:can|may|could|allowed to)\b[^?]*\bimport\b|\bimport(?:able)? from\b|\bimportable\b|\bwhat (?:can|may) \S+ (?:use|import)\b/i],
  ['callers', /\b(?:who|what|which(?: files?)?)\b[^?]*\b(?:uses?|imports?|calls?|renders?|depends? on)\b|\bwhere is \S+ used\b|\bused by\b|\bcallers? of\b/i],
  ['defines', /\bwhere (?:is|are) \S+ (?:defined|declared|exported)\b|\bwhich file (?:defines|exports|declares)\b|\bwhere does \S+ live\b/i],
  ['atom', /\batoms?\b|\breusable (?:logic|helper)\b|\bexisting (?:logic|helper)\b|\bis there (?:a|an) [^?]*\b(?:helper|hook|logic)\b/i],
  ['feature', /\bfeature\b|\bwhat(?:'s| is) in\b|\bsummar(?:y|ize)\b|\bwhich (?:pages|components|items|workflows)\b/i],
]));

/**
 * The question's class, or null.
 * @param {string} question
 * @returns {string|null}
 */
export function classifyQuestion(question) {
  const q = String(question ?? '');
  for (const [cls, re] of CLASS_PATTERNS) if (re.test(q)) return cls;
  return null;
}

/** A project's Line model, or null when it is not a Line project. */
function project(root) {
  try { const p = readLineProject(root); return p.isLine ? p : null; } catch { return null; }
}

/**
 * The code file a question is about: a path it names, else an identifier (OrderCard, orderCheckout) that is a code
 * file's base name.
 * @param {string} root @param {string} question @param {string[]} files
 * @returns {string|null}
 */
export function targetFile(root, question, files = codeFiles(root)) {
  const toks = String(question).match(/[\w@.\-/]+/g) ?? [];
  for (const t of toks) {
    const p = t.replace(/^\.?\//, '').replace(/[.?!,]+$/, '');
    if (p.includes('/') && files.includes(p)) return p;
  }
  const base = new Map(files.map((f) => [path.posix.basename(f).replace(/\.(tsx?|mts|cts)$/, ''), f]));
  for (const t of toks) {
    const w = t.replace(/[.?!,]+$/, '').replace(/\.(tsx?|mts|cts)$/, '');
    if (/^[A-Za-z_$][\w$]*$/.test(w) && base.has(w)) return /** @type {string} */ (base.get(w));
  }
  return null;
}

/** @typedef {{english: string, cites: string[]}} Fact */
/** @typedef {{cls: string, block: string, facts: Fact[]}} BlockAnswer */

/** @param {string} root @param {string} question @param {string} [feature] @returns {BlockAnswer|null} */
function answerFeature(root, question, feature) {
  const p = project(root);
  if (!p) return null;
  const names = p.features.map((f) => f.name);
  const name = feature && names.includes(feature) ? feature : names.find((n) => new RegExp(`\\b${n}\\b`, 'i').test(question));
  if (!name) return null;
  const d = readLineFeature(root, name);
  const f = p.features.find((x) => x.name === name);
  const files = (f?.items ?? []).map((i) => i.file);
  const facts = d.summary.sentences.map((s) => {
    const item = f?.items.find((i) => new RegExp(`^${i.name}\\b`).test(s));
    return { english: s, cites: item ? [item.file] : files.slice(0, 4) };
  });
  if (d.spec) {
    const open = d.spec.stories.flatMap((st) => st.points).filter((pt) => !pt.covered);
    facts.push({ english: `${name} has ${open.length} acceptance point${open.length === 1 ? '' : 's'} not covered yet.`, cites: [d.spec.file] });
  }
  return { cls: 'feature', block: 'readLineFeature', facts };
}

/** @param {string} _root @param {string} question @returns {BlockAnswer|null} */
function answerAtom(_root, question) {
  const m = matchAtoms(question, { limit: 2 });
  if (!m.length) return null;
  // The import path (@line/atoms/<id>) is a cite, not part of the sentence.
  return { cls: 'atom', block: 'matchAtoms', facts: m.map((a) => ({ english: a.sentence.replace(/[.?!]?$/, '.'), cites: [a.import] })) };
}

/** @param {string} root @param {string} question @returns {BlockAnswer|null} */
function answerImports(root, question) {
  const p = project(root);
  const files = codeFiles(root);
  const file = targetFile(root, question, files);
  if (!p || !file) return null;
  const allowed = importableFor(root, p.layout, file).filter((f) => f !== file && TS_EXT.test(f));
  if (!allowed.length) return null;
  /** @type {Map<string, any>} */
  const items = new Map();
  for (const l of p.library) items.set(l.file, { ...l, feature: null });
  for (const f of p.features) for (const i of f.items) items.set(i.file, { ...i, feature: f.name });
  const facts = [{ english: `${path.posix.basename(file)} may import ${allowed.length} files: the library and its own feature${p.features.length > 1 ? ', and another feature only through its index' : ''}.`, cites: [file] }];
  for (const f of allowed.slice(0, 6)) {
    const s = staticSummarizer.summarize(root, f, { item: items.get(f) });
    facts.push({ english: s.sentence.split(/(?<=[.?!])\s/)[0], cites: [f] });
  }
  return { cls: 'imports', block: 'importableFiles', facts };
}

/** @param {string} root @param {string} question @returns {BlockAnswer|null} */
function answerCallers(root, question) {
  const files = codeFiles(root);
  const file = targetFile(root, question, files);
  if (!file) return null;
  let users = null; let block = 'importsOf';
  const g = readLineGraph(root);
  const node = g?.nodes.find((n) => n.file === file);
  if (g && node) {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    users = [...new Set(queryGraph(g).whoCalls(node.id).map((id) => byId.get(id)?.file).filter(Boolean))];
    block = 'queryGraph';
  }
  if (!users || !users.length) {
    users = files.filter((f) => f !== file && importsOf(root, f).includes(file));
    block = 'importsOf';
  }
  const name = path.posix.basename(file);
  if (!users.length) return { cls: 'callers', block, facts: [{ english: `No file in the project imports ${name} yet.`, cites: [file] }] };
  return { cls: 'callers', block, facts: [{ english: `${name} is used by ${users.length} file${users.length === 1 ? '' : 's'}: ${users.slice(0, 5).map((u) => path.posix.basename(u)).join(', ')}.`, cites: [file, ...users.slice(0, 5)] }] };
}

/** @param {string} root @param {string} question @returns {BlockAnswer|null} */
function answerDefines(root, question) {
  const name = (String(question).match(/\b(?:is|are|does)\s+["'`]?([A-Za-z_$][\w$]*)/) ?? [])[1];
  if (!name) return null;
  const re = new RegExp(`^export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|class|type|interface|let)\\s+${name}\\b`, 'm');
  const hits = [];
  for (const f of codeFiles(root)) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const m = re.exec(text);
    if (m) hits.push(`${f}:${text.slice(0, m.index).split('\n').length}`);
  }
  if (!hits.length) return null;
  return { cls: 'defines', block: 'exportScan', facts: [{ english: `The export "${name}" is defined in ${hits.length === 1 ? 'one file' : `${hits.length} files`}: ${hits.slice(0, 3).map((h) => h.replace(/:\d+$/, '')).join(', ')}.`, cites: hits.slice(0, 3) }] };
}

export const BLOCK_ANSWERERS = { feature: answerFeature, atom: answerAtom, imports: answerImports, callers: answerCallers, defines: answerDefines };

/**
 * Answer a question with a block, or null (no class fits, or the block found nothing).
 * @param {string} root @param {string} question @param {{feature?: string}} [o]
 * @returns {BlockAnswer|null}
 */
export function answerWithBlocks(root, question, o = {}) {
  const cls = classifyQuestion(question);
  if (!cls) return null;
  try {
    const a = BLOCK_ANSWERERS[/** @type {keyof typeof BLOCK_ANSWERERS} */ (cls)](root, question, o.feature);
    return a && a.facts.length ? a : null;
  } catch { return null; }
}
