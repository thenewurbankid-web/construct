import test from 'node:test';
import assert from 'node:assert/strict';
import { githubReducer, initialGithubState } from './Github.ts';

const repo = (n) => ({ fullName: `o/${n}`, owner: 'o', name: n, private: true });
const list = (page, names, extra = {}) => ({ repos: names.map(repo), page, perPage: 2, total: 3, hasMore: page < 2, truncated: false, source: 'installations', installations: 1, ...extra });
const run = (...actions) => actions.reduce((s, a) => githubReducer(s, a), initialGithubState);

test('nothing is known until the server answers; a failed read keeps the feature hidden', () => {
  assert.equal(initialGithubState.status, null);
  assert.equal(run({ type: 'STATUS_FAILED' }).status, null);
});

test('connected: status and repositories are kept; the next page is appended', () => {
  const s = run({ type: 'STATUS', status: { enabled: true, connected: true, login: 'octo' } }, { type: 'REPOS_LOADING' }, { type: 'REPOS', list: list(1, ['a', 'b']) }, { type: 'REPOS', list: list(2, ['b', 'c']) });
  assert.equal(s.status.login, 'octo');
  assert.deepEqual(s.repos.map((r) => r.name), ['a', 'b', 'c']);
  assert.equal(s.reposLoading, false);
});

test('disconnecting (or a status that says not connected) forgets the repositories and the filter', () => {
  const s = run({ type: 'STATUS', status: { enabled: true, connected: true, login: 'octo' } }, { type: 'SET_QUERY', query: 'zz' }, { type: 'REPOS', list: list(1, ['a']) }, { type: 'STATUS', status: { enabled: true, connected: false } });
  assert.deepEqual(s.repos, []);
  assert.equal(s.list, null);
  assert.equal(s.query, '');
  assert.equal(s.status.connected, false);
});

test('a failed list keeps what was shown and says why; busy and errors are for Disconnect', () => {
  const s = run({ type: 'STATUS', status: { enabled: true, connected: true } }, { type: 'REPOS', list: list(1, ['a']) }, { type: 'REPOS_LOADING' }, { type: 'REPOS_FAILED', error: 'GitHub did not answer in time.' });
  assert.equal(s.reposError, 'GitHub did not answer in time.');
  assert.equal(s.repos.length, 1);
  const b = run({ type: 'BUSY' });
  assert.equal(b.busy, true);
  const e = githubReducer(b, { type: 'ERROR', error: 'Could not disconnect.' });
  assert.deepEqual([e.busy, e.error], [false, 'Could not disconnect.']);
});
