// #940 Smith System 1 -- the pure half of the data generator: pair schema, code/English normalization, stable ids,
// hash splits, dedupe and the eval-leak guard. No file system, no Smith, no model: everything here is a function of
// its arguments, so the same pairs in always give the same dataset out (the determinism the tests check).
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

/** TypeScript, from the repo's own install (resolved upward from this file, like every other tool here). */
export const ts = createRequire(import.meta.url)('typescript');

/** Where a pair came from. `ledger` is the held-out eval set only. */
export const SOURCES = Object.freeze(['atoms', 'typed-contracts', 'probe', 'smith', 'ledger']);
/** Which side the pair was written from: `js->en` = the code is the given, the English its translation. */
export const DIRECTIONS = Object.freeze(['js->en', 'en->js']);
/** Dedupe keeps the first source in this order (hand-written English beats generated English). */
export const SOURCE_PRIORITY = Object.freeze({ atoms: 0, 'typed-contracts': 1, probe: 2, smith: 3 });
/** train / val / test cut points on a 0..99 bucket. */
export const SPLIT_CUTS = Object.freeze({ train: 80, val: 90 });

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Code with comments and whitespace removed: the TypeScript scanner's tokens joined by one space. Two pieces of code
 * that differ only in comments, blank lines or indentation normalize the same.
 * @param {string} code
 */
export function normalizeCode(code) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ true, ts.LanguageVariant.JSX, String(code ?? ''));
  const out = [];
  for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan()) out.push(scanner.getTokenText());
  return out.join(' ');
}

/** English lowercased, whitespace collapsed, trailing period dropped. */
export const normalizeEnglish = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');

/** Stable pair id: source + direction + normalized code + normalized English. */
export const pairId = (p) => sha256(`${p.source}\n${p.direction}\n${normalizeCode(p.code)}\n${normalizeEnglish(p.english)}`).slice(0, 16);

/**
 * The split a code lands in, from the hash of its normalized form only (so one code is never in two splits, and
 * adding pairs never moves an existing one).
 * @param {string} code
 * @returns {'train'|'val'|'test'}
 */
export function splitOf(code) {
  const bucket = parseInt(sha256(`split\n${normalizeCode(code)}`).slice(0, 8), 16) % 100;
  return bucket < SPLIT_CUTS.train ? 'train' : bucket < SPLIT_CUTS.val ? 'val' : 'test';
}

/**
 * Throws unless `p` is a well-formed pair.
 * @param {any} p
 */
export function assertPair(p) {
  const keys = ['id', 'source', 'direction', 'code', 'english', 'meta'];
  if (!p || typeof p !== 'object') throw new Error('pair: not an object');
  const extra = Object.keys(p).filter((k) => !keys.includes(k));
  if (extra.length) throw new Error(`pair ${p.id}: unknown keys ${extra.join(', ')}`);
  if (typeof p.id !== 'string' || !/^[0-9a-f]{16}$/.test(p.id)) throw new Error(`pair: bad id ${p.id}`);
  if (!SOURCES.includes(p.source)) throw new Error(`pair ${p.id}: bad source ${p.source}`);
  if (!DIRECTIONS.includes(p.direction)) throw new Error(`pair ${p.id}: bad direction ${p.direction}`);
  if (typeof p.code !== 'string' || !normalizeCode(p.code)) throw new Error(`pair ${p.id}: empty code`);
  if (typeof p.english !== 'string' || !normalizeEnglish(p.english)) throw new Error(`pair ${p.id}: empty english`);
  if (!p.meta || typeof p.meta !== 'object' || Array.isArray(p.meta)) throw new Error(`pair ${p.id}: meta is not an object`);
  if (p.id !== pairId(p)) throw new Error(`pair ${p.id}: id does not match its content`);
  return p;
}

/**
 * A pair with its id filled in. Key order is fixed so JSON output is byte-stable.
 * @param {{source: string, direction: string, code: string, english: string, meta?: object}} p
 */
export const makePair = (p) => {
  const base = { source: p.source, direction: p.direction, code: p.code, english: p.english };
  return { id: pairId(base), ...base, meta: sortKeys(p.meta ?? {}) };
};

/** A copy of a plain object with its keys sorted (recursively), for byte-stable JSON. */
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/**
 * The eval set's leak keys: every eval code (and every file and function it was assembled from, `meta.parts`), every
 * eval English (normalized) and every eval function as `folder#name` (`meta.nameKeys`). A pair matching any of them
 * is held out.
 * @param {object[]} evalPairs
 */
export function leakKeys(evalPairs) {
  const code = new Set();
  const english = new Set();
  const names = new Set();
  for (const e of evalPairs) {
    if (e.code) code.add(normalizeCode(e.code));
    for (const part of e.meta?.parts ?? []) code.add(normalizeCode(part));
    for (const n of e.meta?.nameKeys ?? []) names.add(n);
    english.add(normalizeEnglish(e.english));
  }
  code.delete('');
  return { code, english, names };
}

/** A function's `folder#name` key: the folder of its repo-relative file, then its name. */
export const nameKey = (file, name) => `${path.posix.dirname(file)}#${name}`;

/**
 * True when a pair shares code or English with the eval set, or is a function with the same name in the same folder
 * as an eval function (the same component in a sibling file, say). A same-named function in another folder is not a
 * leak: a `Button` elsewhere stays in training.
 */
export const leaks = (p, keys) => keys.code.has(normalizeCode(p.code)) || keys.english.has(normalizeEnglish(p.english)) || (typeof p.meta?.name === 'string' && typeof p.meta?.file === 'string' && keys.names.has(nameKey(p.meta.file, p.meta.name)));

/**
 * The whole dataset from raw candidate pairs and the eval pairs: leak-filter, dedupe by normalized code (source
 * priority, then id), split by code hash, sort by id. Pure.
 * @param {object[]} candidates  makePair() outputs from atoms / typed-contracts / probe / smith.
 * @param {object[]} evalPairs   makePair() outputs with source "ledger".
 * @param {object} [extraStats]  merged into stats (collector counts such as smithEmpty).
 */
export function buildDataset(candidates, evalPairs, extraStats = {}) {
  const keys = leakKeys(evalPairs);
  const perSource = {};
  const bump = (src, k) => {
    perSource[src] ??= { candidates: 0, leakHeldOut: 0, duplicates: 0, kept: 0 };
    perSource[src][k] += 1;
  };
  const ordered = [...candidates].sort((a, b) => (SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set();
  const kept = [];
  for (const p of ordered) {
    assertPair(p);
    bump(p.source, 'candidates');
    if (leaks(p, keys)) { bump(p.source, 'leakHeldOut'); continue; }
    const k = normalizeCode(p.code);
    if (seen.has(k)) { bump(p.source, 'duplicates'); continue; }
    seen.add(k);
    bump(p.source, 'kept');
    kept.push({ ...p, meta: sortKeys({ ...p.meta, split: splitOf(p.code) }) });
  }
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const splits = { train: [], val: [], test: [] };
  for (const p of kept) splits[p.meta.split].push(p);
  const evalOut = [...evalPairs].map((p) => assertPair({ ...p, meta: sortKeys({ ...p.meta, split: 'eval' }) })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const stats = sortKeys({
    ...extraStats,
    perSource,
    splits: { train: splits.train.length, val: splits.val.length, test: splits.test.length, eval: evalOut.length },
    total: kept.length,
  });
  return { ...splits, eval: evalOut, stats };
}

/** JSONL text, one pair per line, trailing newline. */
export const toJsonl = (pairs) => pairs.map((p) => JSON.stringify(p)).join('\n') + (pairs.length ? '\n' : '');
