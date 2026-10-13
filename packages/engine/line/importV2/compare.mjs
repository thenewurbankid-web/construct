// Line Import v2, the logic-map diff (docs/line/import-v2/CONTRACT.md "MapDiff"): what an import kept, moved, changed or
// lost, unit by unit. Pure (no Node imports), so the import loop runs it in Cockpit's mock mode too; logicMap.mjs
// re-exports it with Node's hash, so a rename table given after the map was built re-hashes exactly as buildLogicMap does.
import { LOGIC_UNIT_WORDS } from './contract.mjs';

/** @typedef {import('./contract.mjs').LogicUnit} LogicUnit */
/** @typedef {import('./contract.mjs').LogicMap} LogicMap */
/** @typedef {import('./contract.mjs').MapDiff} MapDiff */
/** @typedef {Record<string, string>} RenameTable Old identifier -> new identifier. */

const quote = (/** @type {string} */ s) => `"${String(s).replace(/"/g, "'")}"`;
const tokens = (/** @type {string} */ s) => new Set(String(s).match(/[A-Za-z_$][\w$]*|\d+|[^\s\w]+/g) ?? []);

/**
 * Token similarity of two texts (Jaccard over identifiers, numbers and punctuation runs), from 0 to 1.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similarity(a, b) {
  const x = tokens(a); const y = tokens(b);
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both || 1);
}

/**
 * A function name through a rename table (each identifier in it, so `on:onClick` and `a.b` rename too).
 * @param {string} fn
 * @param {RenameTable} renames
 * @returns {string}
 */
export const renameFn = (fn, renames) => String(fn).replace(/[A-Za-z_$][\w$]*/g, (w) => renames[w] ?? w);

/**
 * The fingerprint of a unit from its parts, with the hash the map was built with.
 * @param {(s: string) => string} hash
 * @param {string} kind
 * @param {string} fn
 * @param {string} anchor
 * @param {RenameTable} [renames]
 * @returns {string}
 */
export const fingerprintWith = (hash, kind, fn, anchor, renames = {}) => hash(`${kind}\u0000${renameFn(fn, renames)}\u0000${anchor}`);

/**
 * The rename table for one before-side unit: the project-wide `renames`, then its own file's table from `fileRenames`
 * (an import step that moved and renamed that file only; another file using the old name keeps it).
 * @param {{file?: string}} u
 * @param {RenameTable} renames
 * @param {Record<string, RenameTable>} fileRenames
 * @returns {RenameTable}
 */
const tableFor = (u, renames, fileRenames) => {
  const own = u.file === undefined ? undefined : fileRenames[u.file];
  return own ? { ...renames, ...own } : renames;
};

/** Re-hash a map's fingerprints through its rename tables (old -> new), when its units still carry their anchors. */
function rehash(map, renames, fileRenames, hash) {
  const perFile = map.units.some((u) => Object.keys(tableFor(u, {}, fileRenames)).length);
  if (!Object.keys(renames).length && !perFile) return map.units;
  if (!hash) throw new TypeError('compareLogicMaps needs the map\'s hash to apply a rename table.');
  const seen = new Map();
  return map.units.map((u) => {
    if (u.anchor === undefined) return u;
    const table = tableFor(u, renames, fileRenames);
    const anchor = u.anchor.replace(/([IJ]):([A-Za-z_$][\w$]*)/g, (_m, t, name) => `${t}:${table[name] ?? name}`);
    const base = fingerprintWith(hash, u.kind, u.fn, anchor, table);
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return { ...u, fingerprint: k === 1 ? base : hash(`${base}#${k}`) };
  });
}

/**
 * The sentence for a unit that went missing.
 * @param {LogicUnit} u
 * @returns {string}
 */
export const missingSentence = (u) => `The ${LOGIC_UNIT_WORDS[u.kind] ?? u.kind} ${quote(u.detail)}${u.fn === '<module>' ? '' : ` in ${u.fn}`} (${u.file}:${u.line}) is missing after the import.`;

/**
 * Compare the map before an import step with the map after it. A unit with the same fingerprint is kept (same file)
 * or moved (another file). Of the rest, a before unit and an after unit of the same kind in the same function whose
 * text is alike are one unit that changed; a before unit with no partner is missing (with one sentence), an after
 * unit with none is added. `renames` (old -> new) maps the before side's identifiers, so a renamed component keeps
 * its units; `fileRenames` (before-side file -> table) does the same for one file only (an import step that moved and
 * renamed that file, #875: the same name in another file is left alone). Either needs `hash`, the one the map was built
 * with (logicMap.mjs passes it).
 * @param {LogicMap} before
 * @param {LogicMap} after
 * @param {{renames?: RenameTable, fileRenames?: Record<string, RenameTable>, threshold?: number, hash?: (s: string) => string}} [options] `threshold` is the least token similarity for "changed" (default 0.3).
 * @returns {MapDiff}
 */
export function compareLogicMaps(before, after, { renames = {}, fileRenames = {}, threshold = 0.3, hash } = {}) {
  const b = rehash(before, renames, fileRenames, hash);
  const byFp = new Map();
  for (const u of after.units) if (!byFp.has(u.fingerprint)) byFp.set(u.fingerprint, u);
  /** @type {MapDiff} */
  const diff = { kept: [], moved: [], missing: [], changed: [], added: [] };
  const used = new Set();
  const left = [];
  /** @type {[LogicUnit, LogicUnit][]} */
  const pairs = [];
  b.forEach((u, i) => {
    const a = byFp.get(u.fingerprint);
    if (a && !used.has(a)) {
      used.add(a);
      pairs.push([before.units[i], a]);
      if (a.file === u.file) diff.kept.push(a);
      else diff.moved.push({ from: before.units[i], to: a });
    } else left.push(i);
  });
  const rest = after.units.filter((u) => !used.has(u));
  for (const i of left) {
    const u = before.units[i];
    const fn = renameFn(u.fn, tableFor(u, renames, fileRenames));
    let best = null; let bestScore = threshold;
    for (const a of rest) {
      if (used.has(a) || a.kind !== u.kind || a.fn !== fn) continue;
      const score = similarity(u.anchor ?? u.detail, a.anchor ?? a.detail);
      if (score >= bestScore) { best = a; bestScore = score; }
    }
    if (best) {
      used.add(best);
      pairs.push([u, best]);
      diff.changed.push({ before: u, after: best, sentence: `The ${LOGIC_UNIT_WORDS[u.kind]} in ${fn} changed from ${quote(u.detail)} to ${quote(best.detail)}.` });
    } else {
      diff.missing.push({ ...u, sentence: missingSentence(u) });
    }
  }
  diff.added = rest.filter((a) => !used.has(a));
  diff.complexity = complexityDeltas(pairs);
  return diff;
}

const SIGNATURE_FIELDS = ['cyclomatic', 'cognitive', 'maxNesting', 'params', 'returns'];

/**
 * #923: one entry per after-side function whose complexity signature differs across its matched (kept, moved or
 * changed) units, with the per-field delta (after minus before; null where either side has no number, as cognitive
 * before fallow has run). Units without a signature are skipped.
 * @param {[LogicUnit, LogicUnit][]} pairs Matched before/after units.
 * @returns {import('./contract.mjs').ComplexityDelta[]}
 */
function complexityDeltas(pairs) {
  const out = [];
  const seen = new Set();
  for (const [x, y] of pairs) {
    const key = `${y.file}#${y.fn}`;
    if (!x.complexity || !y.complexity || seen.has(key)) continue;
    seen.add(key);
    // a field either side lacks (cognitive before fallow ran) has a null delta
    const delta = /** @type {any} */ (Object.fromEntries(SIGNATURE_FIELDS.map((f) => [f, typeof y.complexity[f] === 'number' && typeof x.complexity[f] === 'number' ? y.complexity[f] - x.complexity[f] : null])));
    if (SIGNATURE_FIELDS.some((f) => delta[f])) out.push({ file: y.file, fn: y.fn, before: x.complexity, after: y.complexity, delta });
  }
  return out;
}
