import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksCockpit, canSignIn, showsAccount } from './Session.ts';
import { displayName, initial } from './UserLabel.ts';

const session = (over = {}) => ({
  authRequired: true,
  authenticated: false,
  user: null,
  githubConfigured: true,
  loginPath: '/auth/login',
  testLogin: false,
  testLoginUser: null,
  ...over,
});

const user = { login: 'octocat', name: 'The Octocat', avatarUrl: null };

test('not knowing counts as blocked — an absent session never renders the Cockpit', () => {
  assert.equal(blocksCockpit(null), true);
});

test('the gate blocks exactly when the server requires a login and this browser has none', () => {
  assert.equal(blocksCockpit(session({ authenticated: false })), true);
  assert.equal(blocksCockpit(session({ authenticated: true })), false);
  // A server with no gate at all (unauthenticated loopback dev) renders directly.
  assert.equal(blocksCockpit(session({ authRequired: false, authenticated: true })), false);
  assert.equal(blocksCockpit(session({ authRequired: false, authenticated: false })), false);
});

test('a gate with no way through it is reported rather than offered as a button', () => {
  assert.equal(canSignIn(null), false);
  assert.equal(canSignIn(session({ githubConfigured: false, testLogin: false })), false);
  assert.equal(canSignIn(session({ githubConfigured: true, testLogin: false })), true);
  assert.equal(canSignIn(session({ githubConfigured: false, testLogin: true })), true);
});

test('the top bar shows an account only when there is a gate and someone is behind it', () => {
  assert.equal(showsAccount(null), false);
  assert.equal(showsAccount(session({ authRequired: false, user })), false);
  assert.equal(showsAccount(session({ authRequired: true, user: null })), false);
  assert.equal(showsAccount(session({ authRequired: true, authenticated: true, user })), true);
});

test('display name prefers the GitHub name and falls back to the login', () => {
  assert.equal(displayName(user), 'The Octocat');
  assert.equal(displayName({ login: 'octocat', name: '   ', avatarUrl: null }), 'octocat');
  assert.equal(displayName({ login: 'octocat', name: null, avatarUrl: null }), 'octocat');
  assert.equal(displayName(null), '');
});

test('the avatar fallback is the first letter of the login', () => {
  assert.equal(initial(user), 'O');
  assert.equal(initial({ login: '', name: null, avatarUrl: null }), '?');
  assert.equal(initial(null), '?');
});
