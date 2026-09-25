// #645 (epic #616) -- the local embedding classifier: a nearest-prototype scorer whose DATA is a plain `prototypes.json`
// (trained or curated elsewhere, imported and verified like every model, docs/TRAIN-ELSEWHERE.md) and whose EMBEDDING is a fixed,
// dependency-free function (`embed.v1`: signed hashing of character n-grams of the word, the fastText subword idea, L2-normalised).
// It is a decision provider like any other (docs/DECISION-PROVIDERS.md): it gets the fixed-size summary and answers one enabled
// option, a score and a runner-up, or null (an honest "I do not know") when the question is not one it has prototypes for, the
// question quotes no word, the nearest prototype is not similar enough, or two options are too close to call.
//
//   embedText(text, embedder)               the unit vector of a word or phrase (`embed.v1`); null when it holds no letters or digits
//   subjectOf(summary)                      the word a question is about: its first quoted phrase, or null
//   validatePrototypesModel(json)           the shape and the size of a `prototypes.json`, without trusting it
//   compilePrototypesModel(model)           embed every prototype once (a Float64Array each); the result is what the scorer reads
//   scorePrototypes(compiled, summary)      { option, score, runnerUp, reason, nearest } | null
//   createPrototypesProvider(model, ident)  the provider object `{ name, version, suggest }`
//
// What is NOT here, on purpose: a neural embedding (a static table such as potion-base-8M, bge-small, MiniLM through ONNX Runtime).
// The embedder is a versioned field (`embedder.kind`, `embedder.version`) precisely so a later slice can add one without changing
// the bundle format, and it earns its place only by beating this one on replay (`construct traces replay --model`).
//
// Deterministic: integer hashing, counts that are exact in doubles, a fixed summation order. Pure: no filesystem, no clock, no
// network, no training. `train-kit/build_prototypes.py` repeats `embed.v1` exactly and a test proves the two agree.

import { routeOf } from './decision-features.mjs';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The `schema` string a `prototypes.json` carries. */
export const PROTOTYPES_MODEL_SCHEMA = 'construct.prototypes-model.v1';
/** The embedding function version; the only one this build can compute. */
export const EMBED_VERSION = 'embed.v1';
/** The embedder kind of `embed.v1`: character n-grams hashed into a fixed number of signed buckets. */
export const EMBED_KIND = 'char-ngram-hash';
/** Limits a `prototypes.json` must respect (a prototype set is small curated data, not an embedding table). */
export const PROTOTYPES_MODEL_LIMITS = Object.freeze({ routes: 64, route: 200, classes: 8, perClass: 100, total: 5000, word: 40, dimMin: 16, dimMax: 1024, ngrams: 4 });

const ROUTE_RE = /^[\x20-\x7e]{1,200}$/;
const OPTION_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CHOOSER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const PROTOTYPE_RE = /^[a-z0-9]+(?: [a-z0-9]+)*$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const ascii = (s) => String(s ?? '').replace(/[^\x00-\x7f]/g, ' ');
const words = (s) => ascii(s).toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** FNV-1a, 32 bits, over the characters of an ASCII string (`train-kit/build_prototypes.py` repeats it byte for byte). */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The default embedder of a model: 256 buckets of the 2-, 3- and 4-grams of `<word>`.
 *
 * @example
 * DEFAULT_EMBEDDER; // => { kind: 'char-ngram-hash', version: 'embed.v1', dim: 256, ngrams: [2, 3, 4] }
 */
export const DEFAULT_EMBEDDER = Object.freeze({ kind: EMBED_KIND, version: EMBED_VERSION, dim: 256, ngrams: Object.freeze([2, 3, 4]) });

/**
 * `embed.v1`: the unit vector of a word or phrase. Each word is lowercased (ASCII letters and digits only; anything else separates
 * words), wrapped as `<word>`, cut into every n-gram of the configured lengths, and each n-gram adds +1 or -1 (its hash's top bit)
 * to bucket `hash mod dim`; the counts are then divided by their Euclidean length. Words that share endings or stems ("invoices",
 * "invoice", "voices") end up close; no dictionary is needed, so an unseen word still has an embedding.
 *
 * @param {string} text A word or a short phrase.
 * @param {{ dim: number, ngrams: number[] }} [embedder] The embedder settings of the model (default `DEFAULT_EMBEDDER`).
 * @returns {Float64Array | null} The unit vector, or `null` when the text holds no letter or digit (or every n-gram cancels out).
 *
 * @example
 * embedText('invoices').length; // => 256
 */
export function embedText(text, embedder = DEFAULT_EMBEDDER) {
  const ws = words(text);
  if (!ws.length) return null;
  const vec = new Float64Array(embedder.dim);
  for (const w of ws) {
    const s = `<${w}>`;
    for (const n of embedder.ngrams) {
      for (let i = 0; i + n <= s.length; i += 1) {
        const h = fnv1a(s.slice(i, i + n));
        vec[h % embedder.dim] += h >>> 31 ? -1 : 1;
      }
    }
  }
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
  if (sum === 0) return null;
  const norm = Math.sqrt(sum);
  for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
  return vec;
}

/**
 * The word a question is about: its first quoted phrase (`What does "invoices" mean here?`), normalised to lowercase words joined
 * by one space. `null` when the question quotes nothing (the classifier then abstains: it has nothing to compare).
 *
 * @param {{ question?: string }} summary A chooser summary or a question in that shape.
 * @returns {string | null} The subject, at most 40 characters.
 *
 * @example
 * subjectOf({ question: 'What does "Order Lines" mean here?' }); // => 'order lines'
 */
export function subjectOf(summary) {
  const quoted = /"([^"]{1,40})"/.exec(ascii(summary?.question));
  if (!quoted) return null;
  const subject = words(quoted[1]).join(' ');
  return subject || null;
}

/**
 * Check a parsed `prototypes.json` without trusting it: schema, the embedder (kind, version, dimension, n-gram lengths), the two
 * thresholds, at most 64 routes of 1-8 classes, at most 100 prototype words per class and 5000 in all, every word plain lowercase
 * letters and digits, no prototype-polluting key. Nothing in it is executable: it is words and numbers, and it is read, never run.
 *
 * @param {unknown} model The parsed JSON.
 * @returns {{ ok: boolean, errors: string[], routes: number, prototypes: number }} Every problem in words (the first ten), and the sizes.
 *
 * @example
 * validatePrototypesModel({ schema: 'construct.prototypes-model.v1', embedder: DEFAULT_EMBEDDER, minScore: 0.1, minMargin: 0, routes: {} }).ok; // => true
 */
export function validatePrototypesModel(model) {
  const errors = [];
  const L = PROTOTYPES_MODEL_LIMITS;
  let prototypes = 0;
  if (!isPlainObject(model)) return { ok: false, errors: ['prototypes.json must be a JSON object'], routes: 0, prototypes: 0 };
  if (model.schema !== PROTOTYPES_MODEL_SCHEMA) errors.push(`schema must be "${PROTOTYPES_MODEL_SCHEMA}"`);
  const e = model.embedder;
  if (!isPlainObject(e) || e.kind !== EMBED_KIND || e.version !== EMBED_VERSION) errors.push(`embedder must be { kind: "${EMBED_KIND}", version: "${EMBED_VERSION}", dim, ngrams }; this version computes no other embedder`);
  else {
    if (!Number.isInteger(e.dim) || e.dim < L.dimMin || e.dim > L.dimMax) errors.push(`embedder.dim must be a whole number from ${L.dimMin} to ${L.dimMax}`);
    if (!Array.isArray(e.ngrams) || e.ngrams.length < 1 || e.ngrams.length > L.ngrams || !e.ngrams.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 6 && (i === 0 || n > e.ngrams[i - 1]))) errors.push(`embedder.ngrams must be 1-${L.ngrams} increasing whole numbers from 1 to 6`);
  }
  if (typeof model.minScore !== 'number' || !(model.minScore >= 0 && model.minScore <= 1)) errors.push('minScore must be a number from 0 to 1');
  if (typeof model.minMargin !== 'number' || !(model.minMargin >= 0 && model.minMargin <= 1)) errors.push('minMargin must be a number from 0 to 1');
  if (!isPlainObject(model.routes)) return { ok: false, errors: [...errors, 'routes must be an object'], routes: 0, prototypes: 0 };
  const keys = Object.keys(model.routes);
  if (keys.length > L.routes) errors.push(`at most ${L.routes} routes`);
  for (const key of keys) {
    const at = `routes[${JSON.stringify(key.slice(0, 40))}]`;
    const r = model.routes[key];
    if (!ROUTE_RE.test(key) || FORBIDDEN_KEYS.has(key)) { errors.push(`${at}: not a route`); continue; }
    if (!isPlainObject(r) || !Array.isArray(r.classes) || !isPlainObject(r.prototypes)) { errors.push(`${at}: needs classes[] and prototypes{}`); continue; }
    if (r.choosers !== undefined && !(Array.isArray(r.choosers) && r.choosers.length <= 16 && r.choosers.every((c) => typeof c === 'string' && CHOOSER_ID_RE.test(c)))) errors.push(`${at}: choosers must list chooser ids`);
    const k = r.classes.length;
    if (k < 1 || k > L.classes || new Set(r.classes).size !== k || !r.classes.every((o) => typeof o === 'string' && OPTION_ID_RE.test(o))) { errors.push(`${at}: classes must be 1-${L.classes} distinct option ids`); continue; }
    for (const cls of Object.keys(r.prototypes)) {
      const list = r.prototypes[cls];
      if (!r.classes.includes(cls) || FORBIDDEN_KEYS.has(cls) || !Array.isArray(list) || list.length < 1 || list.length > L.perClass || !list.every((w) => typeof w === 'string' && w.length <= L.word && PROTOTYPE_RE.test(w))) {
        errors.push(`${at}: prototypes.${JSON.stringify(cls.slice(0, 30))} must be a class of the route with 1-${L.perClass} lowercase words (letters, digits, single spaces, at most ${L.word} characters)`);
        break;
      }
      prototypes += list.length;
    }
  }
  if (prototypes > L.total) errors.push(`at most ${L.total} prototypes in all`);
  return { ok: errors.length === 0, errors: errors.slice(0, 10), routes: keys.length, prototypes };
}

/**
 * Embed every prototype of a validated model once. A prototype that has no embedding (its n-grams cancel out) is dropped, so a
 * class may end up with none and is then never suggested.
 *
 * @param {object} model A validated `prototypes.json` (`validatePrototypesModel`).
 * @returns {{ embedder: object, minScore: number, minMargin: number, routes: Map<string, { classes: { option: string, words: string[], vectors: Float64Array[] }[] }> }} The compiled model.
 *
 * @example
 * const compiled = compilePrototypesModel(model);
 */
export function compilePrototypesModel(model) {
  const routes = new Map();
  for (const [key, r] of Object.entries(model.routes)) {
    const classes = r.classes.map((option) => {
      const kept = [];
      const vectors = [];
      for (const word of r.prototypes[option] ?? []) {
        const v = embedText(word, model.embedder);
        if (v) { kept.push(word); vectors.push(v); }
      }
      return { option, words: kept, vectors };
    });
    routes.set(key, { classes });
  }
  return { embedder: model.embedder, minScore: model.minScore, minMargin: model.minMargin, routes };
}

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
};

/**
 * Score one summary: find the route of the summary (`routeOf` of decision-features.mjs: the same question identity the features
 * model uses), embed the quoted word, take for each ENABLED class the highest cosine similarity to any of its prototypes, rank the classes and
 * answer the best. It abstains (`null`) for a question it has no prototypes for, a question that quotes nothing, when no enabled
 * class has a prototype, when the best similarity is under `minScore`, or when the best and the runner-up are closer than
 * `minMargin` (a tie is "I do not know", not a coin flip).
 *
 * @param {ReturnType<typeof compilePrototypesModel>} compiled The compiled model.
 * @param {{ question?: string, options?: object[] }} summary The summary as offered.
 * @returns {{ option: string, score: number, runnerUp: string | null, reason: string, nearest: string } | null} The suggestion (`score` is the cosine similarity, 0 to 1), or `null` to abstain.
 *
 * @example
 * scorePrototypes(compiled, summary); // => { option: 'entity', score: 0.87, runnerUp: 'state', reason: 'closest example "invoices" (87% similar): entity', nearest: 'invoices' }
 */
export function scorePrototypes(compiled, summary) {
  const r = compiled.routes.get(routeOf(summary));
  if (!r) return null;
  const subject = subjectOf(summary);
  if (!subject) return null;
  const query = embedText(subject, compiled.embedder);
  if (!query) return null;
  const enabled = new Set((Array.isArray(summary?.options) ? summary.options : []).filter((o) => o && o.enabled === true).map((o) => o.id));
  const ranked = [];
  for (const c of r.classes) {
    if (!enabled.has(c.option) || !c.vectors.length) continue;
    let best = -Infinity;
    let at = 0;
    for (let i = 0; i < c.vectors.length; i += 1) {
      const s = dot(query, c.vectors[i]);
      if (s > best) { best = s; at = i; }
    }
    ranked.push({ option: c.option, sim: best, nearest: c.words[at] });
  }
  if (!ranked.length) return null;
  ranked.sort((a, b) => b.sim - a.sim || (a.option < b.option ? -1 : 1));
  const [best, second] = ranked;
  const sim = Math.max(0, Math.min(1, best.sim));
  if (sim < compiled.minScore) return null;
  if (second && best.sim - second.sim < compiled.minMargin) return null;
  return { option: best.option, score: sim, runnerUp: second?.option ?? null, reason: `closest example "${best.nearest}" (${Math.round(sim * 100)}% similar): ${best.option}`, nearest: best.nearest };
}

/**
 * The decision provider of a prototypes model: `{ name, version, suggest(summary) }` following docs/DECISION-PROVIDERS.md. It
 * suggests only; the summary it is handed is the frozen four-field copy and it needs nothing else. The prototypes are embedded once,
 * here, so a suggestion is a handful of dot products (well under a millisecond for a curated set).
 *
 * @param {object} model A validated `prototypes.json`.
 * @param {{ name: string, version: string }} identity The provider name and version (recorded beside every suggestion in a trace).
 * @returns {{ name: string, version: string, suggest: (summary: object) => object | null }} The provider.
 *
 * @example
 * registerDecisionProvider('layer-proto', createPrototypesProvider(model, { name: 'layer-proto', version: '1-3fa9c2d1' }));
 */
export function createPrototypesProvider(model, identity) {
  const compiled = compilePrototypesModel(model);
  return {
    name: identity.name,
    version: identity.version,
    suggest(summary) {
      const s = scorePrototypes(compiled, summary);
      return s ? { option: s.option, reason: s.reason, score: s.score, runnerUp: s.runnerUp } : null;
    },
  };
}
