// #647 (epic #616) -- the JSON structured-feature classifier: a multinomial logistic regression whose WEIGHTS ARE PLAIN JSON
// (`features.json`), trained elsewhere (train-kit/train_features.py) and scored here in pure JavaScript. It is the only model
// kind this slice can LOAD: no runtime, no native code, no file it reads is ever executed. It is a decision provider like any
// other (docs/DECISION-PROVIDERS.md): it gets the fixed-size summary and answers one enabled option, a score and a runner-up, or
// null (an honest "I do not know") when the question was not in its training data or no option reaches `minScore`.
//
//   routeOf(summary)                       which question a summary is (its wording with quoted words blanked, plus its option ids)
//   extractFeatures(summary)               the feature names of one summary (`features.v1`; train-kit/train_features.py repeats it exactly)
//   scoreSummary(model, summary)           { option, score, runnerUp, reason } | null
//   validateFeaturesModel(json)            the shape and the size of a `features.json`, without trusting it
//   createFeaturesProvider(model, ident)   the provider object `{ name, version, suggest }`
//
// Deterministic: the same weights and the same summary give the same answer on every machine (features are summed in sorted
// order, in doubles). Pure: no filesystem, no clock, no network, no training. Decision record: docs/TRAIN-ELSEWHERE.md.

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The `schema` string a `features.json` carries. */
export const FEATURES_MODEL_SCHEMA = 'construct.features-model.v1';
/** The feature-extraction version a `features.json` was trained with; a model with another version is refused. */
export const FEATURE_VERSION = 'features.v1';
/** Limits a `features.json` must respect (a model is small data, not a weight dump). */
export const FEATURES_MODEL_LIMITS = Object.freeze({ routes: 64, route: 200, classes: 8, featuresPerRoute: 20000, weight: 1000 });

const CHOOSER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ROUTE_RE = /^[\x20-\x7e]{1,200}$/;
const OPTION_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FEATURE_NAME_RE = /^[\x20-\x7e]{1,100}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const ascii = (s) => String(s ?? '').replace(/[^\x00-\x7f]/g, ' ');
const words = (s) => ascii(s).toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Which closed question a summary is, from what a provider is handed (it never sees the chooser's id): the question with every
 * quoted word blanked (`What does "_" mean here?`), lowercased, whitespace collapsed, then `|` and the option ids in the order
 * offered. A model keeps one classifier per route, so `What does "invoices" mean here?` and `What does "cart" mean here?` share
 * one, and a different question or a different option set is another.
 *
 * @param {{ question?: string, options?: { id: string }[] }} summary A chooser summary or a question in that shape.
 * @returns {string} The route, at most 200 characters.
 *
 * @example
 * routeOf({ question: 'What does "invoices" mean here?', options: [{ id: 'entity' }, { id: 'ignore' }] }); // => 'what does "_" mean here?|entity,ignore'
 */
export function routeOf(summary) {
  const ids = (Array.isArray(summary?.options) ? summary.options : []).map((o) => String(o?.id ?? ''));
  const template = ascii(summary?.question).replace(/"[^"]*"/g, '"_"').toLowerCase().replace(/[ \t\n\r\f\v]+/g, ' ').trim();
  return `${template}|${ids.join(',')}`.slice(0, FEATURES_MODEL_LIMITS.route);
}

/**
 * The features of ONE summary, `features.v1`, as a sorted list of names. From the offer alone (what a provider is handed):
 * `enabled:<option id>` for every enabled option, `n:<count of enabled options>`, for the first quoted word of the question
 * (`What does "invoices" mean here?`) `word:`, `len:`, `suf1:`, `suf2:`, `suf3:` and `plural`, and `tok:<word>` for up to 24
 * distinct words of the rest of the question. Non-ASCII characters count as separators, so JavaScript and Python agree.
 *
 * @param {{ question?: string, options?: { id: string, enabled?: boolean }[] }} summary A chooser summary or a question in that shape.
 * @returns {string[]} The feature names, sorted and unique.
 *
 * @example
 * extractFeatures({ question: 'What does "invoices" mean here?', options: [{ id: 'entity', enabled: true }, { id: 'ignore', enabled: true }] });
 * // => ['enabled:entity', 'enabled:ignore', 'len:8', 'n:2', 'plural', 'suf1:s', 'suf2:es', 'suf3:ces', 'tok:does', 'tok:here', 'tok:mean', 'tok:what', 'word:invoices']
 */
export function extractFeatures(summary) {
  const feats = new Set();
  const options = Array.isArray(summary?.options) ? summary.options : [];
  const enabled = options.filter((o) => o && o.enabled === true && typeof o.id === 'string').map((o) => o.id);
  for (const id of enabled) feats.add(`enabled:${id}`);
  feats.add(`n:${enabled.length}`);
  const question = ascii(summary?.question);
  const quoted = /"([^"]{1,40})"/.exec(question);
  let rest = question;
  if (quoted) {
    const word = words(quoted[1]).join('_');
    if (word) {
      feats.add(`word:${word}`);
      feats.add(`len:${Math.min(word.length, 12)}`);
      feats.add(`suf1:${word.slice(-1)}`);
      if (word.length >= 2) feats.add(`suf2:${word.slice(-2)}`);
      if (word.length >= 3) feats.add(`suf3:${word.slice(-3)}`);
      if (word.endsWith('s') && !word.endsWith('ss')) feats.add('plural');
    }
    rest = question.replace(quoted[0], ' ');
  }
  for (const t of [...new Set(words(rest))].slice(0, 24)) feats.add(`tok:${t}`);
  return [...feats].sort();
}

/**
 * Check a parsed `features.json` without trusting it: schema, feature version, `minScore`, at most 64 routes of 1-8 classes each,
 * every weight a finite number of bounded size, no prototype-polluting key, at most 20000 features per route. Nothing in it is
 * executable: it is numbers and names, and it is read, never run.
 *
 * @param {unknown} model The parsed JSON.
 * @returns {{ ok: boolean, errors: string[], routes: number, features: number }} Every problem in words (the first ten), and the sizes.
 *
 * @example
 * validateFeaturesModel({ schema: 'construct.features-model.v1', featureVersion: 'features.v1', minScore: 0.4, routes: {} }).ok; // => true
 */
export function validateFeaturesModel(model) {
  const errors = [];
  const L = FEATURES_MODEL_LIMITS;
  let features = 0;
  if (!isPlainObject(model)) return { ok: false, errors: ['features.json must be a JSON object'], routes: 0, features: 0 };
  if (model.schema !== FEATURES_MODEL_SCHEMA) errors.push(`schema must be "${FEATURES_MODEL_SCHEMA}"`);
  if (model.featureVersion !== FEATURE_VERSION) errors.push(`featureVersion must be "${FEATURE_VERSION}"`);
  if (typeof model.minScore !== 'number' || !(model.minScore >= 0 && model.minScore <= 1)) errors.push('minScore must be a number from 0 to 1');
  if (!isPlainObject(model.routes)) return { ok: false, errors: [...errors, 'routes must be an object'], routes: 0, features: 0 };
  const keys = Object.keys(model.routes);
  if (keys.length > L.routes) errors.push(`at most ${L.routes} routes`);
  const finite = (x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= L.weight;
  for (const key of keys) {
    const at = `routes[${JSON.stringify(key.slice(0, 40))}]`;
    const r = model.routes[key];
    if (!ROUTE_RE.test(key) || FORBIDDEN_KEYS.has(key)) { errors.push(`${at}: not a route`); continue; }
    if (!isPlainObject(r) || !Array.isArray(r.classes) || !Array.isArray(r.bias) || !isPlainObject(r.weights)) { errors.push(`${at}: needs classes[], bias[] and weights{}`); continue; }
    if (r.choosers !== undefined && !(Array.isArray(r.choosers) && r.choosers.length <= 16 && r.choosers.every((c) => typeof c === 'string' && CHOOSER_ID_RE.test(c)))) errors.push(`${at}: choosers must list chooser ids`);
    const k = r.classes.length;
    if (k < 1 || k > L.classes || new Set(r.classes).size !== k || !r.classes.every((o) => typeof o === 'string' && OPTION_ID_RE.test(o))) errors.push(`${at}: classes must be 1-${L.classes} distinct option ids`);
    if (r.bias.length !== k || !r.bias.every(finite)) errors.push(`${at}: bias must be ${k} bounded numbers`);
    const names = Object.keys(r.weights);
    features += names.length;
    if (names.length > L.featuresPerRoute) errors.push(`${at}: at most ${L.featuresPerRoute} features`);
    for (const name of names) {
      const w = r.weights[name];
      if (!FEATURE_NAME_RE.test(name) || FORBIDDEN_KEYS.has(name) || !Array.isArray(w) || w.length !== k || !w.every(finite)) {
        errors.push(`${at}: feature ${JSON.stringify(name.slice(0, 30))} is not a name with ${k} bounded weights`);
        break;
      }
    }
  }
  return { ok: errors.length === 0, errors: errors.slice(0, 10), routes: keys.length, features };
}

/**
 * Score one summary with a validated model: find the route of the summary (`routeOf`), add up the weights of its features
 * (sorted, in doubles) to one logit per class, keep the summary's ENABLED options the model knows, turn them into
 * probabilities (softmax) and take the best. The model abstains (`null`) for a question it was not trained on, when none of the
 * enabled options is a class it knows, or when the best probability is under `minScore`.
 *
 * @param {object} model A validated `features.json` (`validateFeaturesModel`).
 * @param {{ question?: string, options?: object[] }} summary The summary as offered.
 * @returns {{ option: string, score: number, runnerUp: string | null, reason: string } | null} The suggestion, or `null` to abstain.
 *
 * @example
 * scoreSummary(model, summary); // => { option: 'entity', score: 0.91, runnerUp: 'state', reason: 'trained classifier: 91% entity' }
 */
export function scoreSummary(model, summary) {
  const key = routeOf(summary);
  const route = Object.hasOwn(model.routes, key) ? model.routes[key] : null;
  if (!route) return null;
  const enabled = new Set((Array.isArray(summary?.options) ? summary.options : []).filter((o) => o && o.enabled === true).map((o) => o.id));
  const logits = route.bias.slice();
  for (const f of extractFeatures(summary)) {
    if (!Object.hasOwn(route.weights, f)) continue;
    const w = route.weights[f];
    for (let i = 0; i < logits.length; i += 1) logits[i] += w[i];
  }
  const candidates = route.classes.map((option, i) => ({ option, logit: logits[i] })).filter((c) => enabled.has(c.option));
  if (!candidates.length) return null;
  const top = Math.max(...candidates.map((c) => c.logit));
  const exps = candidates.map((c) => Math.exp(c.logit - top));
  const total = exps.reduce((a, b) => a + b, 0);
  const ranked = candidates.map((c, i) => ({ option: c.option, p: exps[i] / total })).sort((a, b) => b.p - a.p || (a.option < b.option ? -1 : 1));
  const best = ranked[0];
  if (best.p < model.minScore) return null;
  return { option: best.option, score: best.p, runnerUp: ranked[1]?.option ?? null, reason: `trained classifier: ${Math.round(best.p * 100)}% ${best.option}` };
}

/**
 * The decision provider of a features model: `{ name, version, suggest(summary) }` following docs/DECISION-PROVIDERS.md. It
 * suggests only; the summary it is handed is the frozen four-field copy and it needs nothing else.
 *
 * @param {object} model A validated `features.json`.
 * @param {{ name: string, version: string }} identity The provider name and version (recorded beside every suggestion in a trace).
 * @returns {{ name: string, version: string, suggest: (summary: object) => object | null }} The provider.
 *
 * @example
 * registerDecisionProvider('features-lr', createFeaturesProvider(model, { name: 'features-lr', version: '1-3fa9c2d1' }));
 */
export function createFeaturesProvider(model, identity) {
  return {
    name: identity.name,
    version: identity.version,
    suggest(summary) {
      const s = scoreSummary(model, summary);
      return s ? { option: s.option, reason: s.reason, score: s.score, runnerUp: s.runnerUp } : null;
    },
  };
}
