// cl1 -- Line picks the context, not Claude. Given a miss (a refusal from the session trace) Line finds the related
// items and files statically: the files the refusal names, the request's own files and items, each item's base link,
// the files it imports and the files that import it, the fixtures of the same feature or name, the rules involved and
// the plan steps around it. Candidates are ranked by a fixed score; when more of them tie at the cut than fit, a
// picker (jev, @mx/reason) may choose among exactly those, else the static order stands. Each file comes with a
// summary from a swappable summarizer (the static one here; cs1's summarizer plugs in with the same interface).
// Pure read: nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import { readLineProject } from './model.mjs';

/**
 * The summarizer interface: one plain-English sentence for one file, and who wrote it.
 * @typedef {{name: string, summarize: (root: string, file: string, hint?: {item?: any}) => {sentence: string, via: string}}} Summarizer
 */

const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
const posix = (p) => p.split(path.sep).join('/');

/** The first sentence of a file's leading comment block (pragma lines like @line-base skipped), or null. */
function headerSentence(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:\/\/+|\/?\*+\/?)\s?(.*)$/.exec(line);
    if (!m) break;
    const t = m[1].trim();
    if (t && !t.startsWith('@')) lines.push(t);
  }
  const joined = lines.join(' ');
  const first = /^(.*?[.?!])(\s|$)/.exec(joined);
  return first ? first[1] : joined ? `${joined}.` : null;
}

/** The static summarizer: what the item is (from the Line model), its header's first sentence, size and exports. */
export const staticSummarizer = Object.freeze({
  name: 'static',
  summarize(root, file, hint = {}) {
    const text = read(root, file);
    if (text === null) return { sentence: `${file} is not in the project any more.`, via: 'static' };
    const item = hint.item;
    const kind = item ? item.kind.replace(/s$/, '') : null;
    const what = item
      ? item.feature ? `a ${kind} of feature ${item.feature}${item.base?.libraryId ? `, based on library ${item.base.libraryId}` : ', with no working base link'}` : `a library ${kind}`
      : 'a file';
    const exports = [...text.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    const head = headerSentence(text);
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return { sentence: `${path.posix.basename(file)} is ${what}, ${lines} lines${exports.length ? `, exporting ${exports.slice(0, 4).join(', ')}` : ''}.${head ? ` ${head}` : ''}`, via: 'static' };
  },
});

/** Relative imports of a code file, resolved to root-relative files that exist. */
export function importsOf(root, file, text = read(root, file)) {
  if (text === null) return [];
  const out = new Set();
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = posix(path.normalize(path.join(path.dirname(file), m[1])));
    const hit = ['', ...CODE_EXT, ...CODE_EXT.map((e) => `/index${e}`)].map((e) => base + e).find((c) => !c.startsWith('..') && fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile());
    if (hit) out.add(hit);
  }
  return [...out];
}

/**
 * Pick the context for one miss.
 * @param {string} root
 * @param {{miss: import('./contract.mjs').TraceEvent, events?: import('./contract.mjs').TraceEvent[]}} input
 * @param {{limit?: number, summarizer?: Summarizer, pick?: (tied: {file: string, why: string, score: number}[], slots: number) => Promise<string[]> | string[], project?: any}} [o]
 *   `pick`: jev's choice among the candidates tied at the cut (file names, at most `slots`); omitted = static order.
 * @returns {Promise<import('./contract.mjs').ContextPick>}
 */
export async function pickContext(root, { miss, events = [] }, { limit = 6, summarizer = staticSummarizer, pick, project } = {}) {
  let p = project;
  if (!p) { try { p = readLineProject(root); } catch { p = { library: [], features: [] }; } }
  const featureItems = p.features.flatMap((f) => f.items);
  const byFile = new Map([...p.library.map((i) => [i.file, i]), ...featureItems.map((i) => [i.file, i])]);
  const libById = new Map(p.library.map((i) => [i.id, i]));
  const itemById = new Map(featureItems.map((i) => [i.id, i]));

  /** @type {Map<string, {file: string, why: string, score: number}>} */
  const cand = new Map();
  const add = (file, score, why) => {
    if (!file || read(root, file) === null) return;
    const had = cand.get(file);
    if (!had || had.score < score) cand.set(file, { file, why, score });
  };
  const args = /** @type {Record<string, any>} */ (miss.args ?? {});
  const seeds = new Set(miss.files ?? []);
  for (const k of ['file', 'from', 'to']) if (typeof args[k] === 'string') seeds.add(args[k]);
  if (typeof args.featureItemId === 'string' && itemById.get(args.featureItemId)) seeds.add(itemById.get(args.featureItemId).file);
  for (const f of seeds) add(f, 5, `The refused request names ${path.posix.basename(f)}.`);
  // The refused request's own code (a fragment) may import what the file does not yet: those files belong too.
  if (typeof args.code === 'string' && typeof args.file === 'string') for (const imp of importsOf(root, args.file, args.code)) add(imp, 4, `The refused code imports ${path.posix.basename(imp)}.`);
  if (typeof args.libraryId === 'string' && libById.get(args.libraryId)) add(libById.get(args.libraryId).file, 4, `The request builds on library ${args.libraryId}.`);

  // One hop out from each seed: its base, what it imports, what imports it, fixtures of the same feature or name.
  const allCode = [...byFile.keys()].filter((f) => CODE_EXT.some((e) => f.endsWith(e)));
  for (const f of seeds) {
    const item = byFile.get(f);
    const name = path.posix.basename(f);
    if (item?.base?.libraryId && libById.get(item.base.libraryId)) add(libById.get(item.base.libraryId).file, 3, `${name} is based on library ${item.base.libraryId}.`);
    for (const imp of importsOf(root, f)) add(imp, 3, `${name} imports ${path.posix.basename(imp)}.`);
    for (const other of allCode) if (other !== f && importsOf(root, other).includes(f)) add(other, 2, `${path.posix.basename(other)} imports ${name}.`);
    const stem = name.replace(/\.[^.]+$/, '').toLowerCase();
    for (const fx of [...p.library, ...featureItems].filter((i) => i.kind === 'fixtures')) {
      if ((item?.feature && fx.feature === item.feature) || fx.name.toLowerCase().includes(stem) || stem.includes(fx.name.toLowerCase())) add(fx.file, 1, `Fixture ${fx.name} belongs with ${name}.`);
    }
  }

  const ranked = [...cand.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  let chosen = ranked.slice(0, limit);
  let via = /** @type {'static'|'jev'} */ ('static');
  const cut = ranked[limit - 1]?.score;
  const ambiguous = ranked.length > limit && ranked[limit].score === cut;
  if (ambiguous && typeof pick === 'function') {
    const sure = ranked.filter((c) => c.score > cut);
    const tied = ranked.filter((c) => c.score === cut);
    const slots = limit - sure.length;
    try {
      const names = (await pick(tied, slots)).filter((n) => tied.some((t) => t.file === n)).slice(0, slots);
      if (names.length) { chosen = [...sure, ...tied.filter((t) => names.includes(t.file))]; via = 'jev'; }
    } catch { /* jev is down: the static order stands */ }
  }

  const items = [];
  for (const c of chosen) {
    const it = byFile.get(c.file);
    if (it) items.push({ id: it.id, kind: it.feature ? 'feature-item' : it.kind === 'fixtures' ? 'fixture' : 'library-item', why: c.why });
  }
  for (const r of miss.rules ?? []) items.push({ id: r, kind: 'rule', why: `Construct refused with ${r}.` });
  const around = events.filter((e) => e.trace === miss.trace && e.stepId && (e.stepId === miss.stepId || e.fixOf === miss.stepId));
  for (const id of [...new Set(around.map((e) => e.stepId))]) items.push({ id, kind: 'plan-step', why: id === miss.stepId ? 'The step Construct refused.' : 'A step that tried to fix it.' });

  return {
    items,
    files: chosen.map((c) => ({ ...c, summary: summarizer.summarize(root, c.file, { item: byFile.get(c.file) }) })),
    rules: [...(miss.rules ?? [])],
    via,
    ambiguous,
  };
}
