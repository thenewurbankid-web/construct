import test from 'node:test';
import assert from 'node:assert/strict';
import { describeImplementation } from '../packages/core/prose.mjs';
import { JS_LEXICON } from '../packages/core/js-lexicon.mjs';
import { verb, Action, Value, Predicate, Sentence } from '../packages/core/grammar.mjs';
import { mapUserCall, splitIdentifier } from '../packages/core/user-lexicon.mjs';

test('translates a pure comparison function using parameter and constant names', () => {
  const code = `export function isValidCredentials(username, password) {
  return username === DEMO_USERNAME && password === DEMO_PASSWORD;
}`;
  const text = describeImplementation(code);
  assert.equal(text, 'Takes `username` and `password` as input. Returns `username` equals `DEMO_USERNAME` and `password` equals `DEMO_PASSWORD`.');
});

test('translates a bare-call statement as an imperative sentence, not a description', () => {
  const code = `export function endSession() {
  window.localStorage.removeItem(SESSION_KEY);
}`;
  assert.equal(describeImplementation(code), 'Removes the browser-storage key `SESSION_KEY`.');
});

test('translates an if/else with a returned call value as "the result of <gerund>"', () => {
  const code = `export function getSessionUser() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SESSION_KEY);
}`;
  const text = describeImplementation(code);
  assert.match(text, /^If `window` is undefined: Returns null\./);
  assert.match(text, /Returns the result of reading the browser-storage key `SESSION_KEY`\.$/);
});

test('translates typeof comparisons against a non-undefined string as "is of type X"', () => {
  const code = `export function f(x) {
  return typeof x === 'string';
}`;
  assert.equal(describeImplementation(code), 'Takes `x` as input. Returns `x` is of type "string".');
});

test('does not confuse a destructuring assignment\'s "}" with a block-closing "}"', () => {
  // This is exactly the bug the earlier regex/brace-counting scanner had:
  // it would split this single statement into two at the pattern's '}'.
  const code = `export function LoginController() {
  const { username, submit } = useLogin();
  return <LoginPage username={username} onSubmit={submit} />;
}`;
  const text = describeImplementation(code);
  assert.equal(
    text,
    'Declares `username` and `submit` from the login hook. Renders `<LoginPage>` markup.'
  );
});

test('translates useState/useEffect/router wiring by name, not by printing the hook code', () => {
  const code = `export function useLogin() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  useEffect(() => {
    if (username) {
      router.push('/');
    }
  }, [username, router]);
  return { username, setUsername };
}`;
  const text = describeImplementation(code);
  assert.match(text, /Declares `router` as the app router\./);
  assert.match(text, /Holds local state `username` \(setter `setUsername`\), starting at an empty string\./);
  assert.match(text, /Whenever `username` and `router` change: If `username`: Navigates to the text '\/'\./);
  assert.match(text, /Returns an object with `username` and `setUsername`\./);
  assert.doesNotMatch(text, /=>|const |function\(/); // never raw code syntax
});

test('translates an async service function: await, fetch, throw, and a member call', () => {
  const code = `export async function fetchWidget() {
  const response = await fetch('/api/widget', { method: 'GET' });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}`;
  const text = describeImplementation(code);
  assert.match(text, /^Declares `response` as the result of fetching the text '\/api\/widget' with an object with `method` set to the text 'GET'\./);
  assert.match(text, /If not \(`response\.ok`\): Throws a new `Error` \(the text 'Request failed'\)\./);
  assert.match(text, /Returns the JSON body of `response`\.$/);
});

// ---- grammar + lexicons (grammar.mjs, js-lexicon.mjs, user-lexicon.mjs) ----

const ref = (js) => ({ english: `\`${js}\``, js, bare: null });

test('grammar: a verb conjugates itself', () => {
  const forms = (l) => { const v = verb(l); return [v.thirdPerson, v.gerund, v.negated].join(' / '); };
  assert.equal(forms('set'), 'sets / setting / does not set');
  assert.equal(forms('fetch'), 'fetches / fetching / does not fetch');
  assert.equal(forms('copy'), 'copies / copying / does not copy');
  assert.equal(forms('remove'), 'removes / removing / does not remove');
  assert.equal(forms('listen'), 'listens / listening / does not listen');
  assert.equal(forms('show'), 'shows / showing / does not show');
  assert.equal(forms('go'), 'goes / going / does not go');
});

test('JS lexicon: every entry is a typed sentence over grammar primitives', () => {
  for (const type of JS_LEXICON) {
    assert.ok(type.prototype instanceof Sentence, `not a Sentence type: ${type.call}`);
    assert.ok([Action, Value, Predicate].some((base) => type.prototype instanceof base), `not an Action/Value/Predicate: ${type.call}`);
    assert.match(type.call, /^\.?[A-Za-z][\w.]*$/, `bad call key: ${type.call}`);
  }
  assert.equal(new Set(JS_LEXICON.map((t) => t.call)).size, JS_LEXICON.length, 'duplicate call keys');
});

test('JS lexicon: optional groups drop when their argument is missing; required slots reject the binding', () => {
  const Fetch = JS_LEXICON.find((t) => t.call === 'fetch');
  assert.equal(new Fetch({ args: [ref('url')], target: null }).toEnglish(), 'fetches `url`');
  assert.equal(new Fetch({ args: [ref('url'), ref('opts')], target: null }).toGerund(), 'fetching `url` with `opts`');
  assert.equal(new Fetch({ args: [], target: null }).toEnglish(), null);
});

test('JS lexicon: one sentence, both languages, and back from canonical English', () => {
  const SetItem = JS_LEXICON.find((t) => t.call === 'localStorage.setItem');
  const s = new SetItem({ args: [{ english: "the text 'user'", js: "'user'", bare: "'user'" }, ref('u')], target: null });
  assert.equal(s.toEnglish(), "sets the browser-storage key 'user' to `u`");
  assert.equal(s.toJs(), "localStorage.setItem('user', u)");
  assert.equal(SetItem.fromEnglish("Sets the browser-storage key 'user' to `u`.").toJs(), "localStorage.setItem('user', u)");

  const Includes = JS_LEXICON.find((t) => t.call === '.includes');
  assert.equal(Includes.fromEnglish('`items` includes `x`').toJs(), 'items.includes(x)');
  assert.equal(Includes.fromEnglish('`items` includes the keys of `x`'), null, 'a described (non-canonical) slot does not map back');
});

test('user domain: callees map onto the grammar from their names', () => {
  assert.deepEqual(splitIdentifier('startUserSession'), ['start', 'user', 'session']);
  assert.deepEqual(splitIdentifier('parseURLParams'), ['parse', 'url', 'params']);
  const sentence = (callee, ...a) => new (mapUserCall(callee))({ args: a.map(ref), target: null });
  assert.equal(sentence('startSession', 'user').toEnglish(), 'starts the session with `user`');
  assert.equal(sentence('save', 'user').toEnglish(), 'saves `user`');
  assert.equal(sentence('isValid', 'form').toNegatedEnglish(), '`form` is not valid');
  assert.equal(sentence('isReady').toEnglish(), 'it is ready');
  assert.equal(sentence('getUser', 'id').toEnglish(), 'the user for `id`');
  assert.equal(sentence('logIn', 'user').toEnglish(), 'logs in as `user`');
  assert.equal(sentence('useLogin').toEnglish(), 'the login hook');
  assert.equal(sentence('total', 'a', 'b').toEnglish(), '`total` of `a` and `b`');
});

test('every call reads as English: our domain, then the user domain, with negation by the verb', () => {
  const text = describeImplementation(`export async function submit(form) {
  if (!isValid(form)) return;
  if (!items.includes(form.id)) items.push(form.id);
  await startSession(form.user);
  return getUser(form.id);
}`);
  assert.equal(text, 'Takes `form` as input. If `form` is not valid: Returns. If `items` does not include `form.id`: Adds `form.id` to the end of `items`. Starts the session with `form.user`. Returns the user for `form.id`.');
});

test('JS lexicon: standard-library calls read as sentences, with literal keys shown bare', () => {
  const text = describeImplementation(`export function save(user) {
  localStorage.setItem('user', JSON.stringify(user));
  console.log('saved', user.id);
}`);
  assert.equal(text, "Takes `user` as input. Sets the browser-storage key 'user' to the JSON text of `user`. Logs the text 'saved' and `user.id`.");
});

test('JS lexicon: method calls describe their receiver instead of reprinting a chained call', () => {
  const text = describeImplementation(`export function onKey(event) {
  event.preventDefault();
  document.getElementById('menu').classList.remove('open');
}`);
  assert.match(text, /Stops the browser's default handling of `event`\./);
  assert.match(text, /Removes the CSS class 'open' from `classList` of the element with id 'menu'\./);
  assert.doesNotMatch(text, /getElementById\(/);
});

test('JS lexicon: verbs used as values read as "the result of <gerund>"; nouns are never wrapped', () => {
  const text = describeImplementation(`export function poll(refresh) {
  const id = setInterval(refresh, 5000);
  return Object.keys(state[0]);
}`);
  assert.match(text, /Declares `id` as the result of running `refresh` repeatedly every 5000 milliseconds\./);
  assert.match(text, /Returns the keys of item 0 of `state`\.$/);
});

test('a call no lexicon has a verb for still reads as a noun phrase, never raw code', () => {
  assert.equal(describeImplementation('export function f(x) { return x.frobnicate(1); }'), 'Takes `x` as input. Returns `frobnicate` of `x` applied to the number 1.');
});
