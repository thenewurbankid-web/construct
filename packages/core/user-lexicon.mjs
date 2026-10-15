// The user domain: a project's own functions, mapped onto the same grammar
// primitives as our JS lexicon (grammar.mjs) — derived from the callee's name,
// never kept as a hand-written entry. `startSession(user)` maps to the Action
// "starts the session with `user`", `isValid(form)` to the Predicate "`form`
// is valid" (negated: "is not valid"), `getUser(id)` to the Value "the user
// for `id`". Naming is the only signal, which is why naming matters.
//
// Every callee maps to something grammatical: a name that doesn't start with a
// known verb or predicate prefix reads as a Value ("`total` applied to `a`").
import { action, value, predicate, verb, BE, HAVE, args, target, opt } from './grammar.mjs';

// First words that read as an action. Irregular conjugations live in Verb.
const ACTION_VERBS = new Set([
  'add', 'apply', 'build', 'calculate', 'cancel', 'check', 'clear', 'close', 'compute', 'convert', 'create',
  'delete', 'dispatch', 'emit', 'ensure', 'fetch', 'find', 'format', 'handle', 'hide', 'init', 'initialize',
  'insert', 'load', 'log', 'make', 'merge', 'move', 'navigate', 'normalize', 'notify', 'open', 'parse',
  'persist', 'post', 'process', 'push', 'put', 'read', 'refresh', 'register', 'reload', 'remove', 'render',
  'replace', 'reset', 'resolve', 'restore', 'run', 'save', 'select', 'send', 'set', 'show', 'sort', 'start',
  'stop', 'store', 'submit', 'subscribe', 'sync', 'toggle', 'track', 'transform', 'unsubscribe', 'update',
  'upload', 'validate', 'write',
]);

// Phrasal verbs: `logIn`/`login` -> "logs in", `signOut` -> "signs out".
const PHRASAL = { login: ['log', 'in'], logout: ['log', 'out'], signin: ['sign', 'in'], signout: ['sign', 'out'], signup: ['sign', 'up'] };

// Predicate prefixes and the verb each one uses: isValid -> "is valid".
const PREDICATE_PREFIXES = { is: BE, has: HAVE, can: verb('can', { thirdPerson: 'can', negated: 'cannot' }), should: verb('should', { thirdPerson: 'should', negated: 'should not' }) };

/**
 * Splits an identifier into lower-case words: `startUserSession` -> ['start', 'user', 'session'], `parseURL` -> ['parse', 'url'].
 * @param {string} name The identifier.
 * @returns {string[]} Its words.
 */
export function splitIdentifier(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_$]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

const cache = new Map();

/** The sentence type a user-domain callee maps to. Always returns a type:
 * every call reads as grammatical English.
 * @param {string} callee The call path as written: 'startSession', 'api.saveUser'.
 * @returns {typeof import('./grammar.mjs').Sentence} */
export function mapUserCall(callee) {
  if (cache.has(callee)) return cache.get(callee);
  const dot = callee.lastIndexOf('.');
  const name = callee.slice(dot + 1);
  const method = dot > 0;
  const call = method ? `.${name}` : callee;
  let [first, ...restWords] = splitIdentifier(name);
  if (PHRASAL[first + (restWords[0] ?? '')]) [first, ...restWords] = [first + restWords[0], ...restWords.slice(1)];
  const object = restWords.join(' ');
  const on = method ? [opt('on', target())] : [];
  /** @type {any} */
  let type;

  if (PREDICATE_PREFIXES[first] && object) {
    // `isValid(form)`: "`form` is valid"; `user.isAdmin()`: "`user` is admin".
    type = method
      ? predicate(call, target(), PREDICATE_PREFIXES[first], object, opt('for', args()))
      : predicate(call, args(), PREDICATE_PREFIXES[first], object);
    if (!method) type = withSubjectFallback(type, call, PREDICATE_PREFIXES[first], object);
  } else if (PHRASAL[first]) {
    const [lemma, particle] = PHRASAL[first];
    type = action(call, verb(lemma), particle, ...(object ? [`to the ${object}`] : []), opt(object ? 'with' : 'as', args()), ...on);
  } else if (first === 'use' && object && !method) {
    // A React hook: `useLogin()` -> "the login hook".
    type = value(call, 'the', object, 'hook', opt('for', args()));
  } else if (first === 'get' && object) {
    type = method ? value(call, 'the', object, 'of', target(), opt('for', args())) : value(call, 'the', object, opt('for', args()));
  } else if (ACTION_VERBS.has(first)) {
    type = action(call, verb(first), ...(object ? [`the ${object}`] : []), opt(object ? 'with' : '', args()), ...on);
  } else {
    // Not a verb: the name is the thing produced. `total(a, b)`: "`total` of `a` and `b`".
    type = method ? value(call, `\`${name}\` of`, target(), opt('applied to', args())) : value(call, `\`${name}\``, opt('of', args()));
  }
  cache.set(callee, type);
  return type;
}

/** A free-function predicate with no arguments has no subject; it reads
 * against "it" instead: `isReady()` -> "it is ready". */
function withSubjectFallback(type, call, v, object) {
  const noArgs = predicate(call, 'it', v, object);
  return class extends type {
    toEnglish() {
      return this.binding.args.length ? super.toEnglish() : new noArgs(this.binding).toEnglish();
    }
    toNegatedEnglish() {
      return this.binding.args.length ? super.toNegatedEnglish() : new noArgs(this.binding).toNegatedEnglish();
    }
  };
}
