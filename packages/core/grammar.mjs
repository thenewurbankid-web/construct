// Grammar primitives for Construct's controlled English — the static,
// deterministic dialect the code -> English translator (prose.mjs) speaks.
//
// A sentence is never a free-form string template. It is an instance of a
// sentence type (a class) composed from typed parts — a Verb that conjugates
// itself, fixed Words, Slots bound to the call's arguments or receiver, and
// Optional groups — so it is grammatical by construction:
//
//   Sentence            one call into a library, bound to its arguments
//   ├── Action          a verb phrase:  "sets the browser-storage key 'user' to `u`"
//   │                   (and its gerund: "setting the browser-storage key ...")
//   ├── Value           a noun phrase:  "the keys of `config`"
//   └── Predicate       a clause:       "`items` includes `x`"
//                       (and its negation: "`items` does not include `x`")
//
// The same instance renders both ways: toEnglish() gives the canonical
// sentence, toJs() gives back the raw call, and Sentence.fromEnglish() maps a
// canonical sentence (or a raw-JS request phrased in it) back to an instance.
// English is the internal representation; JS is one rendering of it.

// ---- verbs ---------------------------------------------------------------

const VOWELS = 'aeiou';

function isConsonant(ch) {
  return /[a-z]/.test(ch) && !VOWELS.includes(ch);
}

/** A verb that conjugates itself: third person ("sets"), gerund ("setting")
 * and negation ("does not set"). Irregular forms are passed in, never patched
 * onto a sentence afterwards. */
export class Verb {
  /**
   * @param {string} lemma The bare form: 'set', 'include', 'be'.
   * @param {{thirdPerson?: string, gerund?: string, negated?: string}} [irregular] Forms the regular rules get wrong.
   */
  constructor(lemma, irregular = {}) {
    this.lemma = lemma;
    this.irregular = irregular;
  }

  /** "sets", "fetches", "copies", "goes". */
  get thirdPerson() {
    if (this.irregular.thirdPerson) return this.irregular.thirdPerson;
    const w = this.lemma;
    if (/(s|x|z|ch|sh|o)$/.test(w)) return `${w}es`;
    if (w.endsWith('y') && isConsonant(w.at(-2))) return `${w.slice(0, -1)}ies`;
    return `${w}s`;
  }

  /** "setting", "removing", "listening", "copying". */
  get gerund() {
    if (this.irregular.gerund) return this.irregular.gerund;
    const w = this.lemma;
    if (w.endsWith('ie')) return `${w.slice(0, -2)}ying`;
    if (w.endsWith('e') && !/(ee|ye|oe)$/.test(w)) return `${w.slice(0, -1)}ing`;
    // One-syllable consonant-vowel-consonant doubles its last letter
    // ("set" -> "setting"); w, x and y never double.
    const syllables = w.match(/[aeiouy]+/g)?.length ?? 0;
    const [a, b, c] = w.slice(-3);
    if (syllables === 1 && w.length >= 3 && isConsonant(a) && VOWELS.includes(b) && isConsonant(c) && !'wxy'.includes(c)) return `${w}${c}ing`;
    return `${w}ing`;
  }

  /** "does not include", "is not". */
  get negated() {
    return this.irregular.negated ?? `does not ${this.lemma}`;
  }
}

/** @param {string} lemma @param {{thirdPerson?: string, gerund?: string, negated?: string}} [irregular] */
/**
 * A regular verb, or one with its irregular forms spelled out.
 * @param {string} lemma The bare form.
 * @param {{thirdPerson?: string, gerund?: string, negated?: string}} [irregular] Forms the regular rules get wrong.
 * @returns {Verb} The verb.
 */
export const verb = (lemma, irregular) => new Verb(lemma, irregular);
export const BE = new Verb('be', { thirdPerson: 'is', gerund: 'being', negated: 'is not' });
export const HAVE = new Verb('have', { thirdPerson: 'has', gerund: 'having', negated: 'does not have' });

// ---- parts ---------------------------------------------------------------

/**
 * One argument or receiver, in both languages.
 * @typedef {{english: string, js: string, bare?: string | null}} Bound
 */
/** @typedef {{args: Bound[], target: Bound | null}} Binding */

/** A piece of a sentence. render() returns null when the binding can't fill
 * it (the sentence type doesn't fit the call); pattern() is the regex source
 * that reads it back out of canonical English. */
export class Part {
  /** @param {Binding} _binding @returns {string | null} */
  render(_binding) {
    throw new Error('Part.render is abstract');
  }
  /** @returns {string} */
  pattern() {
    throw new Error('Part.pattern is abstract');
  }
}

/** Fixed words: "the browser-storage key". */
export class Words extends Part {
  /** @param {string} text */
  constructor(text) {
    super();
    this.text = text;
  }
  render() {
    return this.text;
  }
  pattern() {
    return this.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/** A part filled from the call: an argument, all of them, or the receiver. */
export class Slot extends Part {
  pattern() {
    return '(.+?)';
  }
}

/** The i-th argument, described: "`user`", "the text 'x'". */
export class Arg extends Slot {
  /** @param {number} index */
  constructor(index) {
    super();
    this.index = index;
  }
  render({ args }) {
    return args[this.index]?.english ?? null;
  }
}

/** The i-th argument as itself when it's a literal — 500, 'open' — for
 * names, keys and counts where "the number 500" reads badly. */
export class Bare extends Arg {
  render({ args }) {
    const bound = args[this.index];
    return bound ? (bound.bare ?? bound.english) : null;
  }
}

/** Every argument, as an English list. */
export class Args extends Slot {
  render({ args }) {
    return args.length ? joinEnglishList(args.map((a) => a.english)) : null;
  }
}

/** Every argument after the first, as an English list. */
export class Rest extends Slot {
  render({ args }) {
    return args.length > 1 ? joinEnglishList(args.slice(1).map((a) => a.english)) : null;
  }
}

/** The receiver: `items` in `items.map(...)`. */
export class Target extends Slot {
  render({ target }) {
    return target?.english ?? null;
  }
}

/** Parts dropped together when any of them can't be filled: "[with `opts`]". */
export class Optional extends Part {
  /** @param {Part[]} parts */
  constructor(parts) {
    super();
    this.parts = parts;
  }
  render(binding) {
    return renderParts(this.parts, binding) ?? '';
  }
  pattern() {
    return `(?:${patternOf(this.parts)})?`; // standalone; inside a sentence patternOf() places the space
  }
}

/**
 * The i-th argument, described.
 * @param {number} i Argument index.
 * @returns {Arg} The slot.
 */
export const arg = (i) => new Arg(i);
/**
 * The i-th argument as itself when it's a literal.
 * @param {number} i Argument index.
 * @returns {Bare} The slot.
 */
export const bare = (i) => new Bare(i);
/**
 * Every argument, as an English list.
 * @returns {Args} The slot.
 */
export const args = () => new Args();
/**
 * Every argument after the first, as an English list.
 * @returns {Rest} The slot.
 */
export const rest = () => new Rest();
/**
 * The call's receiver.
 * @returns {Target} The slot.
 */
export const target = () => new Target();
/**
 * A group of parts dropped together when any can't be filled.
 * @param {...(Part | string)} parts Words and slots.
 * @returns {Optional} The group.
 */
export const opt = (...parts) => new Optional(parts.map(toPart));

/** @param {Part | string} p */
function toPart(p) {
  return typeof p === 'string' ? new Words(p) : p;
}

/** Joins rendered parts with single spaces, keeping commas tight; null when a
 * required part can't be filled. */
function renderParts(parts, binding) {
  const out = [];
  for (const p of parts) {
    const s = p.render(binding);
    if (s == null) return null;
    if (s) out.push(s);
  }
  return out.join(' ').replace(/ ,/g, ',');
}

function patternOf(parts) {
  return parts
    .map((p, i) => {
      const space = i ? ' ' : '';
      return p instanceof Optional ? `(?:${space}${patternOf(p.parts)})?` : space + p.pattern(); // an optional group owns its leading space
    })
    .join('')
    .replace(/ ,/g, ',');
}

/**
 * Joins items as an English list: "a", "a and b", "a, b, and c".
 * @param {string[]} items The items.
 * @returns {string} The list.
 */
export function joinEnglishList(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ---- lint: rules every sentence obeys ------------------------------------

const PARTICLES = 'in|out|up|to|of|with|for|on|from|into|by|at';

/** Grammar rules, as [name, test] pairs; a test returns true on a violation.
 * Text inside `backticks` and 'quotes' is code or data, not English, and is
 * masked before testing.
 * @type {ReadonlyArray<[string, (s: string) => boolean]>} */
export const LINT_RULES = Object.freeze([
  ['empty sentence', (s) => !s.trim()],
  ['double space', (s) => / {2}/.test(s)],
  ['space before punctuation', (s) => / [,.;:]/.test(s)],
  ['repeated word', (s) => /\b(\w+) \1\b/i.test(s)],
  ['article before a particle', (s) => new RegExp(`\\b(the|a|an) (${PARTICLES})\\b`, 'i').test(s)],
  ['"a" before a vowel sound', (s) => /\ba [aeio]\w/i.test(s)],
  ['"an" before a consonant', (s) => /\ban [b-df-hj-np-tv-z]/i.test(s)],
  ['raw code outside backticks', (s) => /=>|[{};]|\w\(/.test(s)],
  ['dangling preposition', (s) => new RegExp(`\\b(${PARTICLES}|the|a|an|and)[.]?$`, 'i').test(s.trim())],
]);

/**
 * Masks code (`x`) and data ('x') spans so lint rules only see the English.
 * @param {string} sentence The sentence.
 * @returns {string} The sentence with each span replaced by X.
 */
export function maskSpans(sentence) {
  return sentence.replace(/``.*?``/g, 'X').replace(/`[^`]*`/g, 'X').replace(/'[^']*'/g, 'X');
}

/**
 * The lint rules a sentence breaks.
 * @param {string} sentence One English sentence or phrase.
 * @returns {string[]} The names of the broken rules; empty when clean.
 */
export function lintSentence(sentence) {
  const masked = maskSpans(sentence);
  return LINT_RULES.filter(([, broken]) => broken(masked)).map(([name]) => name);
}


// ---- reading canonical English back ---------------------------------------

/** One slot's English, back to JS: "`user.id`" -> user.id, "'open'" or "the
 * text 'open'" -> 'open', "5000" or "the number 5000" -> 5000. Null when the
 * English isn't canonical (it was a described expression, not a value).
 * @param {string} english One slot's English.
 * @returns {string | null} The JS expression, or null. */
export function englishToJs(english) {
  let m;
  if ((m = /^`([^`]+)`$/.exec(english))) return m[1];
  if ((m = /^(?:the text )?'([^']*)'$/.exec(english))) return JSON.stringify(m[1]).replace(/^"|"$/g, "'");
  if ((m = /^(?:the number )?(-?\d+(?:\.\d+)?)$/.exec(english))) return m[1];
  if (/^(true|false|null|undefined)$/.test(english)) return english;
  return null;
}

// ---- sentence types ------------------------------------------------------

/** One library call, bound to its arguments, as a sentence. Concrete
 * sentence types are subclasses declared in js-lexicon.mjs. */
export class Sentence {
  /** Which callee this type covers: 'JSON.parse' (that path, also reached
   * through a longer one) or '.map' (that method on any receiver). */
  static call = '';
  /** @type {Part[]} */
  static parts = [];

  /** @param {Binding} binding */
  constructor(binding) {
    this.binding = binding;
  }

  /** Whether this type covers `callee`; exact paths outrank methods. */
  static covers(callee) {
    if (this.call.startsWith('.')) return callee.endsWith(this.call) && callee.length > this.call.length;
    return callee === this.call || callee.endsWith(`.${this.call}`);
  }

  /** Whether every argument of the binding has a slot — a sentence never
   * silently drops an argument, so a call passing one this type has no slot
   * for doesn't fit it. */
  fits() {
    const slots = /** @type {typeof Sentence} */ (/** @type {unknown} */ (this.constructor)).slotsInOrder();
    const covered = new Set(slots.filter((x) => x instanceof Arg).map((x) => /** @type {Arg} */ (x).index));
    return this.binding.args.every((_, i) => covered.has(i) || slots.some((x) => x instanceof Args || (x instanceof Rest && i > 0)));
  }

  /** The canonical English. Null when the binding doesn't fit this type. */
  toEnglish() {
    throw new Error('Sentence.toEnglish is abstract');
  }

  /** The raw JS call this sentence stands for. */
  toJs() {
    const { args: bound, target: receiver } = this.binding;
    const ctor = /** @type {typeof Sentence} */ (/** @type {unknown} */ (this.constructor));
    const callee = ctor.call.startsWith('.') ? `${receiver?.js ?? '_'}${ctor.call}` : ctor.call;
    return `${callee}(${bound.map((a) => a.js).join(', ')})`;
  }

  /** The regex that reads this type's canonical English back. */
  static englishPattern() {
    throw new Error('Sentence.englishPattern is abstract');
  }

  /** Reads one canonical sentence of this type back into an instance, or
   * null when the text isn't one. Slots must hold canonical values
   * (`refs`, 'text', numbers) to come back as JS. */
  static fromEnglish(text) {
    const m = new RegExp(`^${this.englishPattern()}\\.?$`, 'i').exec(text.trim());
    if (!m) return null;
    const slots = this.slotsInOrder();
    const bound = [];
    let receiver = null;
    for (let i = 0; i < slots.length; i++) {
      const english = m[i + 1];
      if (english == null) continue;
      const slot = slots[i];
      if (slot instanceof Args || slot instanceof Rest) {
        const start = slot instanceof Rest ? 1 : 0;
        english.split(/, and |, | and /).forEach((e, k) => (bound[start + k] = { english: e, js: englishToJs(e) }));
      } else if (slot instanceof Target) {
        receiver = { english, js: englishToJs(english) };
      } else if (slot instanceof Arg) {
        bound[slot.index] = { english, js: englishToJs(english) };
      }
    }
    if ([...bound, receiver].some((b) => b && b.js == null)) return null;
    for (let i = 0; i < bound.length; i++) if (!bound[i]) return null; // a gap in the argument list
    return new this({ args: bound, target: receiver });
  }

  /** @returns {Slot[]} */
  static slotsInOrder() {
    const out = [];
    const walk = (parts) => parts.forEach((p) => (p instanceof Optional ? walk(p.parts) : p instanceof Slot && out.push(p)));
    walk(this.allParts());
    return out;
  }

  /** @returns {Part[]} */
  static allParts() {
    return this.parts;
  }
}

/** A verb phrase, implicitly about the code being described: "sets ...". */
export class Action extends Sentence {
  /** @type {Verb} */
  static verb;

  toEnglish() {
    const ctor = /** @type {typeof Action} */ (/** @type {unknown} */ (this.constructor));
    const rest = this.fits() ? renderParts(ctor.parts, this.binding) : null;
    return rest == null ? null : [ctor.verb.thirdPerson, rest].filter(Boolean).join(' ');
  }

  /** The same phrase as a gerund, for value positions: "setting ...". */
  toGerund() {
    const ctor = /** @type {typeof Action} */ (/** @type {unknown} */ (this.constructor));
    const rest = this.fits() ? renderParts(ctor.parts, this.binding) : null;
    return rest == null ? null : [ctor.verb.gerund, rest].filter(Boolean).join(' ');
  }

  static englishPattern() {
    return patternOf([new Words(this.verb.thirdPerson), ...this.parts]);
  }
}

/** A noun phrase — a value that reads fine on its own: "the keys of `x`". */
export class Value extends Sentence {
  toEnglish() {
    const ctor = /** @type {typeof Value} */ (/** @type {unknown} */ (this.constructor));
    return this.fits() ? renderParts(ctor.parts, this.binding) : null;
  }

  static englishPattern() {
    return patternOf(this.parts);
  }
}

/** A clause — subject, verb, complement — that negates by its verb:
 * "`items` includes `x`" / "`items` does not include `x`". Only calls whose
 * negation really is the verb's negation are predicates ("some item passes"
 * is not one: its negation is "no item passes", so `.some` is a Value). */
export class Predicate extends Sentence {
  /** @type {Part} */
  static subject;
  /** @type {Verb} */
  static verb;

  toEnglish() {
    return this.clause(/** @type {typeof Predicate} */ (/** @type {unknown} */ (this.constructor)).verb.thirdPerson);
  }

  /** "`items` does not include `x`". */
  toNegatedEnglish() {
    return this.clause(/** @type {typeof Predicate} */ (/** @type {unknown} */ (this.constructor)).verb.negated);
  }

  clause(verbForm) {
    const ctor = /** @type {typeof Predicate} */ (/** @type {unknown} */ (this.constructor));
    if (!this.fits()) return null;
    const subject = ctor.subject.render(this.binding);
    const rest = renderParts(ctor.parts, this.binding);
    if (subject == null || rest == null) return null;
    return [subject, verbForm, rest].filter(Boolean).join(' ');
  }

  static allParts() {
    return [this.subject, ...this.parts];
  }

  static englishPattern() {
    return patternOf([this.subject, new Words(this.verb.thirdPerson), ...this.parts]);
  }
}

// ---- declaring sentence types ----------------------------------------------

/** Declares an Action type: action('localStorage.setItem', verb('set'),
 * 'the browser-storage key', bare(0), 'to', arg(1)).
 * @param {string} call @param {Verb} v @param {...(Part | string)} parts
 * @returns {typeof Action} */
export function action(call, v, ...parts) {
  return class extends Action {
    static call = call;
    static verb = v;
    static parts = parts.map(toPart);
  };
}

/** Declares a Value type: value('Object.keys', 'the keys of', arg(0)).
 * @param {string} call @param {...(Part | string)} parts
 * @returns {typeof Value} */
export function value(call, ...parts) {
  return class extends Value {
    static call = call;
    static parts = parts.map(toPart);
  };
}

/** Declares a Predicate type: predicate('.includes', target(), verb('include'), arg(0)).
 * @param {string} call @param {Part | string} subject @param {Verb} v @param {...(Part | string)} parts
 * @returns {typeof Predicate} */
export function predicate(call, subject, v, ...parts) {
  return class extends Predicate {
    static call = call;
    static subject = toPart(subject);
    static verb = v;
    static parts = parts.map(toPart);
  };
}
