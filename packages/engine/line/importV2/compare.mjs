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

/** Re-hash a map's fingerprints through a rename table (old -> new), when its units still carry their anchors. */
function rehash(map, renames, hash) {
  if (!Object.keys(renames).length) return map.units;
  if (!hash) throw new TypeError('compareLogicMaps needs the map\'s hash to apply a rename table.');
  const seen = new Map();
  return map.units.map((u) => {
    if (u.anchor === undefined) return u;
    const anchor = u.anchor.replace(/([IJ]):([A-Za-z_$][\w$]*)/g, (_m, t, name) => `${t}:${renames[name] ?? name}`);
    const base = fingerprintWith(hash, u.kind, u.fn, anchor, renames);
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
export const missingSentence = (u) => `The ${LOGIC_UNIT_WORDS[u.kind] ?? u.kind} ${quote(u.detail)} in ${u.fn} (${u.file}:${u.line}) is missing after the import.`;

/**
 * Compare the map before an import step with the map after it. A unit with the same fingerprint is kept (same file)
 * or moved (another file). Of the rest, a before unit and an after unit of the same kind in the same function whose
 * text is alike are one unit that changed; a before unit with no partner is missing (with one sentence), an after
 * unit with none is added. `renames` (old -> new) maps the before side's identifiers, so a renamed component keeps
 * its units; it needs `hash`, the one the map was built with (logicMap.mjs passes it).
 * @param {LogicMap} before
 * @param {LogicMap} after
 * @param {{renames?: RenameTable, threshold?: number, hash?: (s: string) => string}} [options] `threshold` is the least token similarity for "changed" (default 0.3).
 * @returns {MapDiff}
 */
export function compareLogicMaps(before, after, { renames = {}, threshold = 0.3, hash } = {}) {
  const b = rehash(before, renames, hash);
  const byFp = new Map();
  for (const u of after.units) if (!byFp.has(u.fingerprint)) byFp.set(u.fingerprint, u);
  /** @type {MapDiff} */
  const diff = { kept: [], moved: [], missing: [], changed: [], added: [] };
  const used = new Set();
  const left = [];
  b.forEach((u, i) => {
    const a = byFp.get(u.fingerprint);
    if (a && !used.has(a)) {
      used.add(a);
      if (a.file === u.file) diff.kept.push(a);
      else diff.moved.push({ from: before.units[i], to: a });
    } else left.push(i);
  });
  const rest = after.units.filter((u) => !used.has(u));
  for (const i of left) {
    const u = before.units[i];
    const fn = renameFn(u.fn, renames);
    let best = null; let bestScore = threshold;
    for (const a of rest) {
      if (used.has(a) || a.kind !== u.kind || a.fn !== fn) continue;
      const score = similarity(u.anchor ?? u.detail, a.anchor ?? a.detail);
      if (score >= bestScore) { best = a; bestScore = score; }
    }
    if (best) {
      used.add(best);
      diff.changed.push({ before: u, after: best, sentence: `The ${LOGIC_UNIT_WORDS[u.kind]} in ${fn} changed from ${quote(u.detail)} to ${quote(best.detail)}.` });
    } else {
      diff.missing.push({ ...u, sentence: missingSentence(u) });
    }
  }
  diff.added = rest.filter((a) => !used.has(a));
  return diff;
}
