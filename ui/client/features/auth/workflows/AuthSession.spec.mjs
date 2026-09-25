import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authSessionReducer as reduce,
  initialAuthSessionState as initial,
  isLoadingSession,
  isSigningIn,
  sessionOf,
  signInError,
  unreachableMessage,
} from './AuthSession.ts';

const session = { authRequired: true, authenticated: true, user: null, githubConfigured: true, loginPath: '/auth/login', testLogin: true, testLoginUser: 'e2e' };

test('#664: the session load is one status at a time, starting at "still asking" so the login screen never flashes', () => {
  assert.deepEqual(initial, { load: { status: 'loading' }, signIn: { status: 'idle' } });
  assert.equal(isLoadingSession(initial), true);
  assert.equal(sessionOf(initial), null);

  const ready = reduce(initial, { type: 'LOADED', session });
  assert.deepEqual(ready.load, { status: 'ready', session });
  assert.equal(isLoadingSession(ready), false);
  assert.equal(sessionOf(ready), session);
  assert.equal(unreachableMessage(ready), null);
});

test('#664: asking again drops the old answer, and an unreachable server never keeps a previously good session', () => {
  const ready = reduce(initial, { type: 'LOADED', session });
  const asking = reduce(ready, { type: 'LOAD_START' });
  assert.deepEqual(asking.load, { status: 'loading' });
  assert.equal(sessionOf(asking), null);

  const down = reduce(ready, { type: 'LOAD_FAILED', message: 'no answer' });
  assert.deepEqual(down.load, { status: 'unreachable', message: 'no answer' });
  assert.equal(sessionOf(down), null, 'not knowing counts as blocked');
  assert.equal(unreachableMessage(down), 'no answer');
  assert.equal(isLoadingSession(down), false);

  const back = reduce(down, { type: 'LOADED', session });
  assert.equal(unreachableMessage(back), null, 'a later answer clears the unreachable note');
});

test('#664: the sign-in button is idle, in flight, or failed; starting an attempt clears the last failure', () => {
  let s = reduce(initial, { type: 'SIGN_IN_START' });
  assert.deepEqual(s.signIn, { status: 'signing-in' });
  assert.equal(isSigningIn(s), true);
  assert.equal(signInError(s), null);

  s = reduce(s, { type: 'SIGN_IN_FAILED', message: 'refused' });
  assert.deepEqual(s.signIn, { status: 'failed', message: 'refused' });
  assert.equal(isSigningIn(s), false);
  assert.equal(signInError(s), 'refused');

  s = reduce(s, { type: 'SIGN_IN_START' });
  assert.equal(signInError(s), null);
});

test('#664: an in-flight sign-in ends when the session answer lands, either way; a failure stays until the next attempt', () => {
  const inFlight = reduce(initial, { type: 'SIGN_IN_START' });
  assert.deepEqual(reduce(inFlight, { type: 'LOADED', session }).signIn, { status: 'idle' });
  assert.deepEqual(reduce(inFlight, { type: 'LOAD_FAILED', message: 'x' }).signIn, { status: 'idle' });

  const failed = reduce(initial, { type: 'SIGN_IN_FAILED', message: 'refused' });
  assert.equal(signInError(reduce(failed, { type: 'LOADED', session })), 'refused');
  assert.equal(signInError(reduce(failed, { type: 'LOAD_START' })), 'refused');
});

test('#664: the two axes are independent: asking again keeps an in-flight sign-in, and signing in keeps the answer', () => {
  const ready = reduce(initial, { type: 'LOADED', session });
  const both = reduce(ready, { type: 'SIGN_IN_START' });
  assert.equal(sessionOf(both), session);
  assert.equal(isSigningIn(reduce(both, { type: 'LOAD_START' })), true);
});
