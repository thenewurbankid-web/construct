import test from 'node:test';
import assert from 'node:assert/strict';
import { describeImplementation } from '../src/prose.mjs';

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
    'Declares `username` and `submit` from the result of calling `useLogin`. Renders `<LoginPage>` markup.'
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
  assert.match(text, /Returns the result of calling `response\.json`\.$/);
});

test('translates an XState machine literal into its states and transitions, not the object source', () => {
  const code = `export const LoginWorkflow = setup({}).createMachine({
  id: 'login',
  initial: 'idle',
  states: {
    idle: {
      on: {
        SUBMIT: [
          { guard: { type: 'isValid' }, target: 'success' },
          { target: 'rejected' },
        ],
      },
    },
    rejected: {
      entry: assign({ error: 'Invalid username or password.' }),
    },
    success: { type: 'final' },
  },
});`;
  const text = describeImplementation(code);
  assert.match(text, /^Defines a state machine named `login`, starting in `idle`, with states `idle`, `rejected`, and `success`\./);
  assert.match(text, /In `idle`: on `SUBMIT`, moves to `success` if `isValid` passes, to `rejected` otherwise\./);
  assert.match(text, /In `rejected`: entering `rejected` sets `error` to the text 'Invalid username or password\.'\./);
  assert.match(text, /In `success`: `success` is a final state\./);
  assert.doesNotMatch(text, /createMachine|setup\(/); // never raw code syntax
});

test('renders JSX as a flattened list of tag names, deduplicated, in first-seen order', () => {
  const code = `export function LoginPage(props) {
  return (
    <main>
      <h1>Sign in</h1>
      <p>Demo credentials</p>
      <Login {...props} />
    </main>
  );
}`;
  assert.equal(describeImplementation(code), 'Takes `props` as input. Renders `<main>`, `<h1>`, `<p>`, and `<Login>` markup.');
});

test('describes destructured object parameters by name, ignoring type annotations', () => {
  const code = `export function Login({ username, onSubmit }: LoginProps) {
  return <form onSubmit={onSubmit}>{username}</form>;
}`;
  const text = describeImplementation(code);
  assert.match(text, /^Takes `username` and `onSubmit` as input\./);
});

test('an empty function body reads as "does nothing" rather than a dangling colon', () => {
  const code = `export function useCore() {
  return { action: useCallback(() => {}, []) };
}`;
  const text = describeImplementation(code);
  assert.match(text, /a function that does nothing/);
  assert.doesNotMatch(text, /that: {2}/); // no double space from an empty body
});

test('never falls back to printing raw code for a recognized function/const declaration', () => {
  const samples = [
    `export function f(a, b) { return a + b; }`,
    `export const g = (x) => x * 2;`,
    `export const h = 1;`,
  ];
  for (const code of samples) {
    const text = describeImplementation(code);
    assert.doesNotMatch(text, /export (function|const)/, `should not echo raw code for: ${code}`);
  }
});
