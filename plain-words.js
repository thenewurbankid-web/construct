// Word tables for Smith's plain style (toEnglish's default, { style: 'plain' }).
// Deterministic lookups only -- no model, no dictionary download. The exact
// style ({ style: 'exact' }) never consults this file.

// Calls read as their result. A callee name is split camelCase into words;
// the first word is the verb, the rest the noun. These prefixes have a fixed
// reading (a = the subject: the first argument of a free function, or the
// receiver of a method call):
//   get/find X(a)          -> the X for a
//   is/has/can X(a)        -> whether a is/has/can X
//   to X(a)                -> a as X
//   format X(a)            -> a formatted as X
//   build/make/create X(a) -> a new X from a
//   convert X(a)           -> a converted to X
//   parse X(a)             -> a parsed as X
const PREFIX_RULES = {
  get: 'the-for', find: 'the-for',
  is: 'whether', has: 'whether', can: 'whether',
  to: 'as',
  format: 'formatted-as',
  build: 'new-from', make: 'new-from', create: 'new-from',
  convert: 'converted-to',
  parse: 'parsed-as',
};

// Any other free-function verb+noun call reads as its arguments with the
// noun <verb>ed: stripLocale(pathname) -> "pathname with locale stripped".
// Only for a first word that is a verb in this list, so a noun-first name
// (pageCount, userName) is never mis-read as an action.
const VERBS = new Set(`
  add append apply assign attach bind break build calculate cap capitalize check clamp clean clear clone close
  collapse collect combine compact compare compose compute concat count crop cut debounce decode dedupe
  delete detach dispatch drop emit encode enrich ensure escape evaluate expand extend extract fetch fill
  filter fix flatten flip fold freeze group handle hash hide highlight hydrate increment init initialize insert
  invert join keep label limit load lock map mark mask merge mount move normalize omit open order pack pad
  paginate patch pick pluck pop prepare prepend process project prune push quote rank read rebuild record
  reduce refresh register reject remove rename render reorder repeat replace reset resolve restore reverse
  round run sanitize save scale score select send serialize set shift show shuffle slice slugify sort split
  squash start stop store strip sum swap take tag throttle toggle transform translate trim truncate unlock
  unmount unpack unwrap update upsert validate verify wrap write zip
`.trim().split(/\s+/));

const IRREGULAR = {
  bind: 'bound', break: 'broken', build: 'built', cut: 'cut', fetch: 'fetched', hide: 'hidden', keep: 'kept',
  make: 'made', read: 'read', run: 'run', send: 'sent', set: 'set', show: 'shown', split: 'split', take: 'taken',
  write: 'written', find: 'found', get: 'got', put: 'put', spread: 'spread', shut: 'shut', hold: 'held',
  lead: 'led', lose: 'lost', mean: 'meant', pay: 'paid', say: 'said', sell: 'sold', tell: 'told', win: 'won',
  draw: 'drawn', throw: 'thrown', choose: 'chosen', begin: 'begun', bring: 'brought', buy: 'bought', seek: 'sought',
  spend: 'spent', feed: 'fed', fit: 'fit', hit: 'hit', let: 'let', quit: 'quit', freeze: 'frozen', swap: 'swapped',
};

// Regular past participle: e -> +d (normalized), consonant+y -> ied
// (emptied), a one-vowel word ending vowel+consonant doubles it (stripped,
// mapped), otherwise +ed (filtered, sorted).
function pastParticiple(verb) {
  if (IRREGULAR[verb]) return IRREGULAR[verb];
  if (verb.endsWith('e')) return `${verb}d`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ied`;
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(verb)) return `${verb}${verb.slice(-1)}ed`;
  return `${verb}ed`;
}

// Calls whose result is a yes/no by naming convention (startsWith, includes,
// isValid, some, every, regex.test ...): their return reads "whether ...".
const BOOLEAN_CALL = /^(is|has|can|should|will|did|does|was|were|are|contains|includes|starts|ends|matches|equals|test|some|every)([A-Z]|$)/;

const PLAIN_BINARY = {
  '===': 'equals', '==': 'equals', '!==': "doesn't equal", '!=': "doesn't equal",
  '<': 'is less than', '<=': 'is at most', '>': 'is greater than', '>=': 'is at least',
};
const PLAIN_LOGICAL = { '&&': 'and', '||': 'or', '??': 'or else' };

module.exports = { PREFIX_RULES, VERBS, IRREGULAR, pastParticiple, BOOLEAN_CALL, PLAIN_BINARY, PLAIN_LOGICAL };
